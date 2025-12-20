import express from 'express';
import { prisma } from '../lib/db.js';
import { normalizePhone, isWithinQuietHours, generateDedupeKey } from '../lib/utils.js';
import { createAuditLog } from '../lib/audit.js';
import { createCall } from '../providers/bland.js';
const router = express.Router();
router.post('/gohighlevel/:clientId', async (req, res) => {
    const { clientId } = req.params;
    const payload = req.body;
    try {
        const client = await prisma.client.findUnique({
            where: { id: clientId },
            include: {
                routingConfigs: {
                    where: { active: true },
                    take: 1,
                },
            },
        });
        if (!client) {
            await createAuditLog('WEBHOOK_ERROR', `Client not found: ${clientId}`, undefined, { clientId, payload });
            res.status(404).json({ error: 'Client not found' });
            return;
        }
        const rawPhone = payload.phone || payload.contact?.phone || payload.phoneNumber;
        if (!rawPhone) {
            await createAuditLog('WEBHOOK_ERROR', 'No phone number in payload', clientId, { payload });
            res.status(400).json({ error: 'Phone number required' });
            return;
        }
        const phone = normalizePhone(rawPhone);
        if (!phone) {
            await createAuditLog('WEBHOOK_ERROR', `Invalid phone number: ${rawPhone}`, clientId, { payload });
            res.status(400).json({ error: 'Invalid phone number' });
            return;
        }
        const contactId = payload.contactId || payload.contact?.id;
        const dedupeKey = generateDedupeKey(contactId, phone);
        const existingLead = await prisma.lead.findUnique({
            where: {
                clientId_dedupeKey: {
                    clientId,
                    dedupeKey,
                },
            },
        });
        if (existingLead) {
            await createAuditLog('WEBHOOK_DUPLICATE', `Duplicate lead ignored: ${dedupeKey}`, clientId, { leadId: existingLead.id, dedupeKey });
            res.status(200).json({ message: 'Lead already processed', leadId: existingLead.id });
            return;
        }
        const lead = await prisma.lead.create({
            data: {
                clientId,
                firstName: payload.firstName || payload.contact?.firstName || null,
                lastName: payload.lastName || payload.contact?.lastName || null,
                phone,
                email: payload.email || payload.contact?.email || null,
                source: payload.source || 'gohighlevel',
                payloadJson: payload,
                dedupeKey,
                callStatus: 'NEW',
            },
        });
        await createAuditLog('LEAD_CREATED', `New lead created: ${phone}`, clientId, {
            leadId: lead.id,
            phone,
        });
        if (client.status !== 'ACTIVE') {
            await prisma.lead.update({
                where: { id: lead.id },
                data: {
                    callStatus: 'SKIPPED',
                    skipReason: 'Client inactive',
                },
            });
            res.status(200).json({ message: 'Lead received but client inactive', leadId: lead.id });
            return;
        }
        const routingConfig = client.routingConfigs[0];
        if (!routingConfig) {
            await prisma.lead.update({
                where: { id: lead.id },
                data: {
                    callStatus: 'SKIPPED',
                    skipReason: 'No active routing config',
                },
            });
            res.status(200).json({ message: 'Lead received but no routing config', leadId: lead.id });
            return;
        }
        if (isWithinQuietHours(client.timezone, client.quietHoursStart, client.quietHoursEnd)) {
            await prisma.lead.update({
                where: { id: lead.id },
                data: {
                    callStatus: 'SKIPPED',
                    skipReason: 'Quiet hours',
                },
            });
            await createAuditLog('CALL_SKIPPED', `Call skipped due to quiet hours: ${phone}`, clientId, { leadId: lead.id });
            res.status(200).json({ message: 'Lead received but in quiet hours', leadId: lead.id });
            return;
        }
        await prisma.lead.update({
            where: { id: lead.id },
            data: {
                callStatus: 'QUEUED',
            },
        });
        const callResult = await createCall(lead.id, clientId, phone, routingConfig.instructions, routingConfig.transferNumber || undefined);
        if (callResult.success) {
            res.status(200).json({
                message: 'Lead received and call initiated',
                leadId: lead.id,
                callId: callResult.callId,
            });
        }
        else {
            res.status(200).json({
                message: 'Lead received but call failed',
                leadId: lead.id,
                error: callResult.error,
            });
        }
    }
    catch (error) {
        console.error('Webhook error:', error);
        await createAuditLog('WEBHOOK_ERROR', error.message, clientId, { payload, error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.post('/bland', async (req, res) => {
    const payload = req.body;
    try {
        const callId = payload.call_id;
        if (!callId) {
            console.error('No call_id in Bland webhook payload');
            res.status(400).json({ error: 'call_id required' });
            return;
        }
        const call = await prisma.call.findUnique({
            where: { providerCallId: callId },
            include: { lead: true },
        });
        if (!call) {
            console.error(`Call not found for provider ID: ${callId}`);
            res.status(404).json({ error: 'Call not found' });
            return;
        }
        const status = payload.status?.toLowerCase();
        let callStatus = 'IN_PROGRESS';
        let leadStatus = 'CALLING';
        if (status === 'completed' || payload.completed) {
            callStatus = 'COMPLETED';
            leadStatus = 'COMPLETED';
        }
        else if (status === 'failed' || payload.error) {
            callStatus = 'FAILED';
            leadStatus = 'FAILED';
        }
        await prisma.call.update({
            where: { id: call.id },
            data: {
                status: callStatus,
                outcome: payload.outcome || payload.call_length || null,
                transcript: payload.transcript || payload.transcripts?.[0]?.text || null,
                recordingUrl: payload.recording_url || null,
                rawProviderPayload: payload,
                endedAt: callStatus === 'COMPLETED' || callStatus === 'FAILED' ? new Date() : null,
            },
        });
        await prisma.lead.update({
            where: { id: call.leadId },
            data: {
                callStatus: leadStatus,
            },
        });
        await createAuditLog('CALL_UPDATED', `Call status updated to ${callStatus}`, call.clientId, {
            callId: call.id,
            leadId: call.leadId,
            status: callStatus,
        });
        res.status(200).json({ message: 'Webhook processed' });
    }
    catch (error) {
        console.error('Bland webhook error:', error);
        await createAuditLog('WEBHOOK_ERROR', error.message, undefined, { payload, error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});
export default router;
