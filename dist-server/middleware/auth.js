import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@switchboard.local';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
export async function verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
}
export async function hashPassword(password) {
    return bcrypt.hash(password, 10);
}
export function generateToken(email) {
    return jwt.sign({ email, isAdmin: true }, JWT_SECRET, { expiresIn: '7d' });
}
export function verifyToken(token) {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        return decoded;
    }
    catch (error) {
        return null;
    }
}
export async function authenticateAdmin(email, password) {
    if (email !== ADMIN_EMAIL) {
        return null;
    }
    if (!ADMIN_PASSWORD_HASH) {
        console.error('ADMIN_PASSWORD_HASH not configured');
        return null;
    }
    const isValid = await verifyPassword(password, ADMIN_PASSWORD_HASH);
    if (!isValid) {
        return null;
    }
    return generateToken(email);
}
export function requireAuth(req, res, next) {
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    const user = verifyToken(token);
    if (!user) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
    }
    req.user = user;
    next();
}
