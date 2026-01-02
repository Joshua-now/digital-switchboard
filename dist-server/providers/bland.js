import { prisma } from '../lib/db.js';
import { createAuditLog } from '../lib/audit.js';

/**
 * Bland requires HTTPS webhooks.
 * Normalize BASE_URL to:
 * - must exist
 * - must start with https://
 * - no trailing slashes
 */
function normalizeBaseUrl(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim().replace(/\/+$/, '');
  if (!trimmed.startsWith('https://')) return null;
  return trimmed;
}

/**
 * Avoid dumping giant payloads into DB/logs.
 * Keep only small, safe fields.
 */
function sanitizeForLogs(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  const out = { ...obj };

  // Common “big” fields from Bland / LLM-style payloads
  if ('decision' in out) out.decision = '[omitted]';
  if ('transcript' in out && typeof out.transcript === 'string') {
    out.transcript = out.transcript.slice(0, 500) + (out.transcript.length > 500 ? '…' : '');
  }
  if ('transcripts' in out) out.transcripts = '[omitted]';
  if ('conversation' in out) out.conversation = '[omitted]';
  if ('messages' in out) out.messages = '[omitted]';

  // Prevent runaway nested objects
  try {
    const s = JSON.stringify(out);
    if (s.length > 3000) return { note: 'payload omitted (too large)', keys: Object.keys(out) };
  } catch {
    return { note: 'payload omitted (non-serializable)', keys: Object.keys(out) };
  }

  return out;
}

export async function createCall(leadId, clientId, phone, instructions, transferNumber) {
  const apiKeyRaw = (process.env.BLAND_API_KEY || '').trim();

  // Require https BASE_URL for webhook
  const normalizedBaseUrl = normalizeBaseUrl(process.env.BASE_URL);
  const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();

  // Optional: persona + voice (only if you want to force them via API)
  const personaId = (process.env.BLAND_PERSONA_ID || '').trim() || undefined;
  const voice = (process.env.BLAND_VOICE || '').trim() || undefined;

  if (!apiKeyRaw || apiKeyRaw === 'your_bland_api_key_here') {
    console.error('BLAND_API_KEY not configured');
    await createAuditLog('CALL_FAILED', 'Bland API key not configured', clientId, { leadId, phone });
    return { success: false, error: 'API key not configured' };
  }

  if (!normalizedBaseUrl) {
    const msg =
      'BASE_URL must be set and start with https:// (e.g. https://digital-switchboard-production.up.railway.app)';
    console.error(msg, { BASE_URL: process.env.BASE_URL });

    await createAuditLog('CALL_FAILED', msg, clientId, {
      leadId,
      phone,
      baseUrl: process.env.BASE_URL,
      env: nodeEnv,
    });

    return { success: false, error: msg };
  }

  // Build webhook URL
  const webhookUrl = `${normalizedBaseUrl}/webhook/bland`;

  // Fix Authorization format
  const authorization = apiKeyRaw.startsWith('Bearer ') ? apiKeyRaw : `Bearer ${apiKeyRaw}`;

  // Guard: transfer number cannot equal the called number
  const cleanTransfer =
    transferNumber && String(transferNumber).trim() !== String(phone).trim()
      ? String(transferNumber).trim()
      : undefined;

  if (transferNumber && !cleanTransfer) {
    // Don’t fail the whole call; just skip transfer so the call can still run.
    await createAuditLog(
      'CALL_WARNING',
      'Transfer number matched lead phone; transfer disabled for this call',
      clientId,
      { leadId, phone, transferNumber }
    );
  }

  try {
    // Create internal call record
    const call = await prisma.call.create({
      data: {
        clientId,
        leadId,
        provider: 'BLAND',
        status: 'CREATED',
      },
    });

    // Build request payload
    const payload = {
      phone_number: phone,
      task: instructions,
      webhook: webhookUrl,
      wait_for_greeting: true,
      record: true,
    };

    if (personaId) payload.persona_id = personaId;
    if (voice) payload.voice = voice;
    if (cleanTransfer) payload.transfer_phone_number = cleanTransfer;

    // Minimal safe log (avoid giant spam)
    console.log('[BLAND] sending call', {
      phone,
      webhookUrl,
      persona_id: personaId,
      voice,
      hasTransfer: Boolean(cleanTransfer),
    });

    const response = await fetch('https://api.bland.ai/v1/calls', {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    // Parse safely (Bland sometimes returns non-JSON on error)
    const rawText = await response.text();
    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = { error: rawText || 'Non-JSON response from Bland' };
    }

    if (response.ok && data.call_id) {
      await prisma.call.update({
        where: { id: call.id },
        data: {
          providerCallId: data.call_id,
          status: 'IN_PROGRESS',
          startedAt: new Date(),
        },
      });

      await prisma.lead.update({
        where: { id: leadId },
        data: {
          callStatus: 'CALLING',
        },
      });

      await createAuditLog('CALL_INITIATED', `Call initiated to ${phone}`, clientId, {
        leadId,
        callId: call.id,
        providerCallId: data.call_id,
        webhookUrl,
        hasTransfer: Boolean(cleanTransfer),
      });

      return { success: true, callId: data.call_id };
    }

    // Failure path — keep it small
    const errMsg = data.error || data.message || `Call creation failed (HTTP ${response.status})`;

    await prisma.call.update({
      where: { id: call.id },
      data: {
        status: 'FAILED',
        outcome: errMsg,
      },
    });

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        callStatus: 'FAILED',
        skipReason: errMsg,
      },
    });

    await createAuditLog('CALL_FAILED', `Call failed: ${errMsg}`, clientId, {
      leadId,
      callId: call.id,
      httpStatus: response.status,
      webhookUrl,
      response: sanitizeForLogs(data),
    });

    return { success: false, error: errMsg };
  } catch (error) {
    console.error('Bland API error:', error);

    await createAuditLog('CALL_ERROR', `Call error: ${error.message}`, clientId, {
      leadId,
      phone,
      error: error.message,
    });

    return { success: false, error: error.message };
  }
}
