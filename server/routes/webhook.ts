import express, { Request, Response } from 'express';
import { prisma } from '../lib/db.js';
import { normalizePhone, isWithinQuietHours, generateDedupeKey } from '../lib/utils.js';
import { createAuditLog } from '../lib/audit.js';
import { createCall } from '../providers/bland.js';

const router = express.Router();

/**
 * Extract fields from common GoHighLevel webhook shapes.
 * Keep this centralized so the handler stays clean.
 */
function parseGhlLead(payload: any) {
  const contactId =
    payload?.contactId ||
    payload?.contact?.id ||
    payload?.data?.contactId ||
    payload?.data?.contact?.id;

  const rawPhone =
    payload?.phone ||
    payload?.phoneNumber ||
    payload?.contact?.phone ||
    payload?.contact?.phoneNumber ||
    payload?.contact?.phoneNumberRaw ||
    payload?.data?.phone ||
    payload?.data?.phoneNumber ||
    payload?.data?.contact?.phone;

  const firstName =
    payload?.firstName ||
    payload?.contact?.firstName ||
    payload?.data?.firstName ||
    payload?.data?.contact?.firstName ||
    null;

  const lastName =
    payload?.lastName ||
    payload?.contact?.lastName ||
    payload?.data?.lastName ||
    payload?.data?.contact?.lastName ||
    null;

  const email =
    payload?.email ||
    payload?.contact?.email ||
    payload?.data?.email ||
    payload?.data?.contact?.email ||
    null;

  const source = payload?.source || 'gohighlevel';

  // GHL sometimes includes a timestamp but it may be missing/unreliable.
  const timestamp = payload?.timestamp ?? payload?.data?.timestamp ?? null;

  return { contactId, rawPhone, firstName, lastName, email, source, timestamp };
}

/**
 * Best-effort age-in-seconds from payload timestamp.
 * Returns null if missing/unparseable.
 */
function secondsSince(payloadTimestamp: any): number | null {
  if (!payloadTimestamp) return null;

  const d =
    typeof payloadTimestamp === 'number'
      ? new Date(payloadTimestamp > 1e12 ? payloadTimestamp : payloadTimestamp * 1000)
      : new Date(String(payloadTimestamp));

  if (Number.isNaN(d.getTime())) return null;

  return Math.floor((Date.now() - d.getTime()) / 1000);
}

