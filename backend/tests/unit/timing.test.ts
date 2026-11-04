/** Core challenge: the server clock decides the deadline. */
import { describe, expect, it } from 'vitest';
import { computeDeadline, durationFitsWindow, isPastDeadline, rangesOverlap, remainingMs, windowState } from '../../src/core/timing';

const t = (hhmm: string) => new Date(`2026-11-10T${hhmm}:00.000Z`);

describe('server-side timing', () => {
  it('deadline = start + duration when it fits in the window', () => {
    expect(computeDeadline(t('09:00'), 60, t('11:00'))).toEqual(t('10:00'));
  });

  it('must finish by the window end even if duration is not used up', () => {
    // Starts 10:30 with 60 minutes, but the window closes at 11:00.
    expect(computeDeadline(t('10:30'), 60, t('11:00'))).toEqual(t('11:00'));
  });

  it('adds invigilator extensions on top', () => {
    expect(computeDeadline(t('10:30'), 60, t('11:00'), 10)).toEqual(t('11:10'));
  });

  it('rejects requests after the deadline, allowing only the network grace', () => {
    const deadline = t('10:00');
    expect(isPastDeadline(deadline, new Date(deadline.getTime() + 1500), 2)).toBe(false);
    expect(isPastDeadline(deadline, new Date(deadline.getTime() + 2500), 2)).toBe(true);
    expect(remainingMs(deadline, t('09:59'))).toBe(60_000);
    expect(remainingMs(deadline, t('10:05'))).toBe(0);
  });

  it('checks the window and duration rules', () => {
    expect(windowState(t('09:00'), t('11:00'), t('08:59'))).toBe('NOT_OPEN');
    expect(windowState(t('09:00'), t('11:00'), t('10:00'))).toBe('OPEN');
    expect(windowState(t('09:00'), t('11:00'), t('11:00'))).toBe('CLOSED');
    expect(durationFitsWindow(t('09:00'), t('11:00'), 120)).toBe(true);
    expect(durationFitsWindow(t('09:00'), t('11:00'), 121)).toBe(false);
  });

  it('detects overlapping exam windows (back-to-back is fine)', () => {
    expect(rangesOverlap(t('09:00'), t('11:00'), t('10:00'), t('12:00'))).toBe(true);
    expect(rangesOverlap(t('09:00'), t('11:00'), t('11:00'), t('12:00'))).toBe(false);
  });
});
