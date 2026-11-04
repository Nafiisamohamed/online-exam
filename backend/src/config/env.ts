/**
 * Environment configuration.
 *
 * Reads settings from process.env (loaded from backend/.env by dotenv) and validates
 * them with zod so the server fails fast with a clear message instead of misbehaving.
 * Output: a typed, frozen `env` object used across the backend.
 * Errors: throws at import time if a required setting is missing or invalid.
 */
import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().int().positive().default(4000),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  CORS_ORIGINS: z.string().default('*'),
  TRUST_PROXY: bool,
  DEADLINE_GRACE_SECONDS: z.coerce.number().min(0).max(30).default(2),
  ENFORCE_NETWORK: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  DEFAULT_STUDENT_PASSWORD: z.string().min(8).default('Arday@2025'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(600),
  LOGIN_RATE_LIMIT_PER_15MIN: z.coerce.number().int().positive().default(20),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}\nSee backend/.env.example`);
}

export const env = Object.freeze(parsed.data);
export type Env = typeof env;
