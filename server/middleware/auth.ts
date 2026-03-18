import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  userId: string;
  email: string;
  name: string | null;
  role: 'SUPER_ADMIN' | 'AGENCY_ADMIN';
  agencyId: string | null;
  agencyName: string | null;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

interface JwtPayload {
  userId: string;
  email: string;
  role: 'SUPER_ADMIN' | 'AGENCY_ADMIN';
  agencyId: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function decodeToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * requireAuth — validates JWT then does a live DB lookup so we can:
 *   - catch suspended agencies in real-time
 *   - always return fresh user/agency data
 */
export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const payload = decodeToken(token);
  if (!payload || !payload.userId) {
    // Old-format JWT (pre-multi-tenant) or malformed — force re-login
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { agency: true },
    });

    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    if (user.agency && user.agency.status === 'SUSPENDED') {
      res.status(403).json({ error: 'Account suspended. Please contact support.' });
      return;
    }

    req.user = {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role as 'SUPER_ADMIN' | 'AGENCY_ADMIN',
      agencyId: user.agencyId,
      agencyName: user.agency?.name ?? null,
    };

    next();
  } catch (err) {
    console.error('requireAuth DB error:', err);
    res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * requireSuperAdmin — must come after requireAuth
 */
export function requireSuperAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (req.user?.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Super admin access required' });
    return;
  }
  next();
}

/**
 * agencyScope — returns a Prisma `where` fragment that isolates data by agency.
 * Super admins bypass the filter and see everything.
 */
export function agencyScope(user: AuthUser): { agencyId?: string } {
  if (user.role === 'SUPER_ADMIN') return {};
  return { agencyId: user.agencyId as string };
}
