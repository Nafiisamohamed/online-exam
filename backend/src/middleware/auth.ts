/**
 * Authentication and role-based authorisation middleware.
 *
 * authenticate: reads `Authorization: Bearer <JWT>`, verifies it, and loads the user
 *   from the database on EVERY request (so deactivated users lose access immediately).
 *   Sets `req.user`. Errors: 401 UNAUTHORIZED.
 * requireRole(...roles): 403 FORBIDDEN unless req.user.role is one of `roles`.
 *
 * Permissions are always enforced here on the server - hiding buttons in the UI is
 * only for convenience.
 */
import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { verifyToken, findActiveUser } from '../services/auth.service';
import { forbidden, unauthorized } from '../lib/errors';

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  studentId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  // Several routers share the /api prefix; verify only once per request.
  if (req.user) return next();
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  const payload = verifyToken(header.slice(7));
  const user = await findActiveUser(payload.sub);
  if (!user) throw unauthorized('Account not found or disabled');
  req.user = user;
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };
}

/** Returns req.user or throws 401 - for use inside route handlers after authenticate. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
