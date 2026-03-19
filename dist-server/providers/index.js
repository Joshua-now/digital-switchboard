import * as bland from './bland.js';
import * as vapi from './vapi.js';
export async function createCall(provider, leadId, clientId, phone, instructions, transferNumber) {
    switch (provider) {
        case 'BLAND':
            return bland.createCall(leadId, clientId, phone, instructions, transferNumber);
        case 'VAPI':
            return vapi.createCall(leadId, clientId, phone, instructions, transferNumber);
        default:
            return { success: false, error: `Unknown provider: ${provider}` };
    }
}
