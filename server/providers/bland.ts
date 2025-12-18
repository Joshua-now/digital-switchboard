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
  status: string;
  call_id?: string;
  message?: string;
  error?: string;
}

export async function createCall(
  leadId: string,
  clientId: string,
  phone: string,
  instructions: string,
  transferNumber?: string
): Promise<{ success: boolean; callId?: string; error?: string }> {
  const apiKey = process.env.BLAND_API_KEY;
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

  if (!apiKey || apiKey === 'your_bland_api_key_here') {
    console.error('BLAND_API_KEY not configured');
    await createAuditLog(
      'CALL_FAILED',
      'Bland API key not configured',
      clientId,
      { leadId, phone }
    );
    return { success: false, error: 'API key not configured' };
  }

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
      webhook: `${baseUrl}/webhook/bland`,
      wait_for_greeting: true,
      record: true,
    };

    if (transferNumber) {
      payload.transfer_phone_number = transferNumber;
    }

    const response = await fetch('https://api.bland.ai/v1/calls', {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json() as BlandCallResponse;

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

      await createAuditLog(
        'CALL_INITIATED',
        `Call initiated to ${phone}`,
        clientId,
        { leadId, callId: call.id, providerCallId: data.call_id }
      );

      return { success: true, callId: data.call_id };
    } else {
      await prisma.call.update({
        where: { id: call.id },
        data: {
          status: 'FAILED',
          outcome: data.error || data.message || 'Unknown error',
        },
      });

      await prisma.lead.update({
        where: { id: leadId },
        data: {
          callStatus: 'FAILED',
          skipReason: data.error || data.message,
        },
      });

      await createAuditLog(
        'CALL_FAILED',
        `Call failed: ${data.error || data.message}`,
        clientId,
        { leadId, callId: call.id, error: data }
      );

      return {
        success: false,
        error: data.error || data.message || 'Call creation failed',
      };
    }
  } catch (error: any) {
    console.error('Bland API error:', error);

    await createAuditLog(
      'CALL_ERROR',
      `Call error: ${error.message}`,
      clientId,
      { leadId, phone, error: error.message }
    );

    return { success: false, error: error.message };
  }
}
