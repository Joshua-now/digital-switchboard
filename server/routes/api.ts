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
    const { active, callWithinSeconds, instructions, transferNumber, provider } = req.body;

    const config = await prisma.routingConfig.upsert({
      where: { clientId: id },
      create: {
        clientId: id,
        active: active ?? true,
        callWithinSeconds: callWithinSeconds ?? 60,
        instructions: instructions || '',
        transferNumber: transferNumber || null,
        provider: provider || 'BLAND',
      },
      update: {
        active,
        callWithinSeconds,
        instructions,
        transferNumber: transferNumber || null,
        ...(provider && { provider }),
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

// CLEAR TEST DATA (for development)
router.delete('/leads/clear-test', async (req: AuthRequest, res: Response) => {
  try {
    const client = await prisma.client.findFirst({
      where: { ghlLocationId: 'aiteammate-system' },
    });

    if (!client) {
      res.status(200).json({ message: 'No test client found' });
      return;
    }

    // Delete calls first (foreign key constraint)
    const callsDeleted = await prisma.call.deleteMany({
      where: { clientId: client.id },
    });

    // Then delete leads
    const leadsDeleted = await prisma.lead.deleteMany({
      where: { clientId: client.id },
    });

    res.status(200).json({
      message: 'Test data cleared',
      leadsDeleted: leadsDeleted.count,
      callsDeleted: callsDeleted.count,
    });
  } catch (error: any) {
    console.error('Error clearing test data:', error);
    res.status(500).json({ error: 'Failed to clear test data' });
  }
});

// DIRECT LEAD INGESTION (for aiteammate.io forms, n8n, etc.)
router.post('/leads/create', async (req: AuthRequest, res: Response) => {
  try {
    const { firstName, lastName, phone, email, company, product, source } = req.body;

    if (!phone) {
      res.status(400).json({ error: 'Phone number required' });
      return;
    }

    if (!product) {
      res.status(400).json({ error: 'Product field required (after-hours, speed-to-lead, complete-package)' });
      return;
    }

    // Product-to-Assistant mapping
    const productConfig: Record<string, { assistantId: string; name: string }> = {
      'after-hours': {
        assistantId: '02b7b95b-d522-4750-ae79-97323af6473b',
        name: 'After Hours - Maya',
      },
      'speed-to-lead': {
        assistantId: 'c65e4f2c-be50-4d6f-b2f8-8c8a28cd7ccc',
        name: 'Speed to Lead - Anna',
      },
      'complete-package': {
        assistantId: '2c902658-5f8d-4ac7-aa87-43e3916f53bb',
        name: 'Complete Package - Riley',
      },
    };

    const config = productConfig[product];
    if (!config) {
      res.status(400).json({ 
        error: 'Invalid product',
        validProducts: Object.keys(productConfig),
      });
      return;
    }

    // Create a "system" client for aiteammate.io leads if it doesn't exist
    let client = await prisma.client.findFirst({
      where: { ghlLocationId: 'aiteammate-system' },
    });

    if (!client) {
      client = await prisma.client.create({
        data: {
          name: 'AI Teammate (System)',
          ghlLocationId: 'aiteammate-system',
          timezone: 'America/New_York',
          quietHoursStart: '23:00',
          quietHoursEnd: '07:00',
          status: 'ACTIVE',
        },
      });
    }

    // Create lead
    const digitsOnly = phone.replace(/\D/g, '');
    const normalizedPhone = digitsOnly.startsWith('1') ? `+${digitsOnly}` : `+1${digitsOnly}`;
    const dedupeKey = `${digitsOnly}-${product}`;

    const existingLead = await prisma.lead.findFirst({
      where: {
        clientId: client.id,
        dedupeKey,
      },
    });

    if (existingLead) {
      res.status(200).json({
        message: 'Lead already exists',
        leadId: existingLead.id,
        duplicate: true,
      });
      return;
    }

    const lead = await prisma.lead.create({
      data: {
        clientId: client.id,
        firstName: firstName || null,
        lastName: lastName || null,
        phone: digitsOnly,
        email: email || null,
        source: source || 'aiteammate.io',
        payloadJson: { product, company, config: config.name },
        dedupeKey,
        callStatus: 'NEW',
      },
    });

    await createAuditLog('LEAD_CREATED', `Lead created for ${config.name}`, client.id, {
      leadId: lead.id,
      product,
    });

    // Immediately trigger Vapi call
    const vapiApiKey = process.env.VAPI_API_KEY;
    if (!vapiApiKey) {
      res.status(500).json({ error: 'VAPI_API_KEY not configured' });
      return;
    }

    const call = await prisma.call.create({
      data: {
        clientId: client.id,
        leadId: lead.id,
        provider: 'VAPI',
        status: 'CREATED',
      },
    });

    const vapiPayload = {
      assistantId: config.assistantId,
      customer: {
        number: normalizedPhone,
      },
      assistantOverrides: {
        variableValues: {
          firstName: firstName || 'there',
          company: company || '',
          transferNumber: process.env.TRANSFER_NUMBER || '+13214719858',
        },
        recordingEnabled: true,
      },
      metadata: {
        leadId: lead.id,
        product,
        internalCallId: call.id,
      },
    };

    console.log('[VAPI] Initiating call', {
      product: config.name,
      phone: normalizedPhone,
      assistantId: config.assistantId,
    });

    const vapiResponse = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${vapiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(vapiPayload),
    });

    const vapiData: any = await vapiResponse.json();

    console.log('[VAPI] Response', {
      status: vapiResponse.status,
      ok: vapiResponse.ok,
      data: vapiData,
    });

    if (vapiResponse.ok && vapiData.id) {
      await prisma.call.update({
        where: { id: call.id },
        data: {
          providerCallId: vapiData.id,
          status: 'IN_PROGRESS',
          startedAt: new Date(),
        },
      });

      await prisma.lead.update({
        where: { id: lead.id },
        data: { callStatus: 'CALLING' },
      });

      await createAuditLog('CALL_INITIATED', `Vapi call initiated - ${config.name}`, client.id, {
        leadId: lead.id,
        callId: vapiData.id,
        product,
      });

      res.status(201).json({
        success: true,
        leadId: lead.id,
        callId: vapiData.id,
        message: `AI will call ${normalizedPhone} within 60 seconds`,
        agent: config.name,
      });
    } else {
      const error = vapiData.error || vapiData.message || 'Call failed';
      
      await prisma.call.update({
        where: { id: call.id },
        data: { status: 'FAILED', outcome: error },
      });

      await prisma.lead.update({
        where: { id: lead.id },
        data: { callStatus: 'FAILED', skipReason: error },
      });

      res.status(500).json({
        success: false,
        error,
        leadId: lead.id,
      });
    }
  } catch (error: any) {
    console.error('Error creating lead:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

export default router;
