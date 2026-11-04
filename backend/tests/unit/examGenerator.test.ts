/** Core challenge: different question sets of equal difficulty, and feasibility checks. */
import { describe, expect, it } from 'vitest';
import { checkFeasibility, difficultyProfile, drawQuestions, setKey, type PoolQuestion, type RuleSpec } from '../../src/core/examGenerator';

function bank(): PoolQuestion[] {
  const out: PoolQuestion[] = [];
  const add = (n: number, difficulty: PoolQuestion['difficulty'], topic: string) => {
    for (let i = 0; i < n; i++) out.push({ id: `${difficulty}-${topic}-${i}`, difficulty, topic });
  };
  add(8, 'EASY', 'Networking');
  add(8, 'EASY', 'Security');
  add(6, 'MEDIUM', 'Networking');
  add(5, 'MEDIUM', 'Security');
  add(6, 'HARD', 'Networking');
  return out;
}

const rules: RuleSpec[] = [
  { difficulty: 'EASY', count: 10, topics: [] },
  { difficulty: 'MEDIUM', count: 8, topics: ['Networking', 'Security'] },
  { difficulty: 'HARD', count: 5, topics: [] },
];

describe('exam generator', () => {
  it('gives every student the same difficulty profile', () => {
    const a = drawQuestions(rules, bank());
    const b = drawQuestions(rules, bank());
    expect(difficultyProfile(a)).toEqual({ EASY: 10, MEDIUM: 8, HARD: 5 });
    expect(difficultyProfile(b)).toEqual(difficultyProfile(a));
  });

  it('gives two students different question sets', () => {
    const keys = new Set(Array.from({ length: 20 }, () => setKey(drawQuestions(rules, bank()).map((q) => q.id))));
    // 20 random draws from these pools are virtually never all identical
    expect(keys.size).toBeGreaterThan(1);
  });

  it('never repeats a question inside one paper', () => {
    const paper = drawQuestions(rules, bank());
    expect(new Set(paper.map((q) => q.id)).size).toBe(paper.length);
  });

  it('only uses questions from the rule topics', () => {
    const paper = drawQuestions([{ difficulty: 'EASY', count: 5, topics: ['security'] }], bank());
    expect(paper.every((q) => q.topic === 'Security' && q.difficulty === 'EASY')).toBe(true);
  });

  it('reports a shortage when a pool is too small (blocks saving)', () => {
    const result = checkFeasibility([{ difficulty: 'HARD', count: 7, topics: [] }], bank());
    expect(result.ok).toBe(false);
    expect(result.shortages[0]).toMatchObject({ required: 7, available: 6 });
  });

  it('detects rules competing for the same questions (Hall condition)', () => {
    // Each rule alone fits (6 MEDIUM Networking), but together they need 10 of the same 6.
    const overlapping: RuleSpec[] = [
      { difficulty: 'MEDIUM', count: 5, topics: ['Networking'] },
      { difficulty: 'MEDIUM', count: 5, topics: ['Networking'] },
    ];
    const result = checkFeasibility(overlapping, bank());
    expect(result.ok).toBe(false);
    expect(result.overlapProblem).toMatchObject({ required: 10, available: 6 });
    expect(() => drawQuestions(overlapping, bank())).toThrow();
  });
});
