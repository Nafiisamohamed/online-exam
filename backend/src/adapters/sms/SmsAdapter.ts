/**
 * SMS adapter interface.
 *
 * The platform never calls an SMS gateway directly; it uses this interface. The demo
 * uses OutboxSmsAdapter, which writes messages to the in-app `SmsOutbox` table.
 * A real gateway (e.g. Hormuud or Somtel bulk SMS) could be added by implementing
 * `send` and switching the export in ./index.ts.
 */
export interface SmsMessage {
  to: string;
  message: string;
}

export interface SmsResult {
  id: string;
  status: 'QUEUED' | 'SENT' | 'FAILED';
}

export interface SmsAdapter {
  readonly name: string;
  send(msg: SmsMessage): Promise<SmsResult>;
}