router.post('/gohighlevel/:clientId', async (req: Request, res: Response) => {
  const { clientId } = req.params;
  const payload = req.body;

  try {
    // 1) Load client + routing config
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
        payloadKeys: Object.keys(payload || {}),
      });
      return res.status(404).json({ error: 'Client not found' });
    }

    if (client.status !== 'ACTIVE') {
      await createAuditLog('CALL_SKIPPED', 'Client inactive', clientId, { clientId });
      return res.status(200).json({ message: 'Client inactive - skipped' });
    }

    const routingConfig = client.routingConfigs[0];
    if (!routingConfig) {
      await createAuditLog('CALL_SKIPPED', 'No active routing config', clientId, { clientId });
      return res.status(200).json({ message: 'No routing config - skipped' });
    }

    // 2) Parse lead data
    const leadData = parseGhlLead(payload);

    if (!leadData.rawPhone) {
      await createAuditLog('WEBHOOK_ERROR', 'No phone number in payload', clientId, {
        payloadKeys: Object.keys(payload || {}),
      });
      return res.status(400).json({ error: 'Phone number required' });
    }

    const phone = normalizePhone(leadData.rawPhone);
    if (!phone) {
      await createAuditLog('WEBHOOK_ERROR', `Invalid phone: ${leadData.rawPhone}`, clientId, {
        rawPhone: leadData.rawPhone,
      });
      return res.status(400).json({ error: 'Invalid phone number' });
    }

    // 3) Dedupe (your w30 key logic lives in utils.ts)
    const dedupeKey = generateDedupeKey(leadData.contactId, phone);

    const existingLead = await prisma.lead.findUnique({
      where: { clientId_dedupeKey: { clientId, dedupeKey } },
    });

    if (existingLead) {
      await createAuditLog('WEBHOOK_DUPLICATE', 'Duplicate lead ignored', clientId, {
        leadId: existingLead.id,
        dedupeKey,
      });
      return res.status(200).json({ message: 'Duplicate ignored', leadId: existingLead.id });
    }

    // 4) Create lead
    const lead = await prisma.lead.create({
      data: {
        clientId,
        firstName: leadData.firstName,
        lastName: leadData.lastName,
        phone,
        email: leadData.email,
        source: leadData.source,
        payloadJson: payload,
        dedupeKey,
        callStatus: 'NEW',
      },
    });

    await createAuditLog('LEAD_CREATED', 'Lead created', clientId, {
      leadId: lead.id,
      phone,
    });

    // 5) Decide quiet-hours behavior
    // Speed-to-lead rule:
    // - Immediate calls (fresh submissions) bypass quiet hours
    // - Delayed calls respect quiet hours (if you ever delay)
    const IMMEDIATE_WINDOW_SECONDS = Number(process.env.IMMEDIATE_WINDOW_SECONDS ?? 300);
    const ageSeconds = secondsSince(leadData.timestamp);

    const isImmediate =
      ageSeconds === null ? true : ageSeconds >= 0 && ageSeconds <= IMMEDIATE_WINDOW_SECONDS;

    const blockedByQuietHours =
      !isImmediate &&
      isWithinQuietHours(client.timezone, client.quietHoursStart, client.quietHoursEnd);

    if (blockedByQuietHours) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { callStatus: 'SKIPPED', skipReason: 'Quiet hours' },
      });

      await createAuditLog('CALL_SKIPPED', 'Quiet hours (delayed call)', clientId, {
        leadId: lead.id,
        ageSeconds,
      });

      return res.status(200).json({ message: 'Skipped (quiet hours)', leadId: lead.id });
    }

    // 6) Call (immediately or after configured delay)
    await prisma.lead.update({
      where: { id: lead.id },
      data: { callStatus: 'QUEUED' },
    });

    const delaySeconds = Math.max(0, Number(routingConfig.callWithinSeconds ?? 0));

    // Respond immediately so GHL doesn't retry
    res.status(200).json({
      message: 'Lead received',
      leadId: lead.id,
      immediate: isImmediate,
      delaySeconds,
    });

    // If you want true instant speed-to-lead, set callWithinSeconds = 0
    setTimeout(async () => {
      try {
        const callResult = await createCall(
          lead.id,
          clientId,
          phone,
          routingConfig.instructions,
          routingConfig.transferNumber || undefined
        );

        if (callResult.success) {
          await createAuditLog('CALL_INITIATED', 'Call initiated', clientId, {
            leadId: lead.id,
            providerCallId: callResult.callId,
          });
        } else {
          await prisma.lead.update({
            where: { id: lead.id },
            data: { callStatus: 'FAILED', skipReason: callResult.error || 'Call failed' },
          });

          await createAuditLog('CALL_FAILED', 'Call failed to initiate', clientId, {
            leadId: lead.id,
            error: callResult.error,
          });
        }
      } catch (err: any) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { callStatus: 'FAILED', skipReason: err?.message || 'Background call error' },
        });

        await createAuditLog('CALL_ERROR', err?.message || 'Background call error', clientId, {
          leadId: lead.id,
        });
      }
    }, delaySeconds * 1000);

    return;
  } catch (error: any) {
    console.error('Webhook error:', error);
    await createAuditLog('WEBHOOK_ERROR', error.message, clientId, {
      payloadKeys: Object.keys(payload || {}),
      error: error.message,
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/bland', async (req: Request, res: Response) => {
  const payload = req.body;

  try {
    const callId = payload.call_id;
    if (!callId) {
      return res.status(400).json({ error: 'call_id required' });
    }

    const call = await prisma.call.findUnique({
      where: { providerCallId: callId },
      include: { lead: true },
    });

    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
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
      data: { callStatus: leadStatus },
    });

    await createAuditLog('CALL_UPDATED', `Call status updated: ${callStatus}`, call.clientId, {
      callId: call.id,
      leadId: call.leadId,
      status: callStatus,
    });

    return res.status(200).json({ message: 'Webhook processed' });
  } catch (error: any) {
    console.error('Bland webhook error:', error);
    await createAuditLog('WEBHOOK_ERROR', error.message, undefined, { payload, error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
