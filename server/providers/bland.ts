import { prisma } from '../lib/db.js';
import { createAuditLog } from '../lib/audit.js';

interface BlandCallRequest {
  phone_number: string;
  task: string;
  transfer_phone_number?: string;
  webhook?: string;
  wait_for_greeting?: boolean;
  record?: boolean;
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

  // Require https BASE_URL (Bland webhook requirement)
  const normalizedBaseUrl = normalizeBaseUrl(process.env.BASE_URL);
  const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();

  if (!apiKey || apiKey === 'your_bland_api_key_here') {
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

  const webhookUrl = `${normalizedBaseUrl}/webhook/bland`;
  console.log('[BLAND] using webhook', { webhookUrl });

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
      webhook: webhookUrl,
      wait_for_greeting: true,
      record: true,
    };

    if (transferNumber) payload.transfer_phone_number = transferNumber;

    const response = await fetch('https://api.bland.ai/v1/calls', {
      method: 'POST',
      headers: {
        // Many APIs accept either raw key or Bearer; Bearer is safer/standard.
        Authorization: apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`,
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
        data: {
          callStatus: 'CALLING',
        },
      });

      await createAuditLog('CALL_INITIATED', `Call initiated to ${phone}`, clientId, {
        leadId,
        callId: call.id,
        providerCallId: data.call_id,
        webhookUrl,
      });

      return { success: true, callId: data.call_id };
    }

    // Failure path
    const errMsg =
      data.error ||
      data.message ||
      `Call creation failed (HTTP ${response.status})`;

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
