/** Question validation, tab-switch rules, analytics and network checks. */
import { describe, expect, it } from 'vitest';
import { validateQuestion, type QuestionInput } from '../../src/core/questionRules';
import { isCountedFocusLoss, isDisconnected, shouldWarn } from '../../src/core/focus';
import { examStats, itemStats } from '../../src/core/analytics';
import { ipAllowed, ipMatches, isValidNetworkRule } from '../../src/lib/network';
import { rowToQuestion } from '../../src/services/questionImport.service';

const baseMcq: QuestionInput = {
  type: 'MCQ',
  text: 'What does CPU stand for?',
  marks: 2,
  topic: 'Hardware',
  difficulty: 'EASY',
  options: [
    { text: 'Central Processing Unit', isCorrect: true },
    { text: 'Computer Personal Unit', isCorrect: false },
    { text: 'Central Program Utility', isCorrect: false },
    { text: 'Control Processing Unit', isCorrect: false },
  ],
};

describe('question rules', () => {
  it('accepts a valid MCQ', () => {
    expect(validateQuestion(baseMcq)).toEqual([]);
  });

  it('requires exactly one correct option and 4-5 options', () => {
    const twoCorrect = { ...baseMcq, options: baseMcq.options!.map((o) => ({ ...o, isCorrect: true })) };
    expect(validateQuestion(twoCorrect)).toContain('MCQ_ONE_CORRECT');
    expect(validateQuestion({ ...baseMcq, options: baseMcq.options!.slice(0, 3) })).toContain('MCQ_OPTION_COUNT');
  });

  it('requires essay rubric points to add up to the marks', () => {
    const essay: QuestionInput = { type: 'ESSAY', text: 'Explain networks.', marks: 10, topic: 'Net', difficulty: 'HARD', rubric: [{ criterion: 'Content', points: 6 }] };
    expect(validateQuestion(essay)).toContain('RUBRIC_TOTAL_MISMATCH');
  });

  it('parses CSV rows and reports errors with reasons', () => {
    const ok = rowToQuestion({ type: 'MCQ', text: 'What is RAM?', option_a: 'Memory', option_b: 'Disk', option_c: 'Screen', option_d: 'Mouse', correct: 'A', marks: '2', topic: 'Hardware', difficulty: 'easy' });
    expect(ok.errors).toEqual([]);
    const bad = rowToQuestion({ type: 'MCQ', text: 'What is RAM?', option_a: 'Memory', option_b: 'Disk', correct: 'Z', marks: '2', topic: 'Hardware', difficulty: 'impossible' });
    expect(bad.errors).toEqual(expect.arrayContaining(['INVALID_DIFFICULTY', 'MCQ_CORRECT_LETTER']));
  });
});

describe('tab switches and connection', () => {
  it('logs but does not count losses under 1 second; warns from the 3rd', () => {
    expect(isCountedFocusLoss(999)).toBe(false);
    expect(isCountedFocusLoss(1000)).toBe(true);
    expect(shouldWarn(2)).toBe(false);
    expect(shouldWarn(3)).toBe(true);
  });

  it('marks a student disconnected after 30 seconds without contact', () => {
    const now = new Date('2026-11-10T10:00:00Z');
    expect(isDisconnected(new Date(now.getTime() - 29_000), now)).toBe(false);
    expect(isDisconnected(new Date(now.getTime() - 31_000), now)).toBe(true);
  });
});

describe('question analytics', () => {
  const resp = (correct: boolean[], scores: number[]) => correct.map((c, i) => ({ attemptId: `a${i}`, correct: c, totalScore: scores[i] }));

  it('shows "Not enough data" below 5 answers', () => {
    expect(itemStats(resp([true, true, false, true], [9, 8, 7, 6])).enoughData).toBe(false);
  });

  it('computes difficulty index, discrimination and flags', () => {
    // Top students right, bottom students wrong -> positive discrimination
    const s = itemStats(resp([true, true, true, false, false, false, false, false, false, false], [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]));
    expect(s.difficultyIndex).toBe(0.3);
    expect(s.discrimination).toBe(1);
    expect(s.flagged).toBe(false);
    const easy = itemStats(resp(Array(20).fill(true), Array.from({ length: 20 }, (_, i) => i)));
    expect(easy.flagReason).toBe('TOO_EASY');
    const hard = itemStats(resp([true, ...Array(9).fill(false)], Array.from({ length: 10 }, (_, i) => i)));
    expect(hard.flagReason).toBe('TOO_HARD');
  });

  it('builds exam statistics and a distribution', () => {
    const st = examStats([45, 72, 88, 91, 100]);
    expect(st).toMatchObject({ count: 5, highest: 100, lowest: 45, average: 79.2 });
    expect(st.distribution.find((d) => d.range === '90-100')!.count).toBe(2);
  });
});

describe('exam room network rules', () => {
  it('matches IPv4 CIDR ranges and IPv4-mapped IPv6', () => {
    expect(ipMatches('192.168.10.37', '192.168.10.0/24')).toBe(true);
    expect(ipMatches('::ffff:192.168.10.37', '192.168.10.0/24')).toBe(true);
    expect(ipMatches('192.168.11.37', '192.168.10.0/24')).toBe(false);
    expect(ipAllowed('10.0.0.1', [])).toBe(true);
    expect(ipAllowed('::1', ['127.0.0.1'])).toBe(true);
    expect(isValidNetworkRule('192.168.10.0/24')).toBe(true);
    expect(isValidNetworkRule('300.1.1.1')).toBe(false);
  });
});
