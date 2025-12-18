import { Request, Response, NextFunction } from 'express';
import { createAuditLog } from '../lib/audit.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
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

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}
