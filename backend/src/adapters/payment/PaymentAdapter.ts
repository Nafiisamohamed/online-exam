/**
 * Mobile money payment adapter interface (EVC Plus, Zaad, eDahab).
 *
 * The platform only depends on this interface. The demo uses MockMobileMoneyAdapter,
 * which simulates the USSD/PIN confirmation and returns a receipt without moving money.
 */
export type MobileMoneyProvider = 'EVC_PLUS' | 'ZAAD' | 'EDAHAB';

export interface PaymentRequest {
  provider: MobileMoneyProvider;
  phone: string;
  amount: number;
  purpose: string;
}

export interface PaymentReceipt {
  provider: MobileMoneyProvider;
  reference: string;
  status: 'SUCCESS' | 'FAILED';
  amount: number;
  phone: string;
  paidAt: Date;
  message: string;
}

export interface PaymentAdapter {
  readonly name: string;
  charge(req: PaymentRequest): Promise<PaymentReceipt>;
}
