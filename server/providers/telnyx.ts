import axios from 'axios';

const TELNYX_API_KEY      = process.env.TELNYX_API_KEY!;
const TELNYX_PHONE_NUMBER = process.env.TELNYX_PHONE_NUMBER || '+13217324521';
const TELNYX_APP_ID       = process.env.TELNYX_APP_ID      || '2917724292919592884';
const TELNYX_ASSISTANT_ID = process.env.TELNYX_ASSISTANT_ID || 'assistant-76aa79cf-b607-4642-89d9-ce8142d7d21d';
const BASE_URL            = process.env.BASE_URL!;

const api = axios.create({
  baseURL: 'https://api.telnyx.com/v2',
  headers: {
    Authorization: `Bearer ${TELNYX_API_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

/**
 * Makes an outbound AI call via Telnyx TeXML AI Calls endpoint.
 *
 * Uses /texml/ai_calls/{connection_id} which is the correct Telnyx endpoint
 * for outbound AI calls. The AIAssistantId param tells Telnyx which assistant
 * to use — it auto-starts the conversation when the call is answered.
 *
 * Lead/client IDs are embedded in the StatusCallbackUrl query string so we
 * can correlate status events back to DB records.
 */
export async function makeTelnyxCall(
  phone: string,
  instructions: string | null,
  transferNumber: string | null,
  leadId: string,
  clientId: string,
  internalCallId: string,
  firstName?: string,
  assistantId?: string
): Promise<{ callId: string; status: string }> {
  if (!TELNYX_API_KEY) throw new Error('TELNYX_API_KEY not set');

  const resolvedAssistantId = assistantId || TELNYX_ASSISTANT_ID;

  // Encode IDs in callback URL query params — TeXML callbacks don't support client_state
  const callbackUrl = `${BASE_URL}/webhook/telnyx?leadId=${encodeURIComponent(leadId)}&clientId=${encodeURIComponent(clientId)}&callId=${encodeURIComponent(internalCallId)}`;

  const response = await api.post(`/texml/ai_calls/${TELNYX_APP_ID}`, {
    From: TELNYX_PHONE_NUMBER,
    To: phone,
    AIAssistantId: resolvedAssistantId,
    StatusCallbackUrl: callbackUrl,
    StatusCallbackMethod: 'POST',
  });

  // TeXML response uses CallSid; fall back to call_control_id if present
  const callId =
    (response.data?.CallSid as string) ||
    (response.data?.data?.CallSid as string) ||
    (response.data?.data?.call_control_id as string);

  if (!callId) {
    throw new Error('No call ID in Telnyx TeXML AI response');
  }

  return { callId, status: 'CREATED' };
}

/** Dial an outbound call leg for warm transfer AMD flow (no AI — just a regular call) */
export async function dialOutbound(
  to: string,
  clientReferenceId: string,
  webhookUrl: string
): Promise<string> {
  const response = await api.post('/calls', {
    connection_id: TELNYX_APP_ID,
    to,
    from: TELNYX_PHONE_NUMBER,
    answering_machine_detection: 'premium',
    client_reference_id: clientReferenceId,
    webhook_url: webhookUrl,
    webhook_url_method: 'POST',
  });
  const ccid = response.data?.data?.call_control_id as string;
  if (!ccid) throw new Error('No call_control_id from outbound dial');
  return ccid;
}

/** Play TTS on an active call leg (used for whisper to contractor) */
export async function speakOnCall(callControlId: string, text: string): Promise<void> {
  await api.post(`/calls/${callControlId}/actions/speak`, {
    payload: text,
    payload_type: 'text',
    voice: 'female',
    language: 'en-US',
  });
}

/** Bridge two call legs together (warm transfer completion) */
export async function bridgeCalls(callControlId: string, otherCallControlId: string): Promise<void> {
  await api.post(`/calls/${callControlId}/actions/bridge`, {
    call_control_id: otherCallControlId,
  });
}

/** Hang up a call leg */
export async function hangupCall(callControlId: string): Promise<void> {
  await api.post(`/calls/${callControlId}/actions/hangup`, {});
}

/**
 * Decode client_state from base64 (called in webhook handler).
 */
export function decodeTelnyxClientState(b64: string): {
  leadId: string;
  clientId: string;
  internalCallId: string;
  transferNumber: string | null;
} | null {
  try {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}
