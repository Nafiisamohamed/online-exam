/**
 * Automatic grading rules.
 *
 * - MCQ / TRUE_FALSE: full marks if the selected option is correct, else 0.
 * - SHORT_ANSWER: compared to accepted answers ignoring case and extra spaces.
 *   A non-matching answer is NOT marked wrong: it goes to "Needs review" for the lecturer.
 * - ESSAY: always needs a lecturer (rubric).
 * - Unanswered questions score 0 automatically.
 */

export type GradableType = 'MCQ' | 'TRUE_FALSE' | 'SHORT_ANSWER' | 'ESSAY';

export interface GradableQuestion {
  type: GradableType;
  marks: number;
  acceptedAnswers: string[];
  options: { id: string; isCorrect: boolean }[];
}

export interface GradableAnswer {
  selectedOptionId?: string | null;
  textAnswer?: string | null;
}

export interface AutoGradeResult {
  status: 'AUTO_GRADED' | 'NEEDS_REVIEW';
  awardedMarks: number | null;
}

/** Lower-case, trim and collapse internal whitespace: "  Mogadishu   City " -> "mogadishu city". */
export function normalizeText(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** True if `answer` matches any accepted answer after normalisation. */
export function shortAnswerMatches(answer: string, accepted: readonly string[]): boolean {
  const a = normalizeText(answer);
  return a.length > 0 && accepted.some((x) => normalizeText(x) === a);
}

/** Grades one answer. `answer` is null when the student never answered. */
export function autoGrade(question: GradableQuestion, answer: GradableAnswer | null): AutoGradeResult {
  const text = answer?.textAnswer ?? '';
  const hasText = text.trim().length > 0;
  const selected = answer?.selectedOptionId ?? null;

  switch (question.type) {
    case 'MCQ':
    case 'TRUE_FALSE': {
      if (!selected) return { status: 'AUTO_GRADED', awardedMarks: 0 };
      const opt = question.options.find((o) => o.id === selected);
      return { status: 'AUTO_GRADED', awardedMarks: opt?.isCorrect ? question.marks : 0 };
    }
    case 'SHORT_ANSWER':
      if (!hasText) return { status: 'AUTO_GRADED', awardedMarks: 0 };
      return shortAnswerMatches(text, question.acceptedAnswers)
        ? { status: 'AUTO_GRADED', awardedMarks: question.marks }
        : { status: 'NEEDS_REVIEW', awardedMarks: null };
    case 'ESSAY':
      if (!hasText) return { status: 'AUTO_GRADED', awardedMarks: 0 };
      return { status: 'NEEDS_REVIEW', awardedMarks: null };
  }
}

export interface GradeBand {
  letter: string;
  minPercent: number;
}

/** Letter grade from the university scale (highest band whose minimum is reached). */
export function letterFor(pct: number, scale: readonly GradeBand[]): string {
  const sorted = [...scale].sort((a, b) => b.minPercent - a.minPercent);
  return sorted.find((b) => pct >= b.minPercent)?.letter ?? sorted[sorted.length - 1]?.letter ?? 'F';
}

/** Percentage rounded to 2 decimals; 0 when maxScore is 0. */
export function percentage(score: number, maxScore: number): number {
  if (maxScore <= 0) return 0;
  return Math.round((score / maxScore) * 10000) / 100;
}
