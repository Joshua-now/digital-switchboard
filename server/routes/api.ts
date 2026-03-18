import express, { Response } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/db.js';
import {
  requireAuth,
  requireSuperAdmin,
  agencyScope,
  AuthRequest,
  verifyPassword,
  hashPassword,
  generateToken,
} from '../middleware/auth.js';
import { createAuditLog } from '../lib/audit.js';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

router.post('/auth/login', loginLimiter, async (req: AuthRequest, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password required' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { agency: true },
    });

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (user.agency && user.agency.status === 'SUSPENDED') {
      res.status(403).json({ error: 'Account suspended. Please contact support.' });
      return;
    }

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role as 'SUPER_ADMIN' | 'AGENCY_ADMIN',
      agencyId: user.agencyId,
    });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      token,
      user: {
        email: user.email,
        name: user.name,
        role: user.role,
        agencyId: user.agencyId,
        agencyName: user.agency?.name ?? null,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/auth/signup', async (req: AuthRequest, res: Response) => {
  const { agencyName, name, email, password } = req.body;

  if (!agencyName?.trim() || !email?.trim() || !password) {
    res.status(400).json({ error: 'Agency name, email, and password are required' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  try {
    const existing = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (existing) {
      res.status(409).json({ error: 'An account with that email already exists' });
      return;
    }

    const passwordHash = await hashPassword(password);

    // Create agency + user in a single transaction
    const { agency, user } = await prisma.$transaction(async (tx) => {
      const agency = await tx.agency.create({
        data: { name: agencyName.trim() },
      });
      const user = await tx.user.create({
        data: {
          email: email.toLowerCase().trim(),
          passwordHash,
          name: name?.trim() || null,
          role: 'AGENCY_ADMIN',
          agencyId: agency.id,
        },
      });
      return { agency, user };
    });

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: 'AGENCY_ADMIN',
      agencyId: agency.id,
    });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      success: true,
      token,
      user: {
        email: user.email,
        name: user.name,
        role: user.role,
        agencyId: agency.id,
        agencyName: agency.name,
      },
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

router.post('/auth/logout', requireAuth, (req: AuthRequest, res: Response) => {
  res.clearCookie('token');
  res.json({ success: true });
});

router.get('/auth/me', requireAuth, (req: AuthRequest, res: Response) => {
  res.json({ user: req.user });
});

// ─── Clients ──────────────────────────────────────────────────────────────────

router.get('/clients', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const scope = agencyScope(req.user!);
    const clients = await prisma.client.findMany({
      where: scope,
      include: {
        routingConfigs: true,
        _count: { select: { leads: true, calls: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(clients);
  } catch (err) {
    console.error('Error fetching clients:', err);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

router.get('/clients/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const scope = agencyScope(req.user!);
    const client = await prisma.client.findFirst({
      where: { id: req.params.id, ...scope },
      include: { routingConfigs: true },
    });
    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }
    res.json(client);
  } catch (err) {
    console.error('Error fetching client:', err);
    res.status(500).json({ error: 'Failed to fetch client' });
  }
});

router.post('/clients', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { name, timezone, quietHoursStart, quietHoursEnd, status, ghlLocationId } = req.body;
    if (!name?.trim()) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const client = await prisma.client.create({
      data: {
        name: name.trim(),
        timezone: timezone || 'America/New_York',
        quietHoursStart: quietHoursStart || '20:00',
        quietHoursEnd: quietHoursEnd || '08:00',
        status: status || 'ACTIVE',
        agencyId: req.user!.agencyId,
        ...(ghlLocationId?.trim() ? { ghlLocationId: ghlLocationId.trim() } : {}),
      },
    });

    await createAuditLog('CLIENT_CREATED', `Client created: ${name}`, client.id);
    res.status(201).json(client);
  } catch (err: any) {
    console.error('Error creating client:', err);
    if (err?.code === 'P2002') {
      res.status(409).json({ error: 'A client with that GHL Location ID already exists' });
      return;
    }
    res.status(500).json({ error: 'Failed to create client' });
  }
});

// Shared update logic used by both PUT and PATCH
async function updateClient(req: AuthRequest, res: Response): Promise<void> {
  try {
    const scope = agencyScope(req.user!);
    // Ownership check
    const existing = await prisma.client.findFirst({
      where: { id: req.params.id, ...scope },
    });
    if (!existing) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    const { name, timezone, quietHoursStart, quietHoursEnd, status, ghlLocationId } = req.body;
    const client = await prisma.client.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(timezone && { timezone }),
        ...(quietHoursStart && { quietHoursStart }),
        ...(quietHoursEnd && { quietHoursEnd }),
        ...(status && { status }),
        ...(ghlLocationId !== undefined ? { ghlLocationId: ghlLocationId || null } : {}),
      },
    });

    await createAuditLog('CLIENT_UPDATED', `Client updated: ${client.name}`, client.id);
    res.json(client);
  } catch (err: any) {
    console.error('Error updating client:', err);
    if (err?.code === 'P2002') {
      res.status(409).json({ error: 'A client with that GHL Location ID already exists' });
      return;
    }
    res.status(500).json({ error: 'Failed to update client' });
  }
}

router.put('/clients/:id', requireAuth, updateClient);
router.patch('/clients/:id', requireAuth, updateClient);

router.delete('/clients/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const scope = agencyScope(req.user!);
    const existing = await prisma.client.findFirst({
      where: { id: req.params.id, ...scope },
    });
    if (!existing) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }
    await prisma.client.delete({ where: { id: req.params.id } });
    await createAuditLog('CLIENT_DELETED', `Client deleted: ${existing.name}`, req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting client:', err);
    res.status(500).json({ error: 'Failed to delete client' });
  }
});

