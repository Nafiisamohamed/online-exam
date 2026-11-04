/**
 * Randomised exam generation (core technical challenge).
 *
 * An exam is defined by rules like "10 EASY, 8 MEDIUM, 5 HARD from topics X, Y".
 * Every student gets the same number of questions at each difficulty (equal
 * difficulty) but a different random draw from the pools (different sets).
 *
 * Feasibility uses Hall's marriage theorem: rules can share questions (for example two
 * MEDIUM rules with overlapping topics), so it is not enough that each pool alone is
 * big enough. For every group S of rules, the union of their pools must hold at least
 * the sum of their counts. If that holds, a valid draw always exists.
 */
import { shuffle } from '../lib/random';

export type DifficultyLevel = 'EASY' | 'MEDIUM' | 'HARD';

export interface PoolQuestion {
  id: string;
  difficulty: DifficultyLevel;
  topic: string;
}

export interface RuleSpec {
  difficulty: DifficultyLevel;
  count: number;
  /** Empty = any topic */
  topics: string[];
}

export interface RuleShortage {
  ruleIndex: number;
  difficulty: DifficultyLevel;
  topics: string[];
  required: number;
  available: number;
}

export interface FeasibilityResult {
  ok: boolean;
  /** Rules whose pool alone is smaller than their count */
  shortages: RuleShortage[];
  /** Set when each pool is big enough alone but rules compete for the same questions */
  overlapProblem?: { ruleIndexes: number[]; required: number; available: number };
}

const norm = (s: string) => s.trim().toLowerCase();

/** Questions a single rule may draw from. */
export function poolForRule<T extends PoolQuestion>(rule: RuleSpec, bank: readonly T[]): T[] {
  const topics = rule.topics.map(norm).filter(Boolean);
  return bank.filter(
    (q) => q.difficulty === rule.difficulty && (topics.length === 0 || topics.includes(norm(q.topic))),
  );
}

/**
 * Checks the bank has enough questions for every rule (used to block saving).
 * Exact for up to 12 rules (checks all 4096 rule groups); real exams have 1-6 rules.
 */
export function checkFeasibility(rules: readonly RuleSpec[], bank: readonly PoolQuestion[]): FeasibilityResult {
  const pools = rules.map((r) => new Set(poolForRule(r, bank).map((q) => q.id)));
  const shortages: RuleShortage[] = [];
  rules.forEach((r, i) => {
    if (pools[i].size < r.count) {
      shortages.push({
        ruleIndex: i,
        difficulty: r.difficulty,
        topics: r.topics,
        required: r.count,
        available: pools[i].size,
      });
    }
  });
  if (shortages.length > 0) return { ok: false, shortages };

  const n = Math.min(rules.length, 12);
  for (let mask = 1; mask < 1 << n; mask++) {
    if ((mask & (mask - 1)) === 0) continue; // single rules were checked above
    const union = new Set<string>();
    let required = 0;
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        idx.push(i);
        required += rules[i].count;
        pools[i].forEach((id) => union.add(id));
      }
    }
    if (union.size < required) {
      return { ok: false, shortages: [], overlapProblem: { ruleIndexes: idx, required, available: union.size } };
    }
  }
  return { ok: true, shortages: [] };
}

/**
 * Draws one random paper. Rules with the smallest pools are filled first so shared
 * questions go where they are needed most; an unlucky draw is retried.
 * @returns the chosen questions (each question at most once), in rule order
 * @throws Error if the rules are not feasible for this bank
 */
export function drawQuestions<T extends PoolQuestion>(rules: readonly RuleSpec[], bank: readonly T[]): T[] {
  const feasibility = checkFeasibility(rules, bank);
  if (!feasibility.ok) throw new Error('Question bank does not have enough questions for the exam rules');

  for (let attempt = 0; attempt < 50; attempt++) {
    const used = new Set<string>();
    const order = rules
      .map((rule, index) => ({ rule, index, pool: poolForRule(rule, bank) }))
      .sort((a, b) => a.pool.length - b.pool.length);
    const picked: T[][] = rules.map(() => []);
    let failed = false;
    for (const { rule, index, pool } of order) {
      const free = shuffle(pool.filter((q) => !used.has(q.id)));
      if (free.length < rule.count) {
        failed = true;
        break;
      }
      const chosen = free.slice(0, rule.count);
      chosen.forEach((q) => used.add(q.id));
      picked[index] = chosen;
    }
    if (!failed) return picked.flat();
  }
  throw new Error('Could not generate an exam from the question bank');
}

/** Count of questions per difficulty. Two papers with the same profile have equal difficulty. */
export function difficultyProfile(
  questions: readonly { difficulty: DifficultyLevel }[],
): Record<DifficultyLevel, number> {
  const profile: Record<DifficultyLevel, number> = { EASY: 0, MEDIUM: 0, HARD: 0 };
  questions.forEach((q) => profile[q.difficulty]++);
  return profile;
}

/** Order-insensitive key of a question set, used to avoid giving two students an identical set. */
export function setKey(ids: readonly string[]): string {
  return [...ids].sort().join(',');
}
