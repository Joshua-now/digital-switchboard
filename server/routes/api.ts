import express, { Response } from 'express';
import { prisma } from '../lib/db.js';
import { requireAuth, AuthRequest, authenticateAdmin } from '../middleware/auth.js';
import { createAuditLog } from '../lib/audit.js';

const router = express.Router();

// AUTH
router.post('/auth/login', async (req: AuthRequest, res: Response) => {
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
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.json({ success: true });
});

router.post('/auth/logout', requireAuth, (_req: AuthRequest, res: Response) => {
  res.clearCookie('token');
  res.json({ success: true });
});

router.get('/auth/me', requireAuth, (req: AuthRequest, res: Response) => {
  res.json({ user: req.user });
});

// CLIENTS
router.get('/clients', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const clients = await prisma.client.findMany({
      include: {
        _count: {
          select: { leads: true, calls: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(clients);
  } catch (error: any) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

router.get('/clients/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const client = await prisma.client.findUnique({
      where: { id },
    });

    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    res.json(client);
  } catch (error: any) {
    console.error('Error fetching client:', error);
    res.status(500).json({ error: 'Failed to fetch client' });
  }
});

router.post('/clients', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const {
      name,
      timezone,
      quietHoursStart,
      quietHoursEnd,
      status,
      ghlLocationId,
    } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const cleanedGhlLocationId =
      typeof ghlLocationId === 'string' ? ghlLocationId.trim() : '';

    if (!cleanedGhlLocationId) {
      res.status(400).json({ error: 'ghlLocationId is required' });
      return;
    }

    // Friendly error before Prisma throws a unique constraint exception
    const existing = await prisma.client.findUnique({
      where: { ghlLocationId: cleanedGhlLocationId },
      select: { id: true, name: true },
    });

    if (existing) {
      res.status(409).json({
        error: 'Client already exists for this ghlLocationId',
        existingClient: existing,
      });
      return;
    }

    const client = await prisma.client.create({
      data: {
        name,
        timezone: timezone || 'America/New_York',
        quietHoursStart: quietHoursStart || '20:00',
        quietHoursEnd: quietHoursEnd || '08:00',
        status: status || 'ACTIVE',
        ghlLocationId: cleanedGhlLocationId,
      },
    });

    await createAuditLog('CLIENT_CREATED', `Client created: ${client.name}`, client.id);

    res.status(201).json(client);
  } catch (error: any) {
    console.error('Error creating client:', error);
    res.status(500).json({
      error: 'Failed to create client',
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
    });
  }
});

router.patch('/clients/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, timezone, quietHoursStart, quietHoursEnd, status } = req.body;

    const client = await prisma.client.update({
      where: { id },
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
  } catch (error: any) {
    console.error('Error updating client:', error);
    res.status(500).json({ error: 'Failed to update client' });
  }
});

router.get('/clients/:id/routing', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const config = await prisma.routingConfig.findUnique({
      where: { clientId: id },
    });

    res.json(config);
  } catch (error: any) {
    console.error('Error fetching routing config:', error);
    res.status(500).json({ error: 'Failed to fetch routing config' });
  }
});

router.post('/clients/:id/routing', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { active, callWithinSeconds, instructions, transferNumber } = req.body;

    const config = await prisma.routingConfig.upsert({
      where: { clientId: id },
      create: {
        clientId: id,
        active: active ?? true,
        callWithinSeconds: callWithinSeconds ?? 60,
        instructions: instructions || '',
        transferNumber: transferNumber || null,
      },
      update: {
        active,
        callWithinSeconds,
        instructions,
        transferNumber: transferNumber || null,
      },
    });

    await createAuditLog('ROUTING_CONFIG_UPDATED', `Routing config updated for client ${id}`, id);

    res.json(config);
  } catch (error: any) {
    console.error('Error saving routing config:', error);
    res.status(500).json({ error: 'Failed to save routing config' });
  }
});

// LEADS
router.get('/leads', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { clientId, limit = '50' } = req.query;

    const where: any = {};
    if (clientId && typeof clientId === 'string') {
      where.clientId = clientId;
    }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        include: {
          client: { select: { id: true, name: true } },
          calls: { select: { id: true, status: true, outcome: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit as string, 10),
      }),
      prisma.lead.count({ where }),
    ]);

    res.json({ leads, total });
  } catch (error: any) {
    console.error('Error fetching leads:', error);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

// CALLS
router.get('/calls', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { clientId, limit = '50' } = req.query;

    const where: any = {};
    if (clientId && typeof clientId === 'string') {
      where.clientId = clientId;
    }

    const [calls, total] = await Promise.all([
      prisma.call.findMany({
        where,
        include: {
          client: { select: { id: true, name: true } },
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
        take: parseInt(limit as string, 10),
      }),
      prisma.call.count({ where }),
    ]);

    res.json({ calls, total });
  } catch (error: any) {
    console.error('Error fetching calls:', error);
    res.status(500).json({ error: 'Failed to fetch calls' });
  }
});

export default router;
