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

export default router;
