import { prisma } from './db.js';

export async function createAuditLog(
  eventType: string,
  message: string,
  clientId?: string,
  dataJson?: any
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        eventType,
        message,
        clientId: clientId || null,
        dataJson: dataJson || null,
      },
    });
  } catch (error) {
    console.error('Failed to create audit log:', error);
  }
}
