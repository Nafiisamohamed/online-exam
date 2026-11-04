/**
 * Auth endpoints.
 *   POST /api/auth/login            { identifier, password } -> { token, user }   (rate limited)
 *   GET  /api/auth/me               -> current user profile
 *   POST /api/auth/change-password  { currentPassword, newPassword } -> { ok }
 */
import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../lib/validate';
import { authenticate, currentUser } from '../middleware/auth';
import { loginLimiter } from '../middleware/rateLimit';
import * as auth from '../services/auth.service';

export const authRouter = Router();

const loginSchema = z.object({
  identifier: z.string().trim().min(2).max(64),
  password: z.string().min(1).max(128),
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const body = parse(loginSchema, req.body);
  res.json(await auth.login(body.identifier, body.password, req.ip));
});

authRouter.get('/me', authenticate, async (req, res) => {
  res.json(await auth.me(currentUser(req).id));
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z
    .string()
    .min(8, 'At least 8 characters')
    .max(128)
    .regex(/[A-Za-z]/, 'Must contain a letter')
    .regex(/[0-9]/, 'Must contain a number'),
});

authRouter.post('/change-password', authenticate, async (req, res) => {
  const body = parse(passwordSchema, req.body);
  await auth.changePassword(currentUser(req).id, body.currentPassword, body.newPassword);
  res.json({ ok: true });
});
