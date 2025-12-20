import { prisma } from './db.js';
export async function createAuditLog(eventType, message, clientId, dataJson) {
    try {
        await prisma.auditLog.create({
            data: {
                eventType,
                message,
                clientId: clientId || null,
                dataJson: dataJson || null,
            },
        });
    }
    catch (error) {
        console.error('Failed to create audit log:', error);
    }
}
