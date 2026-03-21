import express from 'express';
import { prisma } from '../lib/db.js';
import { normalizePhone, isWithinQuietHours, generateDedupeKey } from '../lib/utils.js';
import { createAuditLog } from '../lib/audit.js';
import { createCall as createBlandCall } from '../providers/bland.js';
import { createCall as createVapiCall } from '../providers/vapi.js';
import { makeTelnyxCall, decodeTelnyxClientState, dialOutbound, speakOnCall, bridgeCalls, hangupCall, } from '../providers/telnyx.js';
const pendingTransfers = new Map();
async function handleTransferLegEvent(eventType, payload) {
    const joshuaCcid = payload.call_control_id;
    const pending = pendingTransfers.get(joshuaCcid);
    console.log(`[warm-transfer] ${eventType} | joshua:${joshuaCcid} | pending:${!!pending}`);
    switch (eventType) {
        case 'call.machine.detection.ended': {
            const amdResult = payload.result; // 'human' | 'answering_machine' | 'not_sure'
            console.log(`[warm-transfer] AMD result: ${amdResult}`);
            if (amdResult === 'answering_machine') {
                await hangupCall(joshuaCcid).catch(e => console.error('[warm-transfer] hangup failed:', e.message));
                if (pending) {
                    clearTimeout(pending.timeout);
                    pendingTransfers.delete(joshuaCcid);
                    pending.resolve('unavailable');
                }
            }
            else {
                // Human (or not_sure) — play whisper
                if (pending) {
                    await speakOnCall(joshuaCcid, pending.whisperText).catch(async (e) => {
                        console.error('[warm-transfer] speak failed, bridging directly:', e.message);
                        await bridgeCalls(pending.leadCallControlId, joshuaCcid).catch(() => { });
                        clearTimeout(pending.timeout);
                        pendingTransfers.delete(joshuaCcid);
                        pending.resolve('connected');
                    });
                }
            }
            break;
        }
        case 'call.speak.ended': {
            // Whisper finished — bridge the two legs now
            if (pending) {
                await bridgeCalls(pending.leadCallControlId, joshuaCcid).catch(e => console.error('[warm-transfer] bridge failed:', e.message));
                clearTimeout(pending.timeout);
                pendingTransfers.delete(joshuaCcid);
                pending.resolve('connected');
            }
            break;
        }
        case 'call.hangup': {
            // Joshua hung up (or never answered) before we bridged
            if (pending) {
                clearTimeout(pending.timeout);
                pendingTransfers.delete(joshuaCcid);
                pending.resolve('unavailable');
            }
            break;
        }
        default:
            break;
    }
}
const router = express.Router();
// ─── Shared GHL handler — used by both per-config and per-client routes ────────
async function processGhlWebhook(clientId, client, routingConfig, payload, res) {
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
    const contactId = payload.contactId || payload.contact_id || payload.contact?.id;
    const dedupeKey = generateDedupeKey(contactId, phone);
    const existingLead = await prisma.lead.findUnique({
        where: { clientId_dedupeKey: { clientId, dedupeKey } },
    });
    if (existingLead) {
        await createAuditLog('WEBHOOK_DUPLICATE', `Duplicate lead ignored: ${dedupeKey}`, clientId, {
            leadId: existingLead.id, dedupeKey,
        });
        res.status(200).json({ message: 'Lead already processed', leadId: existingLead.id });
        return;
    }
    const lead = await prisma.lead.create({
        data: {
            clientId,
            firstName: payload.firstName || payload.first_name || payload.contact?.firstName || null,
            lastName: payload.lastName || payload.last_name || payload.contact?.lastName || null,
            phone,
            email: payload.email || payload.contact?.email || null,
            source: payload.source || 'gohighlevel',
            payloadJson: payload,
            dedupeKey,
            callStatus: 'NEW',
        },
    });
    await createAuditLog('LEAD_CREATED', `New lead created: ${phone}`, clientId, { leadId: lead.id, phone });
    if (client.status !== 'ACTIVE') {
        await prisma.lead.update({ where: { id: lead.id }, data: { callStatus: 'SKIPPED', skipReason: 'Client inactive' } });
        res.status(200).json({ message: 'Lead received but client inactive', leadId: lead.id });
        return;
    }
    if (isWithinQuietHours(client.timezone, client.quietHoursStart, client.quietHoursEnd)) {
        await prisma.lead.update({ where: { id: lead.id }, data: { callStatus: 'SKIPPED', skipReason: 'Quiet hours' } });
        await createAuditLog('CALL_SKIPPED', `Call skipped due to quiet hours: ${phone}`, clientId, { leadId: lead.id });
        res.status(200).json({ message: 'Lead received but in quiet hours', leadId: lead.id });
        return;
    }
    await prisma.lead.update({ where: { id: lead.id }, data: { callStatus: 'QUEUED' } });
    const provider = routingConfig.provider || 'BLAND';
    let callResult;
    if (provider === 'VAPI') {
        callResult = await createVapiCall(lead.id, clientId, phone, routingConfig.instructions, routingConfig.transferNumber || undefined, lead.firstName || undefined, routingConfig.vapiAssistantId || undefined);
    }
    else if (provider === 'TELNYX') {
        try {
            const callRecord = await prisma.call.create({
                data: { clientId, leadId: lead.id, provider: 'TELNYX', status: 'CREATED' },
            });
            const result = await makeTelnyxCall(phone, routingConfig.instructions, routingConfig.transferNumber || null, lead.id, clientId, callRecord.id, lead.firstName || undefined, routingConfig.telnyxAssistantId, routingConfig.telnyxPhoneNumber, routingConfig.telnyxAppId);
            await prisma.call.update({
                where: { id: callRecord.id },
                data: { providerCallId: result.callId === 'unknown' ? null : result.callId, status: 'IN_PROGRESS', startedAt: new Date() },
            });
            await prisma.lead.update({ where: { id: lead.id }, data: { callStatus: 'CALLING' } });
            await createAuditLog('CALL_INITIATED', `Telnyx call initiated to ${phone}`, clientId, {
                leadId: lead.id, callId: callRecord.id, providerCallId: result.callId,
            });
            callResult = { success: true, callId: result.callId };
        }
        catch (err) {
            await createAuditLog('CALL_FAILED', `Telnyx call failed: ${err.message}`, clientId, { leadId: lead.id });
            await prisma.lead.update({ where: { id: lead.id }, data: { callStatus: 'FAILED', skipReason: err.message } });
            callResult = { success: false, error: err.message };
        }
    }
    else {
        callResult = await createBlandCall(lead.id, clientId, phone, routingConfig.instructions, routingConfig.transferNumber || undefined, routingConfig.blandAgentId || undefined);
    }
    if (callResult.success) {
        res.status(200).json({ message: 'Lead received and call initiated', leadId: lead.id, callId: callResult.callId });
    }
    else {
        res.status(200).json({ message: 'Lead received but call failed', leadId: lead.id, error: callResult.error });
    }
}
// ─── GoHighLevel per-config webhook (multi-campaign) ──────────────────────────
// Each campaign has its own URL: POST /webhook/gohighlevel/config/:configId
// This is the preferred URL for new setups.
router.post('/gohighlevel/config/:configId', async (req, res) => {
    const { configId } = req.params;
    try {
        const routingConfig = await prisma.routingConfig.findUnique({
            where: { id: configId },
            include: { client: true },
        });
        if (!routingConfig) {
            await createAuditLog('WEBHOOK_ERROR', `Config not found: ${configId}`, undefined, { configId });
            res.status(404).json({ error: 'Routing config not found' });
            return;
        }
        if (!routingConfig.active) {
            res.status(200).json({ message: 'Campaign is not active' });
            return;
        }
        await processGhlWebhook(routingConfig.clientId, routingConfig.client, routingConfig, req.body, res);
    }
    catch (error) {
        console.error('Per-config webhook error:', error);
        await createAuditLog('WEBHOOK_ERROR', error.message, undefined, { configId, error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ─── GoHighLevel per-client webhook (legacy — picks first active config) ───────
router.post('/gohighlevel/:clientId', async (req, res) => {
    const { clientId } = req.params;
    try {
        const client = await prisma.client.findUnique({
            where: { id: clientId },
            include: { routingConfigs: { where: { active: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
        });
        if (!client) {
            await createAuditLog('WEBHOOK_ERROR', `Client not found: ${clientId}`, undefined, { clientId });
            res.status(404).json({ error: 'Client not found' });
            return;
        }
        const routingConfig = client.routingConfigs[0];
        if (!routingConfig) {
            res.status(200).json({ message: 'Lead received but no active routing config' });
            return;
        }
        await processGhlWebhook(clientId, client, routingConfig, req.body, res);
    }
    catch (error) {
        console.error('Webhook error:', error);
        await createAuditLog('WEBHOOK_ERROR', error.message, clientId, { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ─── Bland callback ────────────────────────────────────────────────────────────
router.post('/bland', async (req, res) => {
    const payload = req.body;
    try {
        const callId = payload.call_id;
        if (!callId) {
            res.status(400).json({ error: 'call_id required' });
            return;
        }
        const call = await prisma.call.findUnique({
            where: { providerCallId: callId },
            include: { lead: true },
        });
        if (!call) {
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
        await prisma.lead.update({ where: { id: call.leadId }, data: { callStatus: leadStatus } });
        await createAuditLog('CALL_UPDATED', `Bland call status → ${callStatus}`, call.clientId, {
            callId: call.id, leadId: call.leadId, status: callStatus,
        });
        res.status(200).json({ message: 'Webhook processed' });
    }
    catch (error) {
        console.error('Bland webhook error:', error);
        await createAuditLog('WEBHOOK_ERROR', error.message, undefined, { payload, error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ─── VAPI callback ─────────────────────────────────────────────────────────────
router.post('/vapi', async (req, res) => {
    const payload = req.body;
    try {
        const callId = payload.call?.id || payload.callId;
        if (!callId) {
            console.error('No call ID in VAPI webhook payload');
            res.status(400).json({ error: 'call ID required' });
            return;
        }
        const call = await prisma.call.findUnique({
            where: { providerCallId: callId },
            include: { lead: true },
        });
        if (!call) {
            res.status(404).json({ error: 'Call not found' });
            return;
        }
        const status = payload.status?.toLowerCase();
        let callStatus = 'IN_PROGRESS';
        let leadStatus = 'CALLING';
        if (status === 'ended' || payload.endedReason) {
            callStatus = 'COMPLETED';
            leadStatus = 'COMPLETED';
        }
        else if (status === 'failed') {
            callStatus = 'FAILED';
            leadStatus = 'FAILED';
        }
        await prisma.call.update({
            where: { id: call.id },
            data: {
                status: callStatus,
                outcome: payload.endedReason || null,
                transcript: payload.transcript || null,
                recordingUrl: payload.recordingUrl || null,
                rawProviderPayload: payload,
                endedAt: callStatus === 'COMPLETED' || callStatus === 'FAILED' ? new Date() : null,
            },
        });
        await prisma.lead.update({ where: { id: call.leadId }, data: { callStatus: leadStatus } });
        await createAuditLog('CALL_UPDATED', `VAPI call status → ${callStatus}`, call.clientId, {
            callId: call.id, leadId: call.leadId, status: callStatus,
        });
        res.status(200).json({ message: 'Webhook processed' });
    }
    catch (error) {
        console.error('VAPI webhook error:', error);
        await createAuditLog('WEBHOOK_ERROR', error.message, undefined, { payload, error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ─── Telnyx AI tool: save booking ─────────────────────────────────────────────
// Called by all 3 AI agents (Anna/Riley/Maya) after collecting booking details.
// Telnyx auto-injects call_control_id; agent passes name/email/phone/date/time.
router.post('/telnyx/booking', async (req, res) => {
    try {
        const { lead_name, lead_email, lead_phone, business_name, city, appointment_date, appointment_time, notes, call_control_id, } = req.body;
        console.log('[booking] received:', { lead_name, lead_phone, appointment_date, appointment_time });
        // Find the lead by phone to get clientId
        let clientId = null;
        let leadId = null;
        if (lead_phone) {
            const normalizedPhone = lead_phone.replace(/\D/g, '');
            const lead = await prisma.lead.findFirst({
                where: {
                    phone: { contains: normalizedPhone.slice(-10) },
                },
                orderBy: { createdAt: 'desc' },
            });
            if (lead) {
                clientId = lead.clientId;
                leadId = lead.id;
            }
        }
        // Fall back: find by call_control_id → providerCallId
        if (!clientId && call_control_id) {
            const call = await prisma.call.findFirst({
                where: { providerCallId: call_control_id },
                orderBy: { createdAt: 'desc' },
            });
            if (call) {
                clientId = call.clientId;
                leadId = call.leadId;
            }
        }
        if (!clientId) {
            // Still save — use a fallback unknown client log
            console.warn('[booking] Could not find client for booking — saving without clientId');
            await createAuditLog('BOOKING_UNMATCHED', `Unmatched booking: ${lead_phone}`, undefined, {
                lead_name, lead_email, lead_phone, appointment_date, appointment_time, call_control_id,
            });
            res.json({ result: 'booked', message: `Got it! Your appointment request has been recorded.` });
            return;
        }
        // Save the booking
        await prisma.booking.create({
            data: {
                clientId,
                leadId: leadId || undefined,
                name: lead_name || null,
                email: lead_email || null,
                phone: lead_phone || null,
                businessName: business_name || null,
                city: city || null,
                appointmentDate: appointment_date || null,
                appointmentTime: appointment_time || null,
                notes: notes || null,
                status: 'PENDING',
            },
        });
        await createAuditLog('BOOKING_CREATED', `Booking saved: ${lead_name} — ${business_name} (${city}) on ${appointment_date} at ${appointment_time}`, clientId, {
            leadId, lead_name, lead_email, lead_phone, business_name, city, appointment_date, appointment_time,
        });
        console.log(`[booking] ✓ Saved for client ${clientId} | ${lead_name} | ${appointment_date} ${appointment_time}`);
        const dateStr = appointment_date ? ` for ${appointment_date}` : '';
        const timeStr = appointment_time ? ` at ${appointment_time}` : '';
        res.json({ result: 'booked', message: `Perfect! Your appointment has been booked${dateStr}${timeStr}. Joshua will reach out to confirm shortly.` });
    }
    catch (err) {
        console.error('[booking] Error:', err.message);
        res.status(500).json({ result: 'error', message: 'Unable to save booking. Please try again.' });
    }
});
// ─── Telnyx AI tool: warm transfer with AMD + whisper + fallback ───────────────
// Anna calls this webhook tool when she wants to transfer a qualified lead.
// We dial Joshua separately with AMD. If he answers → whisper briefing → bridge.
// If voicemail → hang up his leg → return "unavailable" so Anna books instead.
router.post('/telnyx/transfer', async (req, res) => {
    try {
        // Telnyx auto-injects call_control_id into webhook tool payloads
        const leadCcid = req.body.call_control_id;
        const leadName = req.body.lead_name || 'the lead';
        const leadSummary = req.body.lead_summary || 'interested in your services';
        const dest = process.env.DEFAULT_TRANSFER_NUMBER;
        if (!leadCcid || !dest) {
            res.status(400).json({ result: 'error', message: 'Missing call_control_id or DEFAULT_TRANSFER_NUMBER' });
            return;
        }
        const whisperText = `Hi Joshua — I have ${leadName} on the line. ${leadSummary}. Connecting you now.`;
        const webhookUrl = `${process.env.BASE_URL}/webhook/telnyx`;
        const clientRef = `transfer_from_${leadCcid}`;
        // Dial Joshua outbound with AMD
        const joshuaCcid = await dialOutbound(dest, clientRef, webhookUrl);
        console.log(`[warm-transfer] Dialed Joshua at ${dest} | ccid:${joshuaCcid}`);
        // Wait up to 25 s for AMD result → whisper → bridge
        const result = await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                pendingTransfers.delete(joshuaCcid);
                hangupCall(joshuaCcid).catch(() => { });
                console.log('[warm-transfer] Timed out — Joshua not reached');
                resolve('unavailable');
            }, 25000);
            pendingTransfers.set(joshuaCcid, {
                resolve,
                leadCallControlId: leadCcid,
                whisperText,
                timeout,
            });
        });
        if (result === 'connected') {
            res.json({ result: 'connected', message: `${leadName} has been connected with Joshua.` });
        }
        else {
            res.json({ result: 'unavailable', message: 'Joshua is not available right now.' });
        }
    }
    catch (err) {
        console.error('[telnyx-transfer]', err.response?.data || err.message);
        res.status(500).json({ result: 'error', message: err.message });
    }
});
// ─── Telnyx callback ───────────────────────────────────────────────────────────
// Handles BOTH:
//   1. TeXML AI call status callbacks (form body: CallSid, CallStatus, etc.)
//      IDs come from URL query params: ?leadId=&clientId=&callId=
//   2. Call Control JSON events (warm-transfer leg: client_reference_id)
// Always respond 200 immediately — Telnyx retries on non-2xx.
router.post('/telnyx', async (req, res) => {
    res.sendStatus(200);
    try {
        // ── Path A: TeXML status callback (form-encoded body with CallStatus) ──
        const callStatus = req.body?.CallStatus;
        if (callStatus) {
            const { leadId, clientId, callId: internalCallId } = req.query;
            const callSid = req.body?.CallSid;
            console.log(`[telnyx-texml] ${callStatus} | lead:${leadId} | sid:${callSid}`);
            if (!leadId || !clientId || !internalCallId)
                return;
            if (callStatus === 'in-progress' || callStatus === 'answered') {
                await prisma.call.updateMany({
                    where: { id: internalCallId },
                    data: { status: 'IN_PROGRESS', providerCallId: callSid },
                });
                await prisma.lead.updateMany({ where: { id: leadId }, data: { callStatus: 'CALLING' } });
                await createAuditLog('telnyx_call_answered', 'Telnyx AI call answered', clientId, { leadId, callSid });
            }
            else if (callStatus === 'completed' || callStatus === 'failed' || callStatus === 'busy' || callStatus === 'no-answer') {
                await prisma.call.updateMany({
                    where: { id: internalCallId },
                    data: { status: callStatus === 'completed' ? 'COMPLETED' : 'FAILED', endedAt: new Date() },
                });
                await prisma.lead.updateMany({
                    where: { id: leadId },
                    data: { callStatus: callStatus === 'completed' ? 'COMPLETED' : 'FAILED' },
                });
                await createAuditLog('telnyx_call_completed', `Telnyx AI call ${callStatus}`, clientId, { leadId, callSid });
            }
            return;
        }
        // ── Path B: Call Control JSON event ──
        const event = req.body?.data;
        if (!event)
            return;
        const eventType = event.event_type;
        const payload = event.payload ?? {};
        // Warm-transfer leg events (Joshua's outbound call)
        const clientRef = payload.client_reference_id || '';
        if (clientRef.startsWith('transfer_from_')) {
            await handleTransferLegEvent(eventType, payload);
            return;
        }
        // Legacy client_state path (kept for any old Call Control calls still in flight)
        const clientState = payload.client_state
            ? decodeTelnyxClientState(payload.client_state)
            : null;
        if (!clientState) {
            console.log('[telnyx-webhook] No client_state, skipping:', eventType);
            return;
        }
        const { leadId, clientId, internalCallId } = clientState;
        const callControlId = payload.call_control_id;
        console.log(`[telnyx-webhook] ${eventType} | lead:${leadId} | ctrl:${callControlId}`);
        switch (eventType) {
            case 'call.initiated':
                await prisma.call.updateMany({ where: { id: internalCallId }, data: { status: 'IN_PROGRESS' } });
                await createAuditLog('telnyx_call_initiated', 'Telnyx call initiated', clientId, { leadId, callControlId });
                break;
            case 'call.answered':
                await prisma.call.updateMany({ where: { id: internalCallId }, data: { status: 'IN_PROGRESS', providerCallId: callControlId } });
                await prisma.lead.updateMany({ where: { id: leadId }, data: { callStatus: 'CALLING' } });
                await createAuditLog('telnyx_call_answered', 'Telnyx call answered', clientId, { leadId, callControlId });
                break;
            case 'call.hangup': {
                const hangupCause = payload.hangup_cause;
                const callDuration = payload.call_duration_secs;
                await prisma.call.updateMany({ where: { id: internalCallId }, data: { status: 'COMPLETED', endedAt: new Date() } });
                await prisma.lead.updateMany({ where: { id: leadId }, data: { callStatus: 'COMPLETED' } });
                await createAuditLog('telnyx_call_completed', 'Telnyx call completed', clientId, { leadId, callControlId, hangupCause, callDuration });
                break;
            }
            case 'call.recording.saved': {
                const recordingUrl = payload.recording_urls?.mp3;
                if (recordingUrl) {
                    await prisma.call.updateMany({ where: { id: internalCallId }, data: { recordingUrl } });
                }
                break;
            }
            default:
                break;
        }
    }
    catch (err) {
        console.error('[telnyx-webhook] Error:', err.message);
    }
});
export default router;
