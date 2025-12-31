import express, { Request, Response } from 'express';
import { prisma } from '../lib/db.js';
import { normalizePhone, isWithinQuietHours, generateDedupeKey } from '../lib/utils.js';
import { createAuditLog } from '../lib/audit.js';
import { createCall } from '../providers/bland.js';

const router = express.Router();

/**
 * Extract phone from common GoHighLevel webhook shapes.
 */
function extractRawPhone(payload: any): string | undefined {
  return (
    payload?.phone ||
    payload?.phoneNumber ||
    payload?.contact?.phone ||
    payload?.contact?.phoneNumber ||
    payload?.contact?.phoneNumberRaw ||
    payload?.data?.phone ||
    payload?.data?.phoneNumber ||
    payload?.data?.contact?.phone
  );
}

function extractContactId(payload: any): string | undefined {
  return (
    payload?.contactId ||
    payload?.contact?.id ||
    payload?.data?.contactId ||
    payload?.data?.contact?.id
  );
}

router.post('/gohighlevel/:clientId', async (req: Request, res: Response) => {
  const { clientId } = req.params;
  const payload = req.body;

  // 🔎 Safe logs (no secrets)
  console.log('[GHL] webhook received', { clientId });
  console.log('[GHL] payload keys', Object.keys(payload || {}));

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
      await createAuditLog('WEBHOOK_ERROR', `Client not found: ${clientId}`, undefined, {
        clientId,
        payloadSummary: {
          keys: Object.keys(payload || {}),
          contactId: extractContactId(payload),
        },
      });
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    const routingConfig = client.routingConfigs[0];

    console.log('[GHL] client status', { status: client.status });
    console.log('[GHL] routing config', { found: !!routingConfig });

    const rawPhone = extractRawPhone(payload);
    console.log('[GHL] raw phone candidate', { rawPhone });

    if (!rawPhone) {
      await createAuditLog('WEBHOOK_ERROR', 'No phone number in payload', clientId, {
        payloadSummary: {
          keys: Object.keys(payload || {}),
          contactId: extractContactId(payload),
        },
      });
      res.status(400).json({ error: 'Phone number required' });
      return;
    }

    const phone = normalizePhone(rawPhone);
    console.log('[GHL] normalized phone', { phone });

    if (!phone) {
      await createAuditLog('WEBHOOK_ERROR', `Invalid phone number: ${rawPhone}`, clientId, {
        rawPhone,
        payloadSummary: {
          keys: Object.keys(payload || {}),
          contactId: extractContactId(payload),
        },
      });
      res.status(400).json({ error: 'Invalid phone number' });
      return;
    }

    const contactId = extractContactId(payload);
    const dedupeKey = generateDedupeKey(contactId, phone);
    console.log('[GHL] dedupe key', { dedupeKey, contactId });

    const existingLead = await prisma.lead.findUnique({
      where: {
        clientId_dedupeKey: {
          clientId,
          dedupeKey,
        },
      },
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
        firstName:
          payload?.firstName ||
          payload?.contact?.firstName ||
          payload?.data?.firstName ||
          payload?.data?.contact?.firstName ||
          null,
        lastName:
          payload?.lastName ||
          payload?.contact?.lastName ||
          payload?.data?.lastName ||
          payload?.data?.contact?.lastName ||
          null,
        phone,
        email:
          payload?.email ||
          payload?.contact?.email ||
          payload?.data?.email ||
          payload?.data?.contact?.email ||
          null,
        source: payload?.source || 'gohighlevel',
        payloadJson: payload,
        dedupeKey,
        callStatus: 'NEW',
      },
    });

    await createAuditLog('LEAD_CREATED', `New lead created: ${phone}`, clientId, {
      leadId: lead.id,
      phone,
    });

    // Client inactive => skip
    if (client.status !== 'ACTIVE') {
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          callStatus: 'SKIPPED',
          skipReason: 'Client inactive',
        },
      });

      console.log('[GHL] skipped - client inactive', { leadId: lead.id });
      res.status(200).json({ message: 'Lead received but client inactive', leadId: lead.id });
      return;
    }

    // No routing config => skip
    if (!routingConfig) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          callStatus: 'SKIPPED',
          skipReason: 'No active routing config',
        },
      });

      console.log('[GHL] skipped - no routing config', { leadId: lead.id });
      res.status(200).json({ message: 'Lead received but no routing config', leadId: lead.id });
      return;
    }

    // Quiet hours => skip
    const inQuietHours = isWithinQuietHours(
      client.timezone,
      client.quietHoursStart,
      client.quietHoursEnd
    );

    console.log('[GHL] quiet hours check', {
      inQuietHours,
      timezone: client.timezone,
      start: client.quietHoursStart,
      end: client.quietHoursEnd,
    });

    if (inQuietHours) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          callStatus: 'SKIPPED',
          skipReason: 'Quiet hours',
        },
      });

      await createAuditLog('CALL_SKIPPED', `Call skipped due to quiet hours: ${phone}`, clientId, {
        leadId: lead.id,
      });

      res.status(200).json({ message: 'Lead received but in quiet hours', leadId: lead.id });
      return;
    }

    // Queue it first
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        callStatus: 'QUEUED',
      },
    });

    const delaySeconds = Math.max(0, Number(routingConfig.callWithinSeconds ?? 0));
    console.log('[GHL] queued lead, scheduling call', { leadId: lead.id, delaySeconds });

    // Respond immediately (so GHL doesn’t retry)
    res.status(200).json({
      message: 'Lead received and call scheduled',
      leadId: lead.id,
      delaySeconds,
    });

    // Run call later (non-blocking)
    setTimeout(async () => {
      try {
        console.log('[GHL] attempting call now', { leadId: lead.id, phone });

        const callResult = await createCall(
          lead.id,
          clientId,
          phone,
          routingConfig.instructions,
          routingConfig.transferNumber || undefined
        );

        if (callResult.success) {
          console.log('[GHL] call initiated', { leadId: lead.id, callId: callResult.callId });
          await createAuditLog('CALL_INITIATED', 'Call initiated successfully', clientId, {
            leadId: lead.id,
            callId: callResult.callId,
          });
        } else {
          console.log('[GHL] call failed', { leadId: lead.id, error: callResult.error });
          await createAuditLog('CALL_FAILED', 'Call failed to initiate', clientId, {
            leadId: lead.id,
            error: callResult.error,
          });

          await prisma.lead.update({
            where: { id: lead.id },
            data: {
              callStatus: 'FAILED',
              skipReason: callResult.error || 'Call failed',
            },
          });
        }
      } catch (err: any) {
        console.error('[GHL] background call error', err);

        await createAuditLog('WEBHOOK_ERROR', err?.message || 'Background call error', clientId, {
          leadId: lead.id,
          error: err?.message,
        });

        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            callStatus: 'FAILED',
            skipReason: err?.message || 'Background call error',
          },
        });
      }
    }, delaySeconds * 1000);

    return;
  } catch (error: any) {
    console.error('Webhook error:', error);
    await createAuditLog('WEBHOOK_ERROR', error.message, clientId, {
      payloadSummary: { keys: Object.keys(payload || {}) },
      error: error.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/bland', async (req: Request, res: Response) => {
  const payload = req.body;

  try {
    const callId = payload.call_id;
    if (!callId) {
      console.error('No call_id in Bland webhook payload');
      res.status(400).json({ error: 'call_id required' });
      return;
    }

    const call = await prisma.call.findUnique({
      where: { providerCallId: callId },
      include: { lead: true },
    });

    if (!call) {
      console.error(`Call not found for provider ID: ${callId}`);
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

    await prisma.lead.update({
      where: { id: call.leadId },
      data: {
        callStatus: leadStatus,
      },
    });

    await createAuditLog('CALL_UPDATED', `Call status updated to ${callStatus}`, call.clientId, {
      callId: call.id,
      leadId: call.leadId,
      status: callStatus,
    });

    res.status(200).json({ message: 'Webhook processed' });
  } catch (error: any) {
    console.error('Bland webhook error:', error);
    await createAuditLog('WEBHOOK_ERROR', error.message, undefined, { payload, error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
