import { prisma } from '../lib/db.js';
import { createAuditLog } from '../lib/audit.js';

interface VapiCallRequest {
  phoneNumberId?: string;
  customer: {
    number: string;
  };
  assistantId?: string;
  assistant?: {
    model: {
      provider: string;
      model: string;
      messages: Array<{
        role: string;
        content: string;
      }>;
    };
    voice: {
      provider: string;
      voiceId: string;
    };
    firstMessage?: string;
  };
  assistantOverrides?: {
    variableValues?: Record<string, any>;
    recordingEnabled?: boolean;
    endCallFunctionEnabled?: boolean;
  };
  metadata?: Record<string, any>;
}

interface VapiCallResponse {
  id?: string;
  status?: string;
  error?: string;
  message?: string;
}

function normalizeBaseUrl(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed.startsWith('https://')) return null;
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
  const apiKey = (process.env.VAPI_API_KEY || '').trim();
  const assistantId = (process.env.VAPI_ASSISTANT_ID || '').trim();
  const phoneNumberId = (process.env.VAPI_PHONE_NUMBER_ID || '').trim();

  const baseUrl = normalizeBaseUrl(process.env.BASE_URL);

  if (!apiKey) {
    const msg = 'VAPI_API_KEY not configured';
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

  const webhookUrl = `${baseUrl}/webhook/vapi`;

  try {
    const call = await prisma.call.create({
      data: {
        clientId,
        leadId,
        provider: 'VAPI',
        status: 'CREATED',
      },
    });

    const payload: VapiCallRequest = {
      customer: {
        number: phone,
      },
      metadata: {
        leadId,
        clientId,
        internalCallId: call.id,
      },
    };

    // Add phone number if configured
    if (phoneNumberId) {
      payload.phoneNumberId = phoneNumberId;
    }

    // Use either pre-configured assistant or create dynamic one
    if (assistantId) {
      payload.assistantId = assistantId;
      payload.assistantOverrides = {
        variableValues: {
          instructions,
          transferNumber: transferNumber || '',
        },
        recordingEnabled: true,
        endCallFunctionEnabled: true,
      };
    } else {
      // Dynamic assistant configuration
      payload.assistant = {
        model: {
          provider: 'openai',
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: instructions,
            },
          ],
        },
        voice: {
          provider: 'elevenlabs',
          voiceId: process.env.VAPI_VOICE_ID || '21m00Tcm4TlvDq8ikWAM', // Default Rachel voice
        },
        firstMessage: 'Hello! How can I help you today?',
      };
    }

    console.log('[VAPI] sending call', {
      phone,
      webhookUrl,
      assistantId: payload.assistantId,
      hasTransfer: !!transferNumber,
    });

    const response = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    let data: VapiCallResponse = {};
    try {
      data = rawText ? (JSON.parse(rawText) as VapiCallResponse) : {};
    } catch {
      data = { error: rawText || 'Non-JSON response from Vapi' };
    }

    if (response.ok && data.id) {
      await prisma.call.update({
        where: { id: call.id },
        data: {
          providerCallId: data.id,
          status: 'IN_PROGRESS',
          startedAt: new Date(),
        },
      });

      await prisma.lead.update({
        where: { id: leadId },
        data: { callStatus: 'CALLING' },
      });

      await createAuditLog('CALL_INITIATED', `Vapi call initiated to ${phone}`, clientId, {
        leadId,
        internalCallId: call.id,
        providerCallId: data.id,
        webhookUrl,
        assistantId: payload.assistantId,
      });

      return { success: true, callId: data.id };
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

    await createAuditLog('CALL_FAILED', `Vapi call failed: ${errMsg}`, clientId, {
      leadId,
      internalCallId: call.id,
      httpStatus: response.status,
      webhookUrl,
      response: data,
    });

    return { success: false, error: errMsg };
  } catch (error: any) {
    console.error('Vapi API error:', error);

    await createAuditLog('CALL_ERROR', `Vapi call error: ${error.message}`, clientId, {
      leadId,
      phone,
      error: error.message,
    });

    return { success: false, error: error.message };
  }
}
