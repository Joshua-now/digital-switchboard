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
 * Makes an outbound AI call via Telnyx.
 *
 * The TeXML app (TELNYX_APP_ID) is linked to the AI assistant.
 * When the call is answered Telnyx automatically starts the AI
 * conversation — no second action needed.
 *
 * client_state carries metadata back through webhook events.
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

  const clientState = Buffer.from(
    JSON.stringify({ leadId, clientId, internalCallId, transferNumber })
  ).toString('base64');

  const payload: Record<string, unknown> = {
    connection_id: TELNYX_APP_ID,
    to: phone,
    from: TELNYX_PHONE_NUMBER,
    webhook_url: `${BASE_URL}/webhook/telnyx`,
    webhook_url_method: 'POST',
    client_state: clientState,
    ai_assistant_id: assistantId || TELNYX_ASSISTANT_ID,
  };

  // Pass dynamic variables via custom headers (if assistant supports them)
  if (firstName) {
    (payload as any).custom_headers = [
      { name: 'X-First-Name', value: firstName },
    ];
  }

  const response = await api.post('/calls', payload);
  const callControlId = response.data?.data?.call_control_id as string;

  if (!callControlId) {
    throw new Error('No call_control_id in Telnyx response');
  }

  return { callId: callControlId, status: 'CREATED' };
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
