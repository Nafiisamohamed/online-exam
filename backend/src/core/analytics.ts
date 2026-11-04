/**
 * Question analytics (item analysis).
 *
 * Difficulty index p = share of students who got the question right (0..1).
 * Discrimination D = p(top 27% of students by total score) - p(bottom 27%).
 *   D near +1: strong students get it right and weak ones do not (good question).
 *   D near 0 or negative: the question does not separate students (review it).
 * Questions with p < 0.20 or p > 0.95 are flagged for review.
 * With fewer than 5 answers the numbers are not meaningful: "Not enough data".
 */
export const MIN_RESPONSES = 5;
export const FLAG_LOW = 0.2;
export const FLAG_HIGH = 0.95;

export interface ItemResponse {
  attemptId: string;
  /** Student's total exam score (used to rank top and bottom groups) */
  totalScore: number;
  correct: boolean;
}

export interface ItemStats {
  responses: number;
  enoughData: boolean;
  difficultyIndex: number | null;
  discrimination: number | null;
  flagged: boolean;
  flagReason: 'TOO_HARD' | 'TOO_EASY' | null;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Difficulty and discrimination for one question. */
export function itemStats(responses: readonly ItemResponse[]): ItemStats {
  const n = responses.length;
  if (n < MIN_RESPONSES) {
    return { responses: n, enoughData: false, difficultyIndex: null, discrimination: null, flagged: false, flagReason: null };
  }
  const p = responses.filter((r) => r.correct).length / n;
  const sorted = [...responses].sort((a, b) => b.totalScore - a.totalScore);
  const groupSize = Math.max(1, Math.round(n * 0.27));
  const top = sorted.slice(0, groupSize);
  const bottom = sorted.slice(-groupSize);
  const pTop = top.filter((r) => r.correct).length / groupSize;
  const pBottom = bottom.filter((r) => r.correct).length / groupSize;
  const flagReason = p < FLAG_LOW ? 'TOO_HARD' : p > FLAG_HIGH ? 'TOO_EASY' : null;
  return {
    responses: n,
    enoughData: true,
    difficultyIndex: round3(p),
    discrimination: round3(pTop - pBottom),
    flagged: flagReason !== null,
    flagReason,
  };
}

export interface ExamStats {
  count: number;
  average: number | null;
  highest: number | null;
  lowest: number | null;
  /** 10 buckets of percentage: 0-9, 10-19, ... 90-100 */
  distribution: { range: string; count: number }[];
}

/** Summary statistics over percentage scores. */
export function examStats(percentages: readonly number[]): ExamStats {
  const distribution = Array.from({ length: 10 }, (_, i) => ({
    range: i === 9 ? '90-100' : `${i * 10}-${i * 10 + 9}`,
    count: 0,
  }));
  percentages.forEach((p) => distribution[Math.min(9, Math.max(0, Math.floor(p / 10)))].count++);
  if (percentages.length === 0) return { count: 0, average: null, highest: null, lowest: null, distribution };
  const sum = percentages.reduce((a, b) => a + b, 0);
  return {
    count: percentages.length,
    average: Math.round((sum / percentages.length) * 100) / 100,
    highest: Math.max(...percentages),
    lowest: Math.min(...percentages),
    distribution,
  };
}
