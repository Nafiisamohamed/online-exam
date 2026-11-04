/**
 * Notifications and simulated payments.
 *
 *   GET  /api/notifications           { items, unread }
 *   POST /api/notifications/read      mark all as read
 *   GET  /api/payments/fees           fee catalogue
 *   GET  /api/payments                my payments (admin: all)
 *   POST /api/payments                { provider: EVC_PLUS|ZAAD|EDAHAB, phone, fee } -> receipt (402 PAYMENT_FAILED)
 */
import { Router } from 'express';
import { z } from 'zod';
import { parse, zPhone } from '../lib/validate';
import { authenticate, currentUser } from '../middleware/auth';
import * as notifications from '../services/notification.service';
import * as paymentsService from '../services/payment.service';

export const miscRouter = Router();
miscRouter.use(authenticate);

miscRouter.get('/notifications', async (req, res) => {
  res.json(await notifications.listForUser(currentUser(req).id));
});

miscRouter.post('/notifications/read', async (req, res) => {
  await notifications.markAllRead(currentUser(req).id);
  res.json({ ok: true });
});

miscRouter.get('/payments/fees', (_req, res) => {
  res.json(Object.entries(paymentsService.FEES).map(([code, f]) => ({ code, ...f })));
});

miscRouter.get('/payments', async (req, res) => {
  res.json(await paymentsService.listPayments(currentUser(req)));
});

const feeCodes = Object.keys(paymentsService.FEES) as [paymentsService.FeeCode, ...paymentsService.FeeCode[]];
miscRouter.post('/payments', async (req, res) => {
  const body = parse(z.object({ provider: z.enum(['EVC_PLUS', 'ZAAD', 'EDAHAB']), phone: zPhone, fee: z.enum(feeCodes) }), req.body);
  res.status(201).json(await paymentsService.pay(currentUser(req), body));
});
