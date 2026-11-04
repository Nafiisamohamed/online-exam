/**
 * Data access layer entry point.
 *
 * A single shared PrismaClient. Only service modules import this - routes and the
 * frontend never touch the database directly (layered architecture rule).
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/** Transaction client type, so services can share logic inside `prisma.$transaction`. */
export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
