import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/db.js';
import { normalizePhone, isWithinQuietHours, generateDedupeKey } from '../lib/utils.js';
import { createAuditLog } from '../lib/audit.js';
import { createCall } from '../providers/index.js';

const router = express.Router();

const MAX_BODY_CHARS = Number(process.env.WEBHOOK_MAX_BODY_CHARS || 8000);

/**
 * Make a small, safe snapshot of an inbound payload so we don't store megabytes of data.
 */
function safePayloadSnapshot(payload: any) {
  if (!payload) return null;

  try {
    const s = JSON.stringify(payload);
    if (s.length <= MAX_BODY_CHARS) return payload;

    return {
      note: 'payload truncated',
      approxSize: s.length,
      keys: Object.keys(payload || {}),
      preview: s.slice(0, 1000) + '…[TRUNCATED]',
    };
  } catch {
    return { note: 'payload omitted (non-serializable)', keys: Object.keys(payload || {}) };
  }
}

/**
 * Constant-time string compare.
 */
function safeEqual(a: string, b: string) {
  const aBuf = Buffer.from(a || '', 'utf8');
  const bBuf = Buffer.from(b || '', 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Optional simple shared-secret check (header equality).
 * Use this if the provider supports "static secret header" style.
 */
function verifyStaticSecret(req: Request, envVarName: string, headerName: string) {
  const expected = process.env[envVarName];
  if (!expected) return true; // allow if not configured (dev mode)

  const provided = String(req.headers[headerName] || '');
  return safeEqual(provided, expected);
}

/**
 * Parse lead fields from common GoHighLevel webhook shapes.
 */
function parseGhlLead(payload: any) {
  const contactId =
    payload?.contactId ||
    payload?.contact?.id ||
    payload?.data?.contactId ||
    payload?.data?.contact?.id ||
    null;

  const rawPhone =
    payload?.phone ||
    payload?.phoneNumber ||
    payload?.contact?.phone ||
    payload?.contact?.phoneNumber ||
    payload?.contact?.phoneNumberRaw ||
    payload?.data?.phone ||
    payload?.data?.phoneNumber ||
    payload?.data?.contact?.phone ||
    null;

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
  const timestamp = payload?.timestamp ?? payload?.data?.timestamp ?? null;

  return { contactId, rawPhone, firstName, lastName, email, source, timestamp };
}

/**
 * Best-effort age in seconds from timestamp (ISO string or epoch).
 * Returns null if missing/unparseable.
 */
function ageSeconds(timestamp: any): number | null {
  if (!timestamp) return null;

  const d =
    typeof timestamp === 'number'
      ? new Date(timestamp > 1e12 ? timestamp : timestamp * 1000)
      : new Date(String(timestamp));

  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 1000);
}

/**
 * ✅ Route existence / ping (helps prove mounting is correct in Railway)
 * Visit: GET https://<BASE_URL>/webhook/bland
 */
router.get('/bland', (_req: Request, res: Response) => {
  return res.status(200).json({ ok: true, route: '/webhook/bland' });
});

// Optional: some services do a HEAD probe
router.head('/bland', (_req: Request, res: Response) => {
  return res.status(200).end();
});

router.post('/gohighlevel/:clientId', async (req: Request, res: Response) => {
  const { clientId } = req.params;
  const payload = req.body;

  try {
    // 🔐 Optional shared-secret auth (recommended in prod)
    // Set GHL_WEBHOOK_SECRET and configure GHL to send header x-webhook-secret
    if (!verifyStaticSecret(req, 'GHL_WEBHOOK_SECRET', 'x-webhook-secret')) {
      await createAuditLog('WEBHOOK_FORBIDDEN', 'Invalid GHL webhook secret', clientId, {
        clientId,
        ip: req.ip,
        payloadKeys: Object.keys(payload || {}),
      });
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Load client + active routing config
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        routingConfigs: { where: { active: true }, take: 1 },
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

    // Parse lead
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

    // Dedupe
    const dedupeKey = generateDedupeKey(leadData.contactId ?? undefined, phone);
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

    // Create lead (✅ store safe snapshot, not the full payload)
    const lead = await prisma.lead.create({
      data: {
        clientId,
        firstName: leadData.firstName,
        lastName: leadData.lastName,
        phone,
        email: leadData.email,
        source: leadData.source,
        payloadJson: safePayloadSnapshot(payload),
        dedupeKey,
        callStatus: 'NEW',
      },
    });

    await createAuditLog('LEAD_CREATED', 'Lead created', clientId, { leadId: lead.id, phone });

    // Quiet hours policy:
    // - If it's an immediate webhook (fresh / no timestamp), bypass quiet hours
    // - If it's older, respect quiet hours
    const immediateWindow = Number(process.env.IMMEDIATE_WINDOW_SECONDS ?? 300);
    const a = ageSeconds(leadData.timestamp);
    const isImmediate = a === null ? true : a >= 0 && a <= immediateWindow;

    if (
      !isImmediate &&
      isWithinQuietHours(client.timezone, client.quietHoursStart, client.quietHoursEnd)
    ) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { callStatus: 'SKIPPED', skipReason: 'Quiet hours' },
      });

      await createAuditLog('CALL_SKIPPED', 'Quiet hours (non-immediate lead)', clientId, {
        leadId: lead.id,
        ageSeconds: a,
      });

      return res.status(200).json({ message: 'Skipped (quiet hours)', leadId: lead.id });
    }

    // Call immediately (no timers)
    await prisma.lead.update({
      where: { id: lead.id },
      data: { callStatus: 'QUEUED' },
    });

    const callResult = await createCall(
      routingConfig.provider || 'BLAND',
      lead.id,
      clientId,
      phone,
      routingConfig.instructions,
      routingConfig.transferNumber || undefined
    );

    // Safe log (no secrets)
    console.log('[CALL] createCall result', {
      leadId: lead.id,
      success: callResult.success,
      callId: callResult.callId,
      error: callResult.error,
    });

    if (callResult.success) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { callStatus: 'CALLING' },
      });

      await createAuditLog('CALL_INITIATED', 'Call initiated', clientId, {
        leadId: lead.id,
        providerCallId: callResult.callId,
      });

      return res.status(200).json({
        message: 'Lead received and call initiated',
        leadId: lead.id,
        immediate: isImmediate,
        callId: callResult.callId,
      });
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: { callStatus: 'FAILED', skipReason: callResult.error || 'Call failed' },
    });

    await createAuditLog('CALL_FAILED', 'Call failed to initiate', clientId, {
      leadId: lead.id,
      error: callResult.error,
    });

    return res.status(200).json({
      message: 'Lead received but call failed',
      leadId: lead.id,
      immediate: isImmediate,
      error: callResult.error,
    });
  } catch (error: any) {
    console.error('Webhook error:', error);
    await createAuditLog('WEBHOOK_ERROR', error.message, clientId, {
      payloadKeys: Object.keys(payload || {}),
      error: error.message,
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Bland status webhook (called by Bland after call events)
 * Accept both call_id and callId just in case.
 */
router.post('/bland', async (req: Request, res: Response) => {
  const payload = req.body;

  try {
    // 🔐 Optional shared-secret auth (recommended in prod)
    // Set BLAND_WEBHOOK_SECRET and configure Bland to send header x-webhook-secret
    if (!verifyStaticSecret(req, 'BLAND_WEBHOOK_SECRET', 'x-webhook-secret')) {
      await createAuditLog('WEBHOOK_FORBIDDEN', 'Invalid Bland webhook secret', undefined, {
        ip: req.ip,
        payloadKeys: Object.keys(payload || {}),
      });
      return res.status(403).json({ error: 'Forbidden' });
    }

    const providerCallId = payload?.call_id || payload?.callId;
    if (!providerCallId) return res.status(400).json({ error: 'call_id required' });

    const call = await prisma.call.findUnique({
      where: { providerCallId: providerCallId },
      include: { lead: true },
    });

    if (!call) return res.status(404).json({ error: 'Call not found' });

    // ✅ Idempotency: if already terminal, ignore retries
    if (call.status === 'COMPLETED' || call.status === 'FAILED') {
      return res.status(200).json({ message: 'Already processed' });
    }

    const status = String(payload?.status || '').toLowerCase();

    const callStatus: 'CREATED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' =
      status === 'completed' || payload?.completed
        ? 'COMPLETED'
        : status === 'failed' || payload?.error
        ? 'FAILED'
        : 'IN_PROGRESS';

    const leadStatus: 'NEW' | 'QUEUED' | 'CALLING' | 'COMPLETED' | 'FAILED' | 'SKIPPED' =
      callStatus === 'COMPLETED' ? 'COMPLETED' : callStatus === 'FAILED' ? 'FAILED' : 'CALLING';

    // ✅ Store safe snapshot only (no giant prompt dumps)
    const providerSnapshot = safePayloadSnapshot(payload);

    await prisma.call.update({
      where: { id: call.id },
      data: {
        status: callStatus,
        outcome: payload?.outcome || payload?.call_length || null,
        transcript: payload?.transcript || payload?.transcripts?.[0]?.text || null,
        recordingUrl: payload?.recording_url || null,
        rawProviderPayload: providerSnapshot,
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
    await createAuditLog('WEBHOOK_ERROR', error.message, undefined, {
      payloadKeys: Object.keys(payload || {}),
      error: error.message,
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Vapi status webhook (called by Vapi after call events)
 */
router.post('/vapi', async (req: Request, res: Response) => {
  const payload = req.body;

  try {
    // 🔐 Optional shared-secret auth (recommended in prod)
    if (!verifyStaticSecret(req, 'VAPI_WEBHOOK_SECRET', 'x-webhook-secret')) {
      await createAuditLog('WEBHOOK_FORBIDDEN', 'Invalid Vapi webhook secret', undefined, {
        ip: req.ip,
        payloadKeys: Object.keys(payload || {}),
      });
      return res.status(403).json({ error: 'Forbidden' });
    }

    const providerCallId = payload?.call?.id || payload?.id;
    if (!providerCallId) return res.status(400).json({ error: 'call id required' });

    const call = await prisma.call.findUnique({
      where: { providerCallId: providerCallId },
      include: { lead: true },
    });

    if (!call) return res.status(404).json({ error: 'Call not found' });

    // ✅ Idempotency: if already terminal, ignore retries
    if (call.status === 'COMPLETED' || call.status === 'FAILED') {
      return res.status(200).json({ message: 'Already processed' });
    }

    const messageType = payload?.message?.type || '';
    const callStatus: 'CREATED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' =
      messageType === 'end-of-call-report'
        ? 'COMPLETED'
        : messageType === 'status-update' && payload?.message?.status === 'ended'
        ? 'COMPLETED'
        : payload?.message?.status === 'failed'
        ? 'FAILED'
        : 'IN_PROGRESS';

    const leadStatus: 'NEW' | 'QUEUED' | 'CALLING' | 'COMPLETED' | 'FAILED' | 'SKIPPED' =
      callStatus === 'COMPLETED' ? 'COMPLETED' : callStatus === 'FAILED' ? 'FAILED' : 'CALLING';

    // ✅ Store safe snapshot only
    const providerSnapshot = safePayloadSnapshot(payload);

    const transcript = payload?.message?.transcript
      ? payload.message.transcript.map((t: any) => `${t.role}: ${t.text}`).join('\n')
      : payload?.transcript || null;

    await prisma.call.update({
      where: { id: call.id },
      data: {
        status: callStatus,
        outcome: payload?.message?.endedReason || payload?.endedReason || null,
        transcript,
        recordingUrl: payload?.message?.recordingUrl || payload?.recordingUrl || null,
        rawProviderPayload: providerSnapshot,
        endedAt: callStatus === 'COMPLETED' || callStatus === 'FAILED' ? new Date() : null,
      },
    });

    await prisma.lead.update({
      where: { id: call.leadId },
      data: { callStatus: leadStatus },
    });

    await createAuditLog('CALL_UPDATED', `Vapi call status updated: ${callStatus}`, call.clientId, {
      callId: call.id,
      leadId: call.leadId,
      status: callStatus,
    });

    return res.status(200).json({ message: 'Webhook processed' });
  } catch (error: any) {
    console.error('Vapi webhook error:', error);
    await createAuditLog('WEBHOOK_ERROR', error.message, undefined, {
      payloadKeys: Object.keys(payload || {}),
      error: error.message,
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
