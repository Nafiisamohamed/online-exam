/** Auto-grading, short-answer matching and grade scale. */
import { describe, expect, it } from 'vitest';
import { autoGrade, letterFor, normalizeText, percentage, shortAnswerMatches } from '../../src/core/grading';

const mcq = {
  type: 'MCQ' as const,
  marks: 2,
  acceptedAnswers: [],
  options: [
    { id: 'a', isCorrect: false },
    { id: 'b', isCorrect: true },
    { id: 'c', isCorrect: false },
    { id: 'd', isCorrect: false },
  ],
};

describe('auto-grading', () => {
  it('grades MCQ by the correct option', () => {
    expect(autoGrade(mcq, { selectedOptionId: 'b' })).toEqual({ status: 'AUTO_GRADED', awardedMarks: 2 });
    expect(autoGrade(mcq, { selectedOptionId: 'a' })).toEqual({ status: 'AUTO_GRADED', awardedMarks: 0 });
    expect(autoGrade(mcq, null)).toEqual({ status: 'AUTO_GRADED', awardedMarks: 0 });
  });

  it('matches short answers ignoring case and extra spaces', () => {
    expect(normalizeText('  Simple   MAIL transfer Protocol ')).toBe('simple mail transfer protocol');
    expect(shortAnswerMatches('  smtp ', ['SMTP'])).toBe(true);
    const sa = { type: 'SHORT_ANSWER' as const, marks: 3, acceptedAnswers: ['SMTP', 'Simple Mail Transfer Protocol'], options: [] };
    expect(autoGrade(sa, { textAnswer: 'simple  mail transfer   protocol' })).toEqual({ status: 'AUTO_GRADED', awardedMarks: 3 });
  });

  it('sends non-matching short answers to "Needs review" instead of marking them wrong', () => {
    const sa = { type: 'SHORT_ANSWER' as const, marks: 3, acceptedAnswers: ['SMTP'], options: [] };
    expect(autoGrade(sa, { textAnswer: 'the smtp protocol' })).toEqual({ status: 'NEEDS_REVIEW', awardedMarks: null });
    expect(autoGrade(sa, { textAnswer: '   ' })).toEqual({ status: 'AUTO_GRADED', awardedMarks: 0 });
  });

  it('essays always need a lecturer unless blank', () => {
    const essay = { type: 'ESSAY' as const, marks: 10, acceptedAnswers: [], options: [] };
    expect(autoGrade(essay, { textAnswer: 'An answer' }).status).toBe('NEEDS_REVIEW');
    expect(autoGrade(essay, { textAnswer: '' })).toEqual({ status: 'AUTO_GRADED', awardedMarks: 0 });
  });

  it('maps percentages to the university grade scale', () => {
    const scale = [
      { letter: 'A', minPercent: 90 },
      { letter: 'B', minPercent: 80 },
      { letter: 'C', minPercent: 70 },
      { letter: 'D', minPercent: 60 },
      { letter: 'F', minPercent: 0 },
    ];
    expect(letterFor(percentage(27, 30), scale)).toBe('A');
    expect(letterFor(79.99, scale)).toBe('C');
    expect(letterFor(12, scale)).toBe('F');
    expect(percentage(5, 0)).toBe(0);
  });
});
