import { prisma } from './db.js';

const MAX_AUDIT_JSON_CHARS = Number(process.env.MAX_AUDIT_JSON_CHARS ?? 8000);

/**
 * Remove/trim fields that commonly explode log size
 * (Bland decision trees, transcripts, raw payloads, etc.)
 */
function sanitizeAuditData(dataJson) {
  if (!dataJson || typeof dataJson !== 'object') return null;

  // Shallow clone to avoid mutating caller object
  const safe = Array.isArray(dataJson) ? [...dataJson] : { ...dataJson };

  // Common gigantic fields we never want in audit logs
  const DROP_KEYS = [
    'decision',
    'pathway_info',
    'transcripts',
    'conversation',
    'conversationHistory',
    'conversation_history',
    'rawProviderPayload',
    'rawPayload',
    'payload',
    'payloadJson',
    'fullPayload',
    'unitTestResults',
    'Unit Tests Results',
    'Global Prompt',
    'Current Node Prompt/Text',
    'Dialogue Example',
    'Conversation History',
    'Current Variables',
  ];

  for (const k of DROP_KEYS) {
    if (k in safe) delete safe[k];
  }

  // If still too large, replace with summary
  try {
    const str = JSON.stringify(safe);
    if (str.length > MAX_AUDIT_JSON_CHARS) {
      return {
        warning: 'audit data truncated (too large)',
        originalKeys: Object.keys(dataJson || {}),
        keptKeys: Object.keys(safe || {}),
      };
    }
    return safe;
  } catch {
    // If something can’t be stringified (circular refs), store minimal info
    return {
      warning: 'audit data not serializable',
      originalKeys: Object.keys(dataJson || {}),
    };
  }
}

export async function createAuditLog(eventType, message, clientId, dataJson) {
  try {
    const safeData = sanitizeAuditData(dataJson);

    await prisma.auditLog.create({
      data: {
        eventType,
        message,
        clientId: clientId || null,
        dataJson: safeData,
      },
    });
  } catch (error) {
    console.error('Failed to create audit log:', error);
  }
}
