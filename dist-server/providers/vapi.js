import { prisma } from '../lib/db.js';
import { createAuditLog } from '../lib/audit.js';
export async function createCall(leadId, clientId, phone, instructions, transferNumber, firstName) {
    const apiKey = process.env.VAPI_API_KEY;
    const assistantId = process.env.VAPI_ASSISTANT_ID;
    const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    if (!apiKey) {
        console.error('VAPI_API_KEY not configured');
        await createAuditLog('CALL_FAILED', 'VAPI API key not configured', clientId, { leadId, phone });
        return { success: false, error: 'VAPI API key not configured' };
    }
    if (!assistantId) {
        console.error('VAPI_ASSISTANT_ID not configured');
        await createAuditLog('CALL_FAILED', 'VAPI assistant ID not configured', clientId, { leadId, phone });
        return { success: false, error: 'VAPI assistant ID not configured' };
    }
    try {
        const call = await prisma.call.create({
            data: {
                clientId,
                leadId,
                provider: 'VAPI',
                status: 'CREATED',
            },
        });
        const payload = {
            assistantId,
            customer: { number: phone },
            ...(phoneNumberId ? { phoneNumberId } : {}),
            assistantOverrides: {
                firstMessage: firstName ? `Hello ${firstName}! ` : undefined,
                model: {
                    messages: [
                        {
                            role: 'system',
                            content: instructions,
                        },
                    ],
                },
                ...(transferNumber ? {
                    endCallFunctionEnabled: false,
                    transferCallMessage: 'Please hold, transferring you now.',
                    transferDestination: { type: 'phoneNumber', phoneNumber: transferNumber },
                } : {}),
            },
            serverUrl: `${baseUrl}/webhook/vapi`,
        };
        const response = await fetch('https://api.vapi.ai/call/phone', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        const data = await response.json();
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
            await createAuditLog('CALL_INITIATED', `VAPI call initiated to ${phone}`, clientId, {
                leadId, callId: call.id, providerCallId: data.id,
            });
            return { success: true, callId: data.id };
        }
        else {
            const errMsg = data.message || data.error || 'Unknown VAPI error';
            await prisma.call.update({
                where: { id: call.id },
                data: { status: 'FAILED', outcome: errMsg },
            });
            await prisma.lead.update({
                where: { id: leadId },
                data: { callStatus: 'FAILED', skipReason: errMsg },
            });
            await createAuditLog('CALL_FAILED', `VAPI call failed: ${errMsg}`, clientId, {
                leadId, callId: call.id, error: data,
            });
            return { success: false, error: errMsg };
        }
    }
    catch (error) {
        console.error('VAPI API error:', error);
        await createAuditLog('CALL_ERROR', `VAPI call error: ${error.message}`, clientId, {
            leadId, phone, error: error.message,
        });
        return { success: false, error: error.message };
    }
}
