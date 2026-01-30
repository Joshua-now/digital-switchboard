import * as bland from './bland.js';
import * as vapi from './vapi.js';

export type CallProvider = 'BLAND' | 'VAPI';

export async function createCall(
  provider: CallProvider,
  leadId: string,
  clientId: string,
  phone: string,
  instructions: string,
  transferNumber?: string
): Promise<{ success: boolean; callId?: string; error?: string }> {
  switch (provider) {
    case 'BLAND':
      return bland.createCall(leadId, clientId, phone, instructions, transferNumber);
    case 'VAPI':
      return vapi.createCall(leadId, clientId, phone, instructions, transferNumber);
    default:
      return { success: false, error: `Unknown provider: ${provider}` };
  }
}
