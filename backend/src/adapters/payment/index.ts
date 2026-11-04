/**
 * Simulated mobile money. Generates a provider-style reference and always succeeds,
 * except for the test number ending in 0000 (to demo a failed payment).
 */
import { randomBytes } from 'node:crypto';
import type { PaymentAdapter, PaymentReceipt, PaymentRequest, MobileMoneyProvider } from './PaymentAdapter';

const PREFIX: Record<MobileMoneyProvider, string> = { EVC_PLUS: 'EVC', ZAAD: 'ZAD', EDAHAB: 'EDB' };

export class MockMobileMoneyAdapter implements PaymentAdapter {
  readonly name = 'mock-mobile-money';

  async charge(req: PaymentRequest): Promise<PaymentReceipt> {
    const reference = `${PREFIX[req.provider]}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
    const failed = req.phone.replace(/\D/g, '').endsWith('0000');
    return {
      provider: req.provider,
      reference,
      status: failed ? 'FAILED' : 'SUCCESS',
      amount: req.amount,
      phone: req.phone,
      paidAt: new Date(),
      message: failed ? 'Insufficient balance (simulated)' : 'Payment confirmed (simulated)',
    };
  }
}

export const payments: PaymentAdapter = new MockMobileMoneyAdapter();
export type { PaymentAdapter, PaymentReceipt, PaymentRequest, MobileMoneyProvider };
