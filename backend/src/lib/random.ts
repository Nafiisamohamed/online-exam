/**
 * Cryptographically secure randomness for exam generation.
 *
 * Math.random is predictable; exam sets and option orders use node:crypto so students
 * cannot guess or reproduce another student's paper.
 */
import { randomInt } from 'node:crypto';

/** Returns a new array with the items in a uniformly random order (Fisher-Yates). */
export function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Picks `count` distinct random items. Throws if there are not enough items. */
export function sample<T>(items: readonly T[], count: number): T[] {
  if (count > items.length) throw new Error(`Cannot sample ${count} from ${items.length}`);
  return shuffle(items).slice(0, count);
}
