import { prisma } from './db.js';

const MAX_JSON_CHARS = Number(process.env.AUDIT_JSON_MAX_CHARS || 8000);

function redact(obj) {
  const seen = new WeakSet();

  const walk = (value) => {
    if (value === null || value === undefined) return value;

    if (typeof value !== 'object') return value;

    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);

    if (Array.isArray(value)) return value.map(walk);

    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const key = String(k).toLowerCase();
      if (
        key.includes('authorization') ||
        key.includes('api_key') ||
        key.includes('apikey') ||
        key.includes('token') ||
        key.includes('secret') ||
        key.includes('password')
      ) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = walk(v);
      }
    }
    return out;
  };

  return walk(obj);
}

function safeJson(data) {
  if (!data) return null;

  try {
    const redacted = redact(data);
    const s = JSON.stringify(redacted);

    if (s.length > MAX_JSON_CHARS) {
      // Keep it small but still useful for debugging
      return {
        note: 'data truncated (too large)',
        approxSize: s.length,
        keys: Object.keys(redacted || {}),
        preview: s.slice(0, 1000) + '…[TRUNCATED]',
      };
    }

    return redacted;
  } catch {
    return { note: 'data omitted (non-serializable)' };
  }
}

let lastAuditErrorAt = 0;

export async function createAuditLog(eventType, message, clientId, dataJson) {
  try {
    await prisma.auditLog.create({
      data: {
        eventType: String(eventType || 'UNKNOWN'),
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
