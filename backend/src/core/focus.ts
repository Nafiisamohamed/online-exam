/**
 * Tab-switch (focus loss) and connection rules.
 * Every focus loss is logged; losses shorter than 1 second are kept but not counted.
 * From the 3rd counted switch the student sees a warning (any penalty is up to the lecturer).
 */
export const MIN_COUNTED_FOCUS_LOSS_MS = 1000;
export const FOCUS_WARNING_THRESHOLD = 3;

export const isCountedFocusLoss = (durationMs: number): boolean => durationMs >= MIN_COUNTED_FOCUS_LOSS_MS;

export const shouldWarn = (countedSwitches: number): boolean => countedSwitches >= FOCUS_WARNING_THRESHOLD;

/** Invigilator view: a student is "Disconnected" after 30 s without a heartbeat. */
export const DISCONNECT_AFTER_MS = 30_000;

export function isDisconnected(lastSeenAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - lastSeenAt.getTime() > DISCONNECT_AFTER_MS;
}
