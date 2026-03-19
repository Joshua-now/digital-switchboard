import express, { Request, Response } from 'express';
import axios from 'axios';
import { prisma } from '../lib/db.js';
import { normalizePhone, isWithinQuietHours, generateDedupeKey } from '../lib/utils.js';
import { createAuditLog } from '../lib/audit.js';
import { createCall as createBlandCall } from '../providers/bland.js';
import { createCall as createVapiCall } from '../providers/vapi.js';
import {
  makeTelnyxCall,
  decodeTelnyxClientState,
  startTelnyxAI,
  dialOutbound,
  speakOnCall,
  bridgeCalls,
  hangupCall,
} from '../providers/telnyx.js';

// ─── Warm-transfer state (in-memory, same process) ────────────────────────────
interface PendingTransfer {
  resolve: (result: 'connected' | 'unavailable') => void;
  leadCallControlId: string;
  whisperText: string;
  timeout: ReturnType<typeof setTimeout>;
}
const pendingTransfers = new Map<string, PendingTransfer>();

async function handleTransferLegEvent(
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  const joshuaCcid = payload.call_control_id as string;
  const pending = pendingTransfers.get(joshuaCcid);

  console.log(`[warm-transfer] ${eventType} | joshua:${joshuaCcid} | pending:${!!pending}`);

  switch (eventType) {
    case 'call.machine.detection.ended': {
      const amdResult = payload.result as string; // 'human' | 'answering_machine' | 'not_sure'
      console.log(`[warm-transfer] AMD result: ${amdResult}`);
      if (amdResult === 'answering_machine') {
        await hangupCall(joshuaCcid).catch(e => console.error('[warm-transfer] hangup failed:', e.message));
        if (pending) {
          clearTimeout(pending.timeout);
          pendingTransfers.delete(joshuaCcid);
          pending.resolve('unavailable');
        }
      } else {
        // Human (or not_sure) — play whisper
        if (pending) {
          await speakOnCall(joshuaCcid, pending.whisperText).catch(async e => {
            console.error('[warm-transfer] speak failed, bridging directly:', e.message);
            await bridgeCalls(pending.leadCallControlId, joshuaCcid).catch(() => {});
            clearTimeout(pending.timeout);
            pendingTransfers.delete(joshuaCcid);
            pending.resolve('connected');
          });
        }
      }
      break;
    }

    case 'call.speak.ended': {
      // Whisper finished — bridge the two legs now
      if (pending) {
        await bridgeCalls(pending.leadCallControlId, joshuaCcid).catch(e =>
          console.error('[warm-transfer] bridge failed:', e.message)
        );
        clearTimeout(pending.timeout);
        pendingTransfers.delete(joshuaCcid);
        pending.resolve('connected');
      }
      break;
    }

    case 'call.hangup': {
      // Joshua hung up (or never answered) before we bridged
      if (pending) {
        clearTimeout(pending.timeout);
        pendingTransfers.delete(joshuaCcid);
        pending.resolve('unavailable');
      }
      break;
    }

    default:
      break;
  }
}

const router = express.Router();

