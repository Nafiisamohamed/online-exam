/**
 * Simulated SMS: OutboxSmsAdapter stores each message in the SmsOutbox table so
 * admins can read it on the "SMS Outbox" screen. Nothing leaves the server.
 */
import { prisma } from '../../lib/prisma';
import type { SmsAdapter, SmsMessage, SmsResult } from './SmsAdapter';

export class OutboxSmsAdapter implements SmsAdapter {
  readonly name = 'outbox';

  /** Writes the message to the outbox. Returns its id with status SENT (simulated). */
  async send(msg: SmsMessage): Promise<SmsResult> {
    const row = await prisma.smsOutbox.create({
      data: { toPhone: msg.to, message: msg.message.slice(0, 640), provider: this.name, status: 'SENT' },
    });
    return { id: row.id, status: 'SENT' };
  }
}

/** The adapter used by the app. Swap here to use a real gateway. */
export const sms: SmsAdapter = new OutboxSmsAdapter();
export type { SmsAdapter, SmsMessage, SmsResult };
