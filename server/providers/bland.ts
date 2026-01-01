import { prisma } from '../lib/db.js';
import { createAuditLog } from '../lib/audit.js';

interface BlandCallRequest {
  phone_number: string;
  task: string;

  // Optional knobs supported by Bland
  persona_id?: string;
  voice?: string;
  from?: string;

  transfer_phone_number?: string;
  webhook?: string;
  webhook_events?: string[];

  wait_for_greeting?: boolean;
  record?: boolean;

  // Useful for tying the webhook back to your objects
  metadata?: Record<string, any>;
  request_data?: Record<string, any>;
}

interface BlandCallResponse {
  status?: string;
  call_id?: string;
  message?: string;
  error?: string;
}

function normalizeBaseUrl(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\/+$/, ''); // remove trailing slashes
  if (!trimmed.startsWith('https://')) return null;
  // IMPORTANT: raw must be ONLY the domain, no /webhook/bland suffix
  if (trimmed.includes('/webhook')) return null;
  return trimmed;
}

export async function createCall(
  leadId: string,
  clientId: string,
  phone: string,
  instructions: string,
  transferNumber?: string
): Promise<{ success: boolean; callId?: string; error?: string }> {
  const apiKey = (process.env.BLAND_API_KEY || '').trim();

  const baseUrl = normalizeBaseUrl(process.env.BASE_URL);
  if (!apiKey) {
    const msg = 'BLAND_API_KEY not configured';
    console.error(msg);
    await createAuditLog('CALL_FAILED', msg, clientId, { leadId, phone });
    return { success: false, error: msg };
  }

  if (!baseUrl) {
    const msg =
      'BASE_URL must be set to ONLY the domain and start with https:// (e.g. https://digital-switchboard-production.up.railway.app)';
    console.error(msg, { BASE_URL: process.env.BASE_URL });
    await createAuditLog('CALL_FAILED', msg, clientId, {
      leadId,
      phone,
      BASE_URL: process.env.BASE_URL,
    });
    return { success: false, error: msg };
  }

  const webhookUrl = `${baseUrl}/webhook/bland`;

  // ✅ These are how you force “Anna”
  const personaId = (process.env.BLAND_PERSONA_ID || '').trim() || undefined;
  const voice = (process.env.BLAND_VOICE || '').trim() || undefined;

  try {
    const call = await prisma.call.create({
      data: {
        clientId,
        leadId,
        provider: 'BLAND',
        status: 'CREATED',
      },
    });

    const payload: BlandCallRequest = {
      phone_number: phone,
      task: instructions,

      // Force the correct agent behavior
      persona_id: personaId,
      voice,

      webhook: webhookUrl,

      // Only send events you care about (safe defaults)
      webhook_events: ['completed', 'failed'],

      wait_for_greeting: true,
      record: true,

      // Helps you debug + correlate in webhooks without guessing
      metadata: {
        leadId,
        clientId,
        internalCallId: call.id,
      },
      request_data: {
        leadId,
        clientId,
      },
    };

    if (transferNumber) payload.transfer_phone_number = transferNumber;

    console.log('[BLAND] sending call', {
      phone,
      webhookUrl,
      persona_id: payload.persona_id,
      voice: payload.voice,
      hasTransfer: !!transferNumber,
    });

    const response = await fetch('https://api.bland.ai/v1/calls', {
      method: 'POST',
      headers: {
        // Bland docs show `authorization` header. :contentReference[oaicite:1]{index=1}
        authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    let data: BlandCallResponse = {};
    try {
      data = rawText ? (JSON.parse(rawText) as BlandCallResponse) : {};
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
        data: { callStatus: 'CALLING' },
      });

      await createAuditLog('CALL_INITIATED', `Call initiated to ${phone}`, clientId, {
        leadId,
        internalCallId: call.id,
        providerCallId: data.call_id,
        webhookUrl,
        personaId: payload.persona_id,
        voice: payload.voice,
      });

      return { success: true, callId: data.call_id };
    }

    const errMsg =
      data.error || data.message || `Call creation failed (HTTP ${response.status})`;

    await prisma.call.update({
      where: { id: call.id },
      data: { status: 'FAILED', outcome: errMsg },
    });

    await prisma.lead.update({
      where: { id: leadId },
      data: { callStatus: 'FAILED', skipReason: errMsg },
    });

    await createAuditLog('CALL_FAILED', `Call failed: ${errMsg}`, clientId, {
      leadId,
      internalCallId: call.id,
      httpStatus: response.status,
      webhookUrl,
      response: data,
    });

    return { success: false, error: errMsg };
  } catch (error: any) {
    console.error('Bland API error:', error);

    await createAuditLog('CALL_ERROR', `Call error: ${error.message}`, clientId, {
      leadId,
      phone,
      error: error.message,
    });

    return { success: false, error: error.message };
  }
}