// ─── GoHighLevel inbound webhook ──────────────────────────────────────────────
router.post('/gohighlevel/:clientId', async (req: Request, res: Response) => {
  const { clientId } = req.params;
  const payload = req.body;

  try {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        routingConfigs: {
          where: { active: true },
          take: 1,
        },
      },
    });

    if (!client) {
      await createAuditLog('WEBHOOK_ERROR', `Client not found: ${clientId}`, undefined, { clientId, payload });
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    const rawPhone = payload.phone || payload.contact?.phone || payload.phoneNumber;
    if (!rawPhone) {
      await createAuditLog('WEBHOOK_ERROR', 'No phone number in payload', clientId, { payload });
      res.status(400).json({ error: 'Phone number required' });
      return;
    }

    const phone = normalizePhone(rawPhone);
    if (!phone) {
      await createAuditLog('WEBHOOK_ERROR', `Invalid phone number: ${rawPhone}`, clientId, { payload });
      res.status(400).json({ error: 'Invalid phone number' });
      return;
    }

    const contactId = payload.contactId || payload.contact_id || payload.contact?.id;
    const dedupeKey = generateDedupeKey(contactId, phone);

    const existingLead = await prisma.lead.findUnique({
      where: { clientId_dedupeKey: { clientId, dedupeKey } },
    });

    if (existingLead) {
      await createAuditLog('WEBHOOK_DUPLICATE', `Duplicate lead ignored: ${dedupeKey}`, clientId, {
        leadId: existingLead.id,
        dedupeKey,
      });
      res.status(200).json({ message: 'Lead already processed', leadId: existingLead.id });
      return;
    }

    const lead = await prisma.lead.create({
      data: {
        clientId,
        firstName: payload.firstName || payload.first_name || payload.contact?.firstName || null,
        lastName: payload.lastName || payload.last_name || payload.contact?.lastName || null,
        phone,
        email: payload.email || payload.contact?.email || null,
        source: payload.source || 'gohighlevel',
        payloadJson: payload,
        dedupeKey,
        callStatus: 'NEW',
      },
    });

    await createAuditLog('LEAD_CREATED', `New lead created: ${phone}`, clientId, { leadId: lead.id, phone });

    if (client.status !== 'ACTIVE') {
      await prisma.lead.update({ where: { id: lead.id }, data: { callStatus: 'SKIPPED', skipReason: 'Client inactive' } });
      res.status(200).json({ message: 'Lead received but client inactive', leadId: lead.id });
      return;
    }

    const routingConfig = client.routingConfigs[0];
    if (!routingConfig) {
      await prisma.lead.update({ where: { id: lead.id }, data: { callStatus: 'SKIPPED', skipReason: 'No active routing config' } });
      res.status(200).json({ message: 'Lead received but no routing config', leadId: lead.id });
      return;
    }

    if (isWithinQuietHours(client.timezone, client.quietHoursStart, client.quietHoursEnd)) {
      await prisma.lead.update({ where: { id: lead.id }, data: { callStatus: 'SKIPPED', skipReason: 'Quiet hours' } });
      await createAuditLog('CALL_SKIPPED', `Call skipped due to quiet hours: ${phone}`, clientId, { leadId: lead.id });
      res.status(200).json({ message: 'Lead received but in quiet hours', leadId: lead.id });
      return;
    }

    await prisma.lead.update({ where: { id: lead.id }, data: { callStatus: 'QUEUED' } });

    const provider = (routingConfig as any).provider || 'BLAND';
    let callResult: { success: boolean; callId?: string; error?: string };

    if (provider === 'VAPI') {
      callResult = await createVapiCall(
        lead.id, clientId, phone,
        routingConfig.instructions,
        routingConfig.transferNumber || undefined,
        lead.firstName || undefined,
        (routingConfig as any).vapiAssistantId || undefined
      );
    } else if (provider === 'TELNYX') {
      try {
        // Create the call record first so we have an internalCallId
        const callRecord = await prisma.call.create({
          data: { clientId, leadId: lead.id, provider: 'TELNYX', status: 'CREATED' },
        });
        const result = await makeTelnyxCall(
          phone,
          routingConfig.instructions,
          routingConfig.transferNumber || null,
          lead.id,
          clientId,
          callRecord.id,
          lead.firstName || undefined,
          (routingConfig as any).telnyxAssistantId || undefined
        );
        await prisma.call.update({
          where: { id: callRecord.id },
          data: { providerCallId: result.callId, status: 'IN_PROGRESS', startedAt: new Date() },
        });
        await prisma.lead.update({ where: { id: lead.id }, data: { callStatus: 'CALLING' } });
        await createAuditLog('CALL_INITIATED', `Telnyx call initiated to ${phone}`, clientId, {
          leadId: lead.id, callId: callRecord.id, providerCallId: result.callId,
        });
        callResult = { success: true, callId: result.callId };
      } catch (err: any) {
        await createAuditLog('CALL_FAILED', `Telnyx call failed: ${err.message}`, clientId, { leadId: lead.id });
        await prisma.lead.update({ where: { id: lead.id }, data: { callStatus: 'FAILED', skipReason: err.message } });
        callResult = { success: false, error: err.message };
      }
    } else {
      // Default: BLAND
      callResult = await createBlandCall(
        lead.id, clientId, phone,
        routingConfig.instructions,
        routingConfig.transferNumber || undefined,
        (routingConfig as any).blandAgentId || undefined
      );
    }

    if (callResult.success) {
      res.status(200).json({ message: 'Lead received and call initiated', leadId: lead.id, callId: callResult.callId });
    } else {
      res.status(200).json({ message: 'Lead received but call failed', leadId: lead.id, error: callResult.error });
    }
  } catch (error: any) {
    console.error('Webhook error:', error);
    await createAuditLog('WEBHOOK_ERROR', error.message, clientId, { payload, error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Bland callback ────────────────────────────────────────────────────────────
router.post('/bland', async (req: Request, res: Response) => {
  const payload = req.body;

  try {
    const callId = payload.call_id;
    if (!callId) {
      res.status(400).json({ error: 'call_id required' });
      return;
    }

    const call = await prisma.call.findUnique({
      where: { providerCallId: callId },
      include: { lead: true },
    });

    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    const status = payload.status?.toLowerCase();
    let callStatus: 'CREATED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' = 'IN_PROGRESS';
    let leadStatus: 'NEW' | 'QUEUED' | 'CALLING' | 'COMPLETED' | 'FAILED' | 'SKIPPED' = 'CALLING';

    if (status === 'completed' || payload.completed) {
      callStatus = 'COMPLETED';
      leadStatus = 'COMPLETED';
    } else if (status === 'failed' || payload.error) {
      callStatus = 'FAILED';
      leadStatus = 'FAILED';
    }

    await prisma.call.update({
      where: { id: call.id },
      data: {
        status: callStatus,
        outcome: payload.outcome || payload.call_length || null,
        transcript: payload.transcript || payload.transcripts?.[0]?.text || null,
        recordingUrl: payload.recording_url || null,
        rawProviderPayload: payload,
        endedAt: callStatus === 'COMPLETED' || callStatus === 'FAILED' ? new Date() : null,
      },
    });

    await prisma.lead.update({ where: { id: call.leadId }, data: { callStatus: leadStatus } });

    await createAuditLog('CALL_UPDATED', `Bland call status → ${callStatus}`, call.clientId, {
      callId: call.id, leadId: call.leadId, status: callStatus,
    });

    res.status(200).json({ message: 'Webhook processed' });
  } catch (error: any) {
    console.error('Bland webhook error:', error);
    await createAuditLog('WEBHOOK_ERROR', error.message, undefined, { payload, error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── VAPI callback ─────────────────────────────────────────────────────────────
router.post('/vapi', async (req: Request, res: Response) => {
  const payload = req.body;

  try {
    const callId = payload.call?.id || payload.callId;
    if (!callId) {
      console.error('No call ID in VAPI webhook payload');
      res.status(400).json({ error: 'call ID required' });
      return;
    }

    const call = await prisma.call.findUnique({
      where: { providerCallId: callId },
      include: { lead: true },
    });

    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    const status = payload.status?.toLowerCase();
    let callStatus: 'CREATED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' = 'IN_PROGRESS';
    let leadStatus: 'NEW' | 'QUEUED' | 'CALLING' | 'COMPLETED' | 'FAILED' | 'SKIPPED' = 'CALLING';

    if (status === 'ended' || payload.endedReason) {
      callStatus = 'COMPLETED';
      leadStatus = 'COMPLETED';
    } else if (status === 'failed') {
      callStatus = 'FAILED';
      leadStatus = 'FAILED';
    }

    await prisma.call.update({
      where: { id: call.id },
      data: {
        status: callStatus,
        outcome: payload.endedReason || null,
        transcript: payload.transcript || null,
        recordingUrl: payload.recordingUrl || null,
        rawProviderPayload: payload,
        endedAt: callStatus === 'COMPLETED' || callStatus === 'FAILED' ? new Date() : null,
      },
    });

    await prisma.lead.update({ where: { id: call.leadId }, data: { callStatus: leadStatus } });

    await createAuditLog('CALL_UPDATED', `VAPI call status → ${callStatus}`, call.clientId, {
      callId: call.id, leadId: call.leadId, status: callStatus,
    });

    res.status(200).json({ message: 'Webhook processed' });
  } catch (error: any) {
    console.error('VAPI webhook error:', error);
    await createAuditLog('WEBHOOK_ERROR', error.message, undefined, { payload, error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Telnyx AI tool: warm transfer with AMD + whisper + fallback ───────────────
// Anna calls this webhook tool when she wants to transfer a qualified lead.
// We dial Joshua separately with AMD. If he answers → whisper briefing → bridge.
// If voicemail → hang up his leg → return "unavailable" so Anna books instead.
router.post('/telnyx/transfer', async (req: Request, res: Response) => {
  try {
    // Telnyx auto-injects call_control_id into webhook tool payloads
    const leadCcid = req.body.call_control_id as string | undefined;
    const leadName    = (req.body.lead_name    as string | undefined) || 'the lead';
    const leadSummary = (req.body.lead_summary as string | undefined) || 'interested in your services';

    const dest = process.env.DEFAULT_TRANSFER_NUMBER;
    if (!leadCcid || !dest) {
      res.status(400).json({ result: 'error', message: 'Missing call_control_id or DEFAULT_TRANSFER_NUMBER' });
      return;
    }

    const whisperText =
      `Hi Joshua — I have ${leadName} on the line. ${leadSummary}. Connecting you now.`;

    const webhookUrl = `${process.env.BASE_URL}/webhook/telnyx`;
    const clientRef  = `transfer_from_${leadCcid}`;

    // Dial Joshua outbound with AMD
    const joshuaCcid = await dialOutbound(dest, clientRef, webhookUrl);
    console.log(`[warm-transfer] Dialed Joshua at ${dest} | ccid:${joshuaCcid}`);

    // Wait up to 25 s for AMD result → whisper → bridge
    const result = await new Promise<'connected' | 'unavailable'>((resolve) => {
      const timeout = setTimeout(() => {
        pendingTransfers.delete(joshuaCcid);
        hangupCall(joshuaCcid).catch(() => {});
        console.log('[warm-transfer] Timed out — Joshua not reached');
        resolve('unavailable');
      }, 25000);

      pendingTransfers.set(joshuaCcid, {
        resolve,
        leadCallControlId: leadCcid,
        whisperText,
        timeout,
      });
    });

    if (result === 'connected') {
      res.json({ result: 'connected', message: `${leadName} has been connected with Joshua.` });
    } else {
      res.json({ result: 'unavailable', message: 'Joshua is not available right now.' });
    }
  } catch (err: any) {
    console.error('[telnyx-transfer]', err.response?.data || err.message);
    res.status(500).json({ result: 'error', message: err.message });
  }
});

// ─── Telnyx callback ───────────────────────────────────────────────────────────
// Telnyx expects a fast 200. Always respond first, then process async.
router.post('/telnyx', async (req: Request, res: Response) => {
  res.sendStatus(200); // Acknowledge immediately

  try {
    const event = req.body?.data;
    if (!event) return;

    const eventType = event.event_type as string;
    const payload = event.payload ?? {};

    // ── Warm-transfer leg events (Joshua's outbound call — no client_state) ──
    const clientRef = (payload.client_reference_id as string) || '';
    if (clientRef.startsWith('transfer_from_')) {
      await handleTransferLegEvent(eventType, payload as Record<string, unknown>);
      return;
    }

    const clientState = payload.client_state
      ? decodeTelnyxClientState(payload.client_state as string)
      : null;

    if (!clientState) {
      console.log('[telnyx-webhook] No client_state, skipping:', eventType);
      return;
    }

    const { leadId, clientId, internalCallId } = clientState;
    const callControlId = payload.call_control_id as string;

    console.log(`[telnyx-webhook] ${eventType} | lead:${leadId} | ctrl:${callControlId}`);

    switch (eventType) {
      case 'call.initiated':
        await prisma.call.updateMany({
          where: { id: internalCallId },
          data: { status: 'IN_PROGRESS' },
        });
        await createAuditLog('telnyx_call_initiated', 'Telnyx call initiated', clientId, {
          leadId, callControlId,
        });
        break;

      case 'call.answered': {
        await prisma.call.updateMany({
          where: { id: internalCallId },
          data: { status: 'IN_PROGRESS', providerCallId: callControlId },
        });
        await prisma.lead.updateMany({
          where: { id: leadId },
          data: { callStatus: 'CALLING' },
        });
        // Start the AI assistant on the answered outbound call
        const routingInfo = await prisma.routingConfig.findFirst({
          where: { clientId },
        });
        const assistantId = (routingInfo as any)?.telnyxAssistantId || process.env.TELNYX_ASSISTANT_ID;
        if (assistantId) {
          await startTelnyxAI(callControlId, assistantId).catch(e =>
            console.error('[telnyx-webhook] ai_assist failed:', e.message)
          );
        }
        await createAuditLog('telnyx_call_answered', 'Telnyx call answered', clientId, {
          leadId, callControlId,
        });
        break;
      }

      case 'call.hangup': {
        const hangupCause = payload.hangup_cause as string | undefined;
        const callDuration = payload.call_duration_secs as number | undefined;

        await prisma.call.updateMany({
          where: { id: internalCallId },
          data: { status: 'COMPLETED', endedAt: new Date() },
        });
        await prisma.lead.updateMany({
          where: { id: leadId },
          data: { callStatus: 'COMPLETED' },
        });
        await createAuditLog('telnyx_call_completed', 'Telnyx call completed', clientId, {
          leadId, callControlId, hangupCause, callDuration,
        });
        break;
      }

      case 'call.recording.saved': {
        const recordingUrl = payload.recording_urls?.mp3 as string | undefined;
        if (recordingUrl) {
          await prisma.call.updateMany({
            where: { id: internalCallId },
            data: { recordingUrl },
          });
        }
        break;
      }

      default:
        // Ignored: call.bridged, call.dtmf_received, etc.
        break;
    }
  } catch (err: any) {
    console.error('[telnyx-webhook] Error:', err.message);
  }
});

export default router;
