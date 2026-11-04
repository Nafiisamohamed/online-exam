/**
 * Server-side input validation helpers (zod).
 *
 * parse(schema, data) returns typed, validated data or throws ZodError,
 * which the error middleware turns into 400 VALIDATION_ERROR.
 * Every route validates its body, query and params with this before calling a service.
 */
import { z, type ZodTypeAny } from 'zod';

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data);
}

/** Common reusable field schemas. */
export const zId = z.string().min(1).max(64);
export const zIdParam = z.object({ id: zId });
export const zText = (max = 5000) => z.string().trim().min(1).max(max);
export const zPhone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ]{7,16}$/, 'Phone must be digits, e.g. +252 61 5123456');
export const zDifficulty = z.enum(['EASY', 'MEDIUM', 'HARD']);
export const zQuestionType = z.enum(['MCQ', 'TRUE_FALSE', 'SHORT_ANSWER', 'ESSAY']);
