/**
 * Server-side exam timing (core technical challenge).
 *
 * The server is the only clock that matters. The browser only displays
 * `remainingMs` returned by the API, so changing the device clock has no effect.
 */

export const MINUTE_MS = 60_000;
/** Maximum extra time one invigilator extension may add (spec: up to 15 minutes). */
export const MAX_EXTENSION_MINUTES = 15;

/**
 * Deadline for an attempt.
 * Rule: the student has `durationMinutes` from their start, but must finish by the
 * window end even if the duration is not used up. Invigilator extensions are added on
 * top (an extension compensates for lost time, so it may pass the window end).
 * @param startedAt server time the attempt started
 * @param durationMinutes exam duration
 * @param windowEnd end of the exam window
 * @param extraMinutes total invigilator extensions for this student
 */
export function computeDeadline(
  startedAt: Date,
  durationMinutes: number,
  windowEnd: Date,
  extraMinutes = 0,
): Date {
  const byDuration = startedAt.getTime() + durationMinutes * MINUTE_MS;
  const base = Math.min(byDuration, windowEnd.getTime());
  return new Date(base + extraMinutes * MINUTE_MS);
}

/** Milliseconds left before the deadline (never negative). */
export function remainingMs(deadlineAt: Date, now: Date = new Date()): number {
  return Math.max(0, deadlineAt.getTime() - now.getTime());
}

/**
 * True if a request arriving at `now` is too late.
 * @param graceSeconds small allowance for network delay (configurable, default 2s)
 */
export function isPastDeadline(deadlineAt: Date, now: Date = new Date(), graceSeconds = 0): boolean {
  return now.getTime() > deadlineAt.getTime() + graceSeconds * 1000;
}

export type WindowState = 'NOT_OPEN' | 'OPEN' | 'CLOSED';

/** Whether a student may start now. */
export function windowState(windowStart: Date, windowEnd: Date, now: Date = new Date()): WindowState {
  if (now < windowStart) return 'NOT_OPEN';
  if (now >= windowEnd) return 'CLOSED';
  return 'OPEN';
}

/** Duration must be positive and fit inside the window. */
export function durationFitsWindow(windowStart: Date, windowEnd: Date, durationMinutes: number): boolean {
  return durationMinutes > 0 && windowEnd.getTime() - windowStart.getTime() >= durationMinutes * MINUTE_MS;
}

/** True if two time ranges overlap (touching end-to-start does not count). */
export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}
