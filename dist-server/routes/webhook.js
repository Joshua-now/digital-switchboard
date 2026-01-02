router.post('/bland', async (req, res) => {
  const payload = req.body;

  // ✅ Always ACK Bland quickly to prevent retries storms
  // We still do DB work, but never respond 4xx/5xx back to Bland.
  const ack = () => res.status(200).json({ ok: true });

  try {
    const callId = payload?.call_id || payload?.callId;
    if (!callId) {
      // malformed / unexpected payload shape
      await createAuditLog('WEBHOOK_IGNORED', 'Bland webhook missing call_id', undefined, {
        keys: Object.keys(payload || {}),
      });
      return ack();
    }

    // Find our call row
    const call = await prisma.call.findUnique({
      where: { providerCallId: callId },
      include: { lead: true },
    });

    if (!call) {
      // ✅ Don’t 404 — that causes provider retries
      await createAuditLog('WEBHOOK_PENDING', 'Bland webhook received but call not found yet', undefined, {
        providerCallId: callId,
        status: payload?.status,
      });
      return ack();
    }

    const status = String(payload?.status || '').toLowerCase();

    const callStatus =
      status === 'completed' || payload?.completed
        ? 'COMPLETED'
        : status === 'failed' || payload?.error
          ? 'FAILED'
          : 'IN_PROGRESS';

    const leadStatus =
      callStatus === 'COMPLETED' ? 'COMPLETED' : callStatus === 'FAILED' ? 'FAILED' : 'CALLING';

    // ✅ Sanitize payload before storing (avoid the giant "decision" blob)
    const sanitized: any = { ...(payload || {}) };
    delete sanitized.decision;
    delete sanitized.pathway_info;

    // If Bland sends giant transcript arrays, keep only essentials
    if (Array.isArray(sanitized.transcripts)) {
      // keep the first 10 transcripts max, and trim text
      sanitized.transcripts = sanitized.transcripts.slice(0, 10).map((t: any) => ({
        ...t,
        text: typeof t?.text === 'string' ? t.text.slice(0, 5000) : t?.text,
      }));
    }

    // Pick transcript text (trimmed)
    const transcriptText =
      (typeof payload?.transcript === 'string' ? payload.transcript : null) ||
      (typeof payload?.transcripts?.[0]?.text === 'string' ? payload.transcripts[0].text : null);

    const transcriptTrimmed = transcriptText ? transcriptText.slice(0, 20000) : null;

    await prisma.call.update({
      where: { id: call.id },
      data: {
        status: callStatus,
        outcome: payload?.outcome || payload?.call_length || null,
        transcript: transcriptTrimmed,
        recordingUrl: payload?.recording_url || null,
        rawProviderPayload: sanitized,
        endedAt: callStatus === 'COMPLETED' || callStatus === 'FAILED' ? new Date() : null,
      },
    });

    await prisma.lead.update({
      where: { id: call.leadId },
      data: { callStatus: leadStatus },
    });

    await createAuditLog('CALL_UPDATED', `Call status updated to ${callStatus}`, call.clientId, {
      callId: call.id,
      leadId: call.leadId,
      providerCallId: callId,
      status: callStatus,
    });

    return ack();
  } catch (error: any) {
    // ✅ Never return 500 to Bland
    console.error('Bland webhook error:', error?.message || error);
    await createAuditLog('WEBHOOK_ERROR', error?.message || 'Bland webhook error', undefined, {
      // don't dump full payload here
      payloadKeys: Object.keys(payload || {}),
    });
    return ack();
  }
});