// ─── Routing Config ───────────────────────────────────────────────────────────

async function getRoutingConfig(req: AuthRequest, res: Response): Promise<void> {
  try {
    const scope = agencyScope(req.user!);
    const clientExists = await prisma.client.findFirst({
      where: { id: req.params.id, ...scope },
    });
    if (!clientExists) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }
    const config = await prisma.routingConfig.findFirst({
      where: { clientId: req.params.id },
    });
    res.json(config);
  } catch (err) {
    console.error('Error fetching routing config:', err);
    res.status(500).json({ error: 'Failed to fetch routing config' });
  }
}

async function saveRoutingConfig(req: AuthRequest, res: Response): Promise<void> {
  try {
    const scope = agencyScope(req.user!);
    const clientExists = await prisma.client.findFirst({
      where: { id: req.params.id, ...scope },
    });
    if (!clientExists) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    const { active, callWithinSeconds, instructions, questions, transferNumber, provider } = req.body;
    const clientId = req.params.id;

    if (!instructions) {
      res.status(400).json({ error: 'Instructions are required' });
      return;
    }

    const validProviders = ['BLAND', 'VAPI', 'TELNYX'];
    const resolvedProvider = provider && validProviders.includes(provider) ? provider : undefined;

    const existingConfig = await prisma.routingConfig.findFirst({ where: { clientId } });

    let config;
    if (existingConfig) {
      config = await prisma.routingConfig.update({
        where: { id: existingConfig.id },
        data: {
          active: active !== undefined ? active : existingConfig.active,
          callWithinSeconds: callWithinSeconds || existingConfig.callWithinSeconds,
          instructions,
          questions: questions !== undefined ? questions : existingConfig.questions,
          transferNumber: transferNumber !== undefined ? (transferNumber || null) : existingConfig.transferNumber,
          ...(resolvedProvider ? { provider: resolvedProvider as any } : {}),
        },
      });
    } else {
      config = await prisma.routingConfig.create({
        data: {
          clientId,
          active: active !== undefined ? active : true,
          callWithinSeconds: callWithinSeconds || 60,
          instructions,
          questions: questions || null,
          transferNumber: transferNumber || null,
          ...(resolvedProvider ? { provider: resolvedProvider as any } : {}),
        },
      });
    }

    await createAuditLog(
      'ROUTING_CONFIG_UPDATED',
      `Routing config updated (provider: ${config.provider})`,
      clientId
    );
    res.json(config);
  } catch (err) {
    console.error('Error saving routing config:', err);
    res.status(500).json({ error: 'Failed to save routing config' });
  }
}

