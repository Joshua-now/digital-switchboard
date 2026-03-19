import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/db.js';
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
// ─── Helpers ──────────────────────────────────────────────────────────────────
export async function verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
}
export async function hashPassword(password) {
    return bcrypt.hash(password, 10);
}
export function generateToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}
export function decodeToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    }
    catch {
        return null;
    }
}
// ─── Middleware ───────────────────────────────────────────────────────────────
/**
 * requireAuth — validates JWT then does a live DB lookup so we can:
 *   - catch suspended agencies in real-time
 *   - always return fresh user/agency data
 */
export async function requireAuth(req, res, next) {
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
            role: user.role,
            agencyId: user.agencyId,
            agencyName: user.agency?.name ?? null,
        };
        next();
    }
    catch (err) {
        console.error('requireAuth DB error:', err);
        res.status(500).json({ error: 'Authentication error' });
    }
}
/**
 * requireSuperAdmin — must come after requireAuth
 */
export function requireSuperAdmin(req, res, next) {
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
export function agencyScope(user) {
    if (user.role === 'SUPER_ADMIN')
        return {};
    return { agencyId: user.agencyId };
}
