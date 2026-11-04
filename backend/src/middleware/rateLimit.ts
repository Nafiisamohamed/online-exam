/**
 * Rate limiting for the network API.
 *
 * apiLimiter: general per-IP limit per minute (a full exam room shares no IP in a lab,
 *   but behind NAT they might, so the default is generous: 600/min).
 * loginLimiter: strict per-IP limit on login attempts to slow down password guessing.
 * Errors: 429 with { error: { code: 'RATE_LIMITED' } }.
 */
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

const handler = (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
  res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down' } });

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.RATE_LIMIT_PER_MINUTE,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.LOGIN_RATE_LIMIT_PER_15MIN,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler,
});