router.get('/clients/:id/routing-config', requireAuth, getRoutingConfig);
router.get('/clients/:id/routing', requireAuth, getRoutingConfig);
router.post('/clients/:id/routing-config', requireAuth, saveRoutingConfig);
router.post('/clients/:id/routing', requireAuth, saveRoutingConfig);

// ─── Leads ────────────────────────────────────────────────────────────────────

router.get('/leads', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { clientId, limit = '50', offset = '0', search, status } = req.query;
    const scope = agencyScope(req.user!);

    const where: any = {};
    // Scope leads through their parent client's agencyId
    if (scope.agencyId) {
      where.client = { agencyId: scope.agencyId };
    }
    if (clientId) where.clientId = String(clientId);
    if (status) where.callStatus = String(status);
    if (search) {
      const s = String(search);
      where.OR = [
        { firstName: { contains: s, mode: 'insensitive' } },
        { lastName: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s } },
        { email: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        include: {
          client: { select: { id: true, name: true } },
          calls: { select: { id: true, status: true, outcome: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
        skip: Number(offset),
      }),
      prisma.lead.count({ where }),
    ]);

    res.json({ leads, total });
  } catch (err) {
    console.error('Error fetching leads:', err);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

router.get('/leads/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const scope = agencyScope(req.user!);
    const where: any = { id: req.params.id };
    if (scope.agencyId) where.client = { agencyId: scope.agencyId };

    const lead = await prisma.lead.findFirst({
      where,
      include: {
        client: true,
        calls: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    res.json(lead);
  } catch (err) {
    console.error('Error fetching lead:', err);
    res.status(500).json({ error: 'Failed to fetch lead' });
  }
});

// ─── Calls ────────────────────────────────────────────────────────────────────

router.get('/calls', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { clientId, limit = '50', offset = '0', status } = req.query;
    const scope = agencyScope(req.user!);

    const where: any = {};
    if (scope.agencyId) where.client = { agencyId: scope.agencyId };
    if (clientId) where.clientId = String(clientId);
    if (status) where.status = String(status);

    const [calls, total] = await Promise.all([
      prisma.call.findMany({
        where,
        include: {
          client: { select: { id: true, name: true } },
          lead: { select: { id: true, phone: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
        skip: Number(offset),
      }),
      prisma.call.count({ where }),
    ]);

    res.json({ calls, total });
  } catch (err) {
    console.error('Error fetching calls:', err);
    res.status(500).json({ error: 'Failed to fetch calls' });
  }
});

// ─── Audit Logs ───────────────────────────────────────────────────────────────

router.get('/audit-logs', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { clientId, limit = '100', offset = '0' } = req.query;
    const scope = agencyScope(req.user!);

    const where: any = {};
    if (scope.agencyId) {
      where.client = { agencyId: scope.agencyId };
    }
    if (clientId) where.clientId = String(clientId);

    const logs = await prisma.auditLog.findMany({
      where,
      include: { client: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      skip: Number(offset),
    });

    res.json(logs);
  } catch (err) {
    console.error('Error fetching audit logs:', err);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// ─── Super-Admin: Agencies ────────────────────────────────────────────────────

router.get('/admin/agencies', requireAuth, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const agencies = await prisma.agency.findMany({
      include: {
        _count: { select: { users: true, clients: true } },
        clients: {
          select: {
            id: true,
            name: true,
            status: true,
            _count: { select: { leads: true, calls: true } },
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(agencies);
  } catch (err) {
    console.error('Error fetching agencies:', err);
    res.status(500).json({ error: 'Failed to fetch agencies' });
  }
});

router.patch('/admin/agencies/:id', requireAuth, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.body;
    if (!status || !['ACTIVE', 'SUSPENDED'].includes(status)) {
      res.status(400).json({ error: 'Status must be ACTIVE or SUSPENDED' });
      return;
    }
    const agency = await prisma.agency.update({
      where: { id: req.params.id },
      data: { status },
    });
    res.json(agency);
  } catch (err) {
    console.error('Error updating agency:', err);
    res.status(500).json({ error: 'Failed to update agency' });
  }
});

export default router;
