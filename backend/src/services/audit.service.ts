/**
 * Audit log service: records who did what, when, for sensitive actions
 * (logins, enrolments, question edits, exam approval, time extensions, grading,
 * publishing results, payments...).
 */
import { prisma, type Tx } from '../lib/prisma';
import type { Prisma } from '@prisma/client';

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  details?: Prisma.InputJsonValue;
  ip?: string | null;
}

/** Writes one audit row. Accepts an optional transaction client. Never throws to the caller. */
export async function audit(entry: AuditEntry, tx: Tx = prisma): Promise<void> {
  try {
    await tx.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        details: entry.details,
        ip: entry.ip ?? null,
      },
    });
  } catch (err) {
    console.error('Audit log write failed', err);
  }
}

/**
 * Lists audit entries, newest first.
 * @param filter optional action/entity/user filters, page (1-based), pageSize (max 100)
 */
export async function listAudit(filter: { action?: string; entity?: string; userId?: string; page: number; pageSize: number }) {
  const where: Prisma.AuditLogWhereInput = {
    action: filter.action ? { contains: filter.action, mode: 'insensitive' } : undefined,
    entity: filter.entity || undefined,
    userId: filter.userId || undefined,
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filter.page - 1) * filter.pageSize,
      take: filter.pageSize,
      include: { user: { select: { fullName: true, username: true, role: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { items, total, page: filter.page, pageSize: filter.pageSize };
}
