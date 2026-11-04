/**
 * Bulk question import from CSV (Lecturer).
 *
 * Template columns (see GET /api/questions/import/template):
 *   type, text, option_a..option_e, correct, accepted_answers, marks, topic, difficulty, image_url
 *   - type: MCQ | TRUE_FALSE | SHORT_ANSWER | ESSAY
 *   - correct: MCQ -> letter A-E, TRUE_FALSE -> true/false
 *   - accepted_answers: short answer alternatives separated by "|"
 *   - difficulty: EASY | MEDIUM | HARD
 *
 * Flow: preview (dryRun) shows every row as VALID / ERROR (with reasons) / DUPLICATE;
 * commit saves only VALID rows. Duplicates (same text in the course, or repeated in
 * the file) are skipped and reported.
 */
import { prisma } from '../lib/prisma';
import { parseCsv } from '../lib/csv';
import { normalizeText } from '../core/grading';
import { validateQuestion, trueFalseOptions, type QuestionInput, type QType, type QDifficulty } from '../core/questionRules';
import { assertCourseAccess } from './access.service';
import { createQuestion } from './question.service';
import { audit } from './audit.service';
import type { AuthUser } from '../middleware/auth';

export const QUESTION_CSV_TEMPLATE = [
  'type,text,option_a,option_b,option_c,option_d,option_e,correct,accepted_answers,marks,topic,difficulty,image_url',
  'MCQ,What does CPU stand for?,Central Processing Unit,Computer Personal Unit,Central Program Utility,Control Processing Unit,,A,,2,Hardware,EASY,',
  'TRUE_FALSE,RAM keeps its data when the power is switched off.,,,,,,false,,1,Hardware,EASY,',
  'SHORT_ANSWER,Which protocol is used to send email?,,,,,,,SMTP|Simple Mail Transfer Protocol,2,Networking,MEDIUM,',
  'ESSAY,Explain how a computer network helps a hospital in Mogadishu.,,,,,,,,10,Networking,HARD,',
].join('\n');

const TYPE_ALIASES: Record<string, QType> = {
  MCQ: 'MCQ', MULTIPLE_CHOICE: 'MCQ', TRUE_FALSE: 'TRUE_FALSE', TF: 'TRUE_FALSE', TRUEFALSE: 'TRUE_FALSE',
  SHORT_ANSWER: 'SHORT_ANSWER', SHORT: 'SHORT_ANSWER', ESSAY: 'ESSAY',
};
const DIFF_ALIASES: Record<string, QDifficulty> = {
  EASY: 'EASY', FUDUD: 'EASY', MEDIUM: 'MEDIUM', DHEXDHEXAAD: 'MEDIUM', HARD: 'HARD', ADAG: 'HARD',
};

export interface ImportRowResult {
  line: number;
  status: 'VALID' | 'ERROR' | 'DUPLICATE';
  errors: string[];
  question: Partial<QuestionInput> & { text: string };
}

/** Turns one CSV row into a QuestionInput plus parse errors (pure). */
export function rowToQuestion(data: Record<string, string>): { input: QuestionInput; errors: string[] } {
  const errors: string[] = [];
  const typeKey = (data.type ?? '').toUpperCase().replace(/[\s/-]+/g, '_');
  const type = TYPE_ALIASES[typeKey];
  if (!type) errors.push('INVALID_TYPE');
  const difficulty = DIFF_ALIASES[(data.difficulty ?? '').toUpperCase().replace(/\s+/g, '')];
  if (!difficulty) errors.push('INVALID_DIFFICULTY');
  const marks = Number(data.marks);
  const correct = (data.correct ?? '').trim().toUpperCase();

  let options: { text: string; isCorrect: boolean }[] | undefined;
  if (type === 'MCQ') {
    const letters = ['A', 'B', 'C', 'D', 'E'];
    options = letters
      .map((l) => ({ letter: l, text: (data[`option_${l.toLowerCase()}`] ?? '').trim() }))
      .filter((o) => o.text)
      .map((o) => ({ text: o.text, isCorrect: o.letter === correct }));
    if (!letters.includes(correct)) errors.push('MCQ_CORRECT_LETTER');
  } else if (type === 'TRUE_FALSE') {
    if (['TRUE', 'T', 'RUN', 'SAX'].includes(correct)) options = trueFalseOptions(true);
    else if (['FALSE', 'F', 'BEEN', 'KHALAD'].includes(correct)) options = trueFalseOptions(false);
    else errors.push('TF_CORRECT_VALUE');
  }
  const input: QuestionInput = {
    type: type ?? 'MCQ',
    text: (data.text ?? '').trim(),
    marks,
    topic: (data.topic ?? '').trim(),
    difficulty: difficulty ?? 'EASY',
    imageUrl: (data.image_url ?? '').trim() || null,
    options,
    acceptedAnswers: (data.accepted_answers ?? '').split('|').map((s) => s.trim()).filter(Boolean),
  };
  if (type && difficulty) {
    for (const e of validateQuestion(input)) if (!errors.includes(e)) errors.push(e);
  }
  return { input, errors };
}

/**
 * Previews or commits an import.
 * @param dryRun true = preview only, nothing saved
 * @returns per-row results and a summary { total, valid, errors, duplicates, saved }
 */
export async function importQuestions(user: AuthUser, courseId: string, csv: string, dryRun: boolean) {
  await assertCourseAccess(user, courseId);
  const rows = parseCsv(csv);
  const existing = await prisma.question.findMany({
    where: { courseId, isLatest: true, isArchived: false },
    select: { text: true },
  });
  const seenTexts = new Set(existing.map((q) => normalizeText(q.text)));
  const inFile = new Set<string>();

  const results: (ImportRowResult & { input: QuestionInput })[] = rows.map(({ line, data }) => {
    const { input, errors } = rowToQuestion(data);
    const key = normalizeText(input.text);
    let status: ImportRowResult['status'] = errors.length ? 'ERROR' : 'VALID';
    if (status === 'VALID' && (seenTexts.has(key) || inFile.has(key))) {
      status = 'DUPLICATE';
      errors.push(seenTexts.has(key) ? 'DUPLICATE_IN_BANK' : 'DUPLICATE_IN_FILE');
    }
    if (key) inFile.add(key);
    return { line, status, errors, input, question: input };
  });

  let saved = 0;
  if (!dryRun) {
    await prisma.$transaction(
      async (tx) => {
        for (const r of results.filter((x) => x.status === 'VALID')) {
          await createQuestion(user, courseId, r.input, tx);
          saved++;
        }
      },
      { timeout: 60_000 },
    );
    await audit({ userId: user.id, action: 'QUESTIONS_IMPORTED', entity: 'Course', entityId: courseId, details: { saved, rows: results.length } });
  }
  return {
    rows: results.map(({ input: _input, ...r }) => r),
    summary: {
      total: results.length,
      valid: results.filter((r) => r.status === 'VALID').length,
      errors: results.filter((r) => r.status === 'ERROR').length,
      duplicates: results.filter((r) => r.status === 'DUPLICATE').length,
      saved,
    },
  };
}
