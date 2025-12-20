import { createAuditLog } from '../lib/audit.js';
export function errorHandler(err, req, res, next) {
    console.error('Error:', err);
    createAuditLog('ERROR', err.message, undefined, {
        stack: err.stack,
        url: req.url,
        method: req.method,
    }).catch(console.error);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
}
export function notFoundHandler(req, res) {
    res.status(404).json({ error: 'Not found' });
}
