/**
 * Question validation rules, shared by the question form and the CSV import.
 *
 * - MCQ: 4 or 5 options, all filled and different, EXACTLY one correct.
 * - TRUE_FALSE: stored as two options "True"/"False", one correct.
 * - SHORT_ANSWER: at least one accepted answer.
 * - ESSAY: optional rubric; if given, criteria points must add up to the question marks.
 * - Marks between 0.5 and 100. Text 5..4000 characters. Topic required.
 */
import { normalizeText } from './grading';

export type QType = 'MCQ' | 'TRUE_FALSE' | 'SHORT_ANSWER' | 'ESSAY';
export type QDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface RubricCriterion {
  criterion: string;
  points: number;
}

export interface QuestionInput {
  type: QType;
  text: string;
  imageUrl?: string | null;
  marks: number;
  topic: string;
  difficulty: QDifficulty;
  options?: { text: string; isCorrect: boolean }[];
  acceptedAnswers?: string[];
  rubric?: RubricCriterion[] | null;
}

/** Max size of an embedded (data URL) image, about 700 KB of base64. */
export const MAX_IMAGE_DATA_URL = 950_000;

/** Returns a list of error codes (empty = valid). Codes are translated by the UI. */
export function validateQuestion(q: QuestionInput): string[] {
  const errors: string[] = [];
  const text = q.text?.trim() ?? '';
  if (text.length < 5) errors.push('TEXT_TOO_SHORT');
  if (text.length > 4000) errors.push('TEXT_TOO_LONG');
  if (!q.topic?.trim()) errors.push('TOPIC_REQUIRED');
  if (!['EASY', 'MEDIUM', 'HARD'].includes(q.difficulty)) errors.push('INVALID_DIFFICULTY');
  if (!Number.isFinite(q.marks) || q.marks < 0.5 || q.marks > 100) errors.push('INVALID_MARKS');
  if (q.imageUrl) {
    const isHttp = /^https?:\/\/\S+$/i.test(q.imageUrl);
    const isData = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(q.imageUrl);
    if (!isHttp && !isData) errors.push('INVALID_IMAGE');
    if (isData && q.imageUrl.length > MAX_IMAGE_DATA_URL) errors.push('IMAGE_TOO_LARGE');
  }

  const options = q.options ?? [];
  switch (q.type) {
    case 'MCQ': {
      if (options.length < 4 || options.length > 5) errors.push('MCQ_OPTION_COUNT');
      if (options.some((o) => !o.text?.trim())) errors.push('OPTION_EMPTY');
      const texts = options.map((o) => normalizeText(o.text ?? ''));
      if (new Set(texts).size !== texts.length) errors.push('OPTION_DUPLICATE');
      if (options.filter((o) => o.isCorrect).length !== 1) errors.push('MCQ_ONE_CORRECT');
      break;
    }
    case 'TRUE_FALSE':
      if (options.length !== 2 || options.filter((o) => o.isCorrect).length !== 1) errors.push('TF_ONE_CORRECT');
      break;
    case 'SHORT_ANSWER':
      if (!(q.acceptedAnswers ?? []).some((a) => a.trim())) errors.push('ACCEPTED_ANSWER_REQUIRED');
      break;
    case 'ESSAY':
      if (q.rubric && q.rubric.length > 0) {
        if (q.rubric.some((c) => !c.criterion?.trim() || !(c.points > 0))) errors.push('RUBRIC_INVALID');
        const total = q.rubric.reduce((s, c) => s + (Number(c.points) || 0), 0);
        if (Math.abs(total - q.marks) > 0.001) errors.push('RUBRIC_TOTAL_MISMATCH');
      }
      break;
    default:
      errors.push('INVALID_TYPE');
  }
  return errors;
}

/** Builds the two fixed options of a true/false question. */
export function trueFalseOptions(correct: boolean): { text: string; isCorrect: boolean }[] {
  return [
    { text: 'True', isCorrect: correct },
    { text: 'False', isCorrect: !correct },
  ];
}
