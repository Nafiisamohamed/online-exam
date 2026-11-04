/**
 * In-app notifications (bilingual) plus optional SMS through the SMS adapter.
 * Every message is stored in English and Somali; the UI shows the chosen language.
 */
import { prisma } from '../lib/prisma';
import { sms } from '../adapters/sms';

export interface BilingualText {
  en: string;
  so: string;
}

/**
 * Notifies users in the app; if `sendSms` is true, also writes an SMS (Somali, then English)
 * to the outbox for users that have a phone number.
 */
export async function notify(
  userIds: string[],
  title: BilingualText,
  body: BilingualText,
  sendSms = false,
): Promise<void> {
  if (userIds.length === 0) return;
  await prisma.notification.createMany({
    data: userIds.map((userId) => ({ userId, title: title.en, titleSo: title.so, body: body.en, bodySo: body.so })),
  });
  if (!sendSms) return;
  const users = await prisma.user.findMany({ where: { id: { in: userIds }, phone: { not: null } }, select: { phone: true } });
  for (const u of users) {
    await sms.send({ to: u.phone!, message: `${body.so} / ${body.en}` });
  }
}

/** Latest 50 notifications for a user and the unread count. */
export async function listForUser(userId: string) {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.notification.count({ where: { userId, read: false } }),
  ]);
  return { items, unread };
}

/** Marks all of a user's notifications as read. */
export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
}

/** SMS outbox for the admin screen (newest first). */
export async function listOutbox(limit = 200) {
  return prisma.smsOutbox.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
}
