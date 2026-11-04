/**
 * Authentication service.
 *
 * - Passwords are hashed with bcrypt (cost 10) and never returned by the API.
 * - Login accepts a username or a student ID.
 * - Issues a signed JWT (HS256) holding only the user id and role.
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { AppError, unauthorized } from '../lib/errors';
import { audit } from './audit.service';
import type { AuthUser } from '../middleware/auth';

const BCRYPT_COST = 10;
/** Compared against when the user does not exist, so response time does not reveal valid usernames. */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, BCRYPT_COST);
export const verifyPassword = (plain: string, hash: string): Promise<boolean> => bcrypt.compare(plain, hash);

interface TokenPayload {
  sub: string;
  role: string;
}

/** Signs a JWT for the user. */
export function signToken(user: { id: string; role: string }): string {
  return jwt.sign({ sub: user.id, role: user.role }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
  });
}

/** Verifies a JWT. Errors: 401 if expired, tampered or malformed. */
export function verifyToken(token: string): TokenPayload {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') throw new Error('bad payload');
    return payload as TokenPayload;
  } catch {
    throw unauthorized('Session expired, please log in again');
  }
}

const authSelect = { id: true, username: true, fullName: true, role: true, studentId: true } as const;

/** Loads an active user by id (used by the auth middleware on every request). */
export async function findActiveUser(id: string): Promise<AuthUser | null> {
  return prisma.user.findFirst({ where: { id, isActive: true }, select: authSelect });
}

/**
 * Logs a user in.
 * @param identifier username or student ID (case-insensitive)
 * @returns token and public user profile
 * Errors: 401 INVALID_CREDENTIALS (same message whether the user exists or not)
 */
export async function login(identifier: string, password: string, ip?: string) {
  const id = identifier.trim();
  const user = await prisma.user.findFirst({
    where: {
      isActive: true,
      OR: [
        { username: { equals: id, mode: 'insensitive' } },
        { studentId: { equals: id, mode: 'insensitive' } },
      ],
    },
  });
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    await audit({ userId: user?.id, action: 'LOGIN_FAILED', entity: 'User', details: { identifier: id }, ip });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Wrong username or password');
  }
  await audit({ userId: user.id, action: 'LOGIN', entity: 'User', entityId: user.id, ip });
  return {
    token: signToken(user),
    user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role, studentId: user.studentId },
  };
}

/** Changes the current user's password after checking the old one. Errors: 400 WRONG_PASSWORD. */
export async function changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(oldPassword, user.passwordHash))) {
    throw new AppError(400, 'WRONG_PASSWORD', 'Current password is wrong');
  }
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
  await audit({ userId, action: 'PASSWORD_CHANGED', entity: 'User', entityId: userId });
}

/** Public profile of the current user. */
export async function me(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { ...authSelect, phone: true, email: true, createdAt: true },
  });
}
