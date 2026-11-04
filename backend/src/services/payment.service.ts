/**
 * Simulated mobile money payments (EVC Plus, Zaad, eDahab) for exam fees such as a
 * resit / re-mark request. Uses the PaymentAdapter interface; stores the receipt and
 * sends a confirmation SMS to the outbox.
 */
import { prisma } from '../lib/prisma';
import { payments, type MobileMoneyProvider } from '../adapters/payment';
import { sms } from '../adapters/sms';
import { AppError } from '../lib/errors';
import { audit } from './audit.service';
import type { AuthUser } from '../middleware/auth';

/** Fee catalogue (USD). Kept in code because the brief has no fee management feature. */
export const FEES = {
  RESIT_EXAM: { amount: 10, en: 'Resit exam fee', so: 'Lacagta imtixaanka dib-u-qaadashada' },
  REMARK_REQUEST: { amount: 5, en: 'Re-mark request fee', so: 'Lacagta codsiga dib-u-saxidda' },
  TRANSCRIPT: { amount: 3, en: 'Result transcript', so: 'Warqadda natiijada' },
} as const;
export type FeeCode = keyof typeof FEES;

/**
 * Charges a fee through the mock adapter.
 * Errors: 402 PAYMENT_FAILED (simulated: numbers ending in 0000 fail).
 */
export async function pay(user: AuthUser, input: { provider: MobileMoneyProvider; phone: string; fee: FeeCode }) {
  const fee = FEES[input.fee];
  const receipt = await payments.charge({ provider: input.provider, phone: input.phone, amount: fee.amount, purpose: fee.en });
  const payment = await prisma.payment.create({
    data: {
      userId: user.id,
      provider: input.provider,
      phone: input.phone,
      amount: fee.amount,
      purpose: input.fee,
      reference: receipt.reference,
      status: receipt.status,
    },
  });
  await audit({ userId: user.id, action: receipt.status === 'SUCCESS' ? 'PAYMENT_SUCCESS' : 'PAYMENT_FAILED', entity: 'Payment', entityId: payment.id, details: { provider: input.provider, amount: fee.amount, reference: receipt.reference } });
  if (receipt.status !== 'SUCCESS') {
    throw new AppError(402, 'PAYMENT_FAILED', receipt.message, { reference: receipt.reference });
  }
  await sms.send({
    to: input.phone,
    message: `[${input.provider}] Waxaad bixisay $${fee.amount} (${fee.so}). Tix: ${receipt.reference} / You paid $${fee.amount} (${fee.en}). Ref: ${receipt.reference}`,
  });
  return { ...payment, purposeText: { en: fee.en, so: fee.so } };
}

/** Payments of the current user, or all payments for admins. */
export async function listPayments(user: AuthUser) {
  return prisma.payment.findMany({
    where: user.role === 'ADMIN' ? {} : { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { user: { select: { fullName: true, studentId: true } } },
  });
}
