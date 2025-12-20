import express from 'express';
import { prisma } from '../lib/db.js';
import { requireAuth, authenticateAdmin } from '../middleware/auth.js';
import { createAuditLog } from '../lib/audit.js';
const router = express.Router();
router.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        res.status(400).json({ error: 'Email and password required' });
        return;
    }
    const token = await authenticateAdmin(email, password);
    if (!token) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
    }
    res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ success: true, token });
});
router.post('/auth/logout', requireAuth, (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});
router.get('/auth/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
});
router.get('/clients', requireAuth, async (req, res) => {
    try {
        const clients = await prisma.client.findMany({
            include: {
                routingConfigs: true,
                _count: {
                    select: {
                        leads: true,
                        calls: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json(clients);
    }
    catch (error) {
        console.error('Error fetching clients:', error);
        res.status(500).json({ error: 'Failed to fetch clients' });
    }
});
router.get('/clients/:id', requireAuth, async (req, res) => {
    try {
        const client = await prisma.client.findUnique({
            where: { id: req.params.id },
            include: {
                routingConfigs: true,
            },
        });
        if (!client) {
            res.status(404).json({ error: 'Client not found' });
            return;
        }
        res.json(client);
    }
    catch (error) {
        console.error('Error fetching client:', error);
        res.status(500).json({ error: 'Failed to fetch client' });
    }
});
router.post('/clients', requireAuth, async (req, res) => {
    try {
        const { name, timezone, quietHoursStart, quietHoursEnd, status } = req.body;
        if (!name) {
            res.status(400).json({ error: 'Name is required' });
            return;
        }
        const client = await prisma.client.create({
            data: {
                name,
                timezone: timezone || 'America/New_York',
                quietHoursStart: quietHoursStart || '20:00',
                quietHoursEnd: quietHoursEnd || '08:00',
                status: status || 'ACTIVE',
            },
        });
        await createAuditLog('CLIENT_CREATED', `Client created: ${name}`, client.id);
        res.status(201).json(client);
    }
    catch (error) {
        console.error('Error creating client:', error);
        res.status(500).json({ error: 'Failed to create client' });
    }
});
router.put('/clients/:id', requireAuth, async (req, res) => {
    try {
        const { name, timezone, quietHoursStart, quietHoursEnd, status } = req.body;
        const client = await prisma.client.update({
            where: { id: req.params.id },
            data: {
                ...(name && { name }),
                ...(timezone && { timezone }),
                ...(quietHoursStart && { quietHoursStart }),
                ...(quietHoursEnd && { quietHoursEnd }),
                ...(status && { status }),
            },
        });
        await createAuditLog('CLIENT_UPDATED', `Client updated: ${client.name}`, client.id);
        res.json(client);
    }
    catch (error) {
        console.error('Error updating client:', error);
        res.status(500).json({ error: 'Failed to update client' });
    }
});
router.delete('/clients/:id', requireAuth, async (req, res) => {
    try {
        const client = await prisma.client.delete({
            where: { id: req.params.id },
        });
        await createAuditLog('CLIENT_DELETED', `Client deleted: ${client.name}`, client.id);
        res.json({ success: true });
    }
    catch (error) {
        console.error('Error deleting client:', error);
        res.status(500).json({ error: 'Failed to delete client' });
    }
});
router.get('/clients/:id/routing-config', requireAuth, async (req, res) => {
    try {
        const config = await prisma.routingConfig.findFirst({
            where: { clientId: req.params.id },
        });
        res.json(config);
    }
    catch (error) {
        console.error('Error fetching routing config:', error);
        res.status(500).json({ error: 'Failed to fetch routing config' });
    }
});
router.post('/clients/:id/routing-config', requireAuth, async (req, res) => {
    try {
        const { active, callWithinSeconds, instructions, questions, transferNumber } = req.body;
        const clientId = req.params.id;
        if (!instructions) {
            res.status(400).json({ error: 'Instructions are required' });
            return;
        }
        const existingConfig = await prisma.routingConfig.findFirst({
            where: { clientId },
        });
        let config;
        if (existingConfig) {
            config = await prisma.routingConfig.update({
                where: { id: existingConfig.id },
                data: {
                    active: active !== undefined ? active : existingConfig.active,
                    callWithinSeconds: callWithinSeconds || existingConfig.callWithinSeconds,
                    instructions,
                    questions: questions || existingConfig.questions,
                    transferNumber: transferNumber || existingConfig.transferNumber,
                },
            });
        }
        else {
            config = await prisma.routingConfig.create({
                data: {
                    clientId,
                    active: active !== undefined ? active : true,
                    callWithinSeconds: callWithinSeconds || 60,
                    instructions,
                    questions: questions || null,
                    transferNumber: transferNumber || null,
                },
            });
        }
        await createAuditLog('ROUTING_CONFIG_UPDATED', 'Routing config updated', clientId);
        res.json(config);
    }
    catch (error) {
        console.error('Error saving routing config:', error);
        res.status(500).json({ error: 'Failed to save routing config' });
    }
});
router.get('/leads', requireAuth, async (req, res) => {
    try {
        const { clientId, limit = '50', offset = '0' } = req.query;
        const where = clientId ? { clientId: String(clientId) } : {};
        const leads = await prisma.lead.findMany({
            where,
            include: {
                client: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                calls: {
                    select: {
                        id: true,
                        status: true,
                        outcome: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: Number(limit),
            skip: Number(offset),
        });
        const total = await prisma.lead.count({ where });
        res.json({ leads, total });
    }
    catch (error) {
        console.error('Error fetching leads:', error);
        res.status(500).json({ error: 'Failed to fetch leads' });
    }
});
router.get('/leads/:id', requireAuth, async (req, res) => {
    try {
        const lead = await prisma.lead.findUnique({
            where: { id: req.params.id },
            include: {
                client: true,
                calls: {
                    orderBy: { createdAt: 'desc' },
                },
            },
        });
        if (!lead) {
            res.status(404).json({ error: 'Lead not found' });
            return;
        }
        res.json(lead);
    }
    catch (error) {
        console.error('Error fetching lead:', error);
        res.status(500).json({ error: 'Failed to fetch lead' });
    }
});
router.get('/calls', requireAuth, async (req, res) => {
    try {
        const { clientId, limit = '50', offset = '0' } = req.query;
        const where = clientId ? { clientId: String(clientId) } : {};
        const calls = await prisma.call.findMany({
            where,
            include: {
                client: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                lead: {
                    select: {
                        id: true,
                        phone: true,
                        firstName: true,
                        lastName: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: Number(limit),
            skip: Number(offset),
        });
        const total = await prisma.call.count({ where });
        res.json({ calls, total });
    }
    catch (error) {
        console.error('Error fetching calls:', error);
        res.status(500).json({ error: 'Failed to fetch calls' });
    }
});
router.get('/audit-logs', requireAuth, async (req, res) => {
    try {
        const { clientId, limit = '100', offset = '0' } = req.query;
        const where = clientId ? { clientId: String(clientId) } : {};
        const logs = await prisma.auditLog.findMany({
            where,
            include: {
                client: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: Number(limit),
            skip: Number(offset),
        });
        res.json(logs);
    }
    catch (error) {
        console.error('Error fetching audit logs:', error);
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});
export default router;
