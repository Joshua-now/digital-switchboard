import { prisma } from './db.js';

function safeJson(data) {
  if (!data) return null;
  try {
    const s = JSON.stringify(data);
    if (s.length > 8000) return { note: 'data omitted (too large)', keys: Object.keys(data) };
    return data;
  } catch {
    return { note: 'data omitted (non-serializable)' };
  }
}

let lastAuditErrorAt = 0;

export async function createAuditLog(eventType, message, clientId, dataJson) {
  try {
    await prisma.auditLog.create({
      data: {
        eventType,
        message: String(message || ''),
        clientId: clientId || null,
        dataJson: safeJson(dataJson),
      },
    });
  } catch (error) {
    // Rate-limit this log so it can't melt Railway
    const now = Date.now();
    if (now - lastAuditErrorAt > 5000) {
      lastAuditErrorAt = now;
      console.error('Failed to create audit log:', error?.message || error);
    }
  }
}
