/**
 * Question bank service (Lecturer).
 *
 * Rules:
 * - Lecturers only see/edit banks of their own courses (checked via access.service).
 * - Questions are validated by core/questionRules (e.g. MCQ has exactly one correct option).
 * - Same text in the same course = duplicate (rejected).
 * - VERSIONING: editing a question that has already been used in an exam attempt
 *   creates a new version row (same rootId, version+1). The old row keeps its text,
 *   options and answers, so past results do not change. Unused questions are edited in place.
 * - Deleting archives the question (it stays for past exams).
 */
import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../lib/prisma';
import { AppError, badRequest, conflict, notFound } from '../lib/errors';
import { normalizeText } from '../core/grading';
import { validateQuestion, type QuestionInput } from '../core/questionRules';
import { assertCourseAccess } from './access.service';
import { audit } from './audit.service';
import type { AuthUser } from '../middleware/auth';

export interface QuestionFilter {
  type?: string;
  difficulty?: string;
  topic?: string;
  search?: string;
}

const questionInclude = { options: { orderBy: { position: 'asc' as const } } };

/** Latest, non-archived questions of a course with usage counts. */
export async function listQuestions(user: AuthUser, courseId: string, filter: QuestionFilter = {}) {
  await assertCourseAccess(user, courseId);
  const items = await prisma.question.findMany({
    where: {
      courseId,
      isLatest: true,
      isArchived: false,
      type: (filter.type as Prisma.QuestionWhereInput['type']) || undefined,
      difficulty: (filter.difficulty as Prisma.QuestionWhereInput['difficulty']) || undefined,
      topic: filter.topic ? { equals: filter.topic, mode: 'insensitive' } : undefined,
      text: filter.search ? { contains: filter.search, mode: 'insensitive' } : undefined,
    },
    orderBy: [{ topic: 'asc' }, { createdAt: 'desc' }],
    include: { ...questionInclude, _count: { select: { attemptQuestions: true } } },
  });
  return items;
}

/** Distinct topics plus counts per topic and difficulty (used by the exam builder). */
export async function bankSummary(user: AuthUser, courseId: string) {
  await assertCourseAccess(user, courseId);
  const groups = await prisma.question.groupBy({
    by: ['topic', 'difficulty'],
    where: { courseId, isLatest: true, isArchived: false },
    _count: { _all: true },
  });
  const topics = [...new Set(groups.map((g) => g.topic))].sort();
  return { topics, counts: groups.map((g) => ({ topic: g.topic, difficulty: g.difficulty, count: g._count._all })) };
}

export async function getQuestion(user: AuthUser, id: string) {
  const q = await prisma.question.findUnique({ where: { id }, include: questionInclude });
  if (!q) throw notFound('Question');
  await assertCourseAccess(user, q.courseId);
  const versions = await prisma.question.findMany({
    where: { rootId: q.rootId },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, isLatest: true, createdAt: true, text: true },
  });
  return { ...q, versions };
}

/** True if another active question in the course has the same normalised text. */
export async function isDuplicate(courseId: string, text: string, exceptRootId?: string, tx: Tx = prisma): Promise<boolean> {
  const candidates = await tx.question.findMany({
    where: { courseId, isLatest: true, isArchived: false, NOT: exceptRootId ? { rootId: exceptRootId } : undefined },
    select: { text: true },
  });
  const target = normalizeText(text);
  return candidates.some((c) => normalizeText(c.text) === target);
}

function assertValid(input: QuestionInput) {
  const errors = validateQuestion(input);
  if (errors.length) throw new AppError(400, 'QUESTION_INVALID', 'Question is not valid', errors);
}

function optionsData(input: QuestionInput) {
  if (input.type !== 'MCQ' && input.type !== 'TRUE_FALSE') return [];
  return (input.options ?? []).map((o, i) => ({ text: o.text.trim(), isCorrect: o.isCorrect, position: i }));
}

function questionData(input: QuestionInput) {
  return {
    type: input.type,
    text: input.text.trim(),
    imageUrl: input.imageUrl || null,
    marks: input.marks,
    topic: input.topic.trim(),
    difficulty: input.difficulty,
    acceptedAnswers: input.type === 'SHORT_ANSWER' ? (input.acceptedAnswers ?? []).map((a) => a.trim()).filter(Boolean) : [],
    rubric: input.type === 'ESSAY' && input.rubric?.length ? (input.rubric as unknown as Prisma.InputJsonValue) : undefined,
  };
}

/** Creates a question (version 1). Errors: 400 QUESTION_INVALID, 409 DUPLICATE_QUESTION. */
export async function createQuestion(user: AuthUser, courseId: string, input: QuestionInput, tx: Tx = prisma) {
  await assertCourseAccess(user, courseId);
  assertValid(input);
  if (await isDuplicate(courseId, input.text, undefined, tx)) {
    throw conflict('DUPLICATE_QUESTION', 'A question with the same text already exists in this course');
  }
  const created = await tx.question.create({
    data: {
      ...questionData(input),
      rootId: 'pending',
      courseId,
      createdById: user.id,
      options: { create: optionsData(input) },
    },
  });
  const q = await tx.question.update({ where: { id: created.id }, data: { rootId: created.id }, include: questionInclude });
  await audit({ userId: user.id, action: 'QUESTION_CREATED', entity: 'Question', entityId: q.id }, tx);
  return q;
}

/**
 * Edits a question. If the current version was used in any exam attempt, a NEW version
 * is created and the old one is kept unchanged (isLatest=false).
 * @returns the latest version plus `versioned: true` when a new version was made
 * Errors: 400 NOT_LATEST if editing an old version, QUESTION_INVALID, 409 DUPLICATE_QUESTION
 */
export async function updateQuestion(user: AuthUser, id: string, input: QuestionInput) {
  const existing = await prisma.question.findUnique({ where: { id }, include: { _count: { select: { attemptQuestions: true } } } });
  if (!existing || existing.isArchived) throw notFound('Question');
  await assertCourseAccess(user, existing.courseId);
  if (!existing.isLatest) throw badRequest('NOT_LATEST', 'Only the latest version can be edited');
  assertValid(input);
  if (await isDuplicate(existing.courseId, input.text, existing.rootId)) {
    throw conflict('DUPLICATE_QUESTION', 'A question with the same text already exists in this course');
  }

  const used = existing._count.attemptQuestions > 0;
  const result = await prisma.$transaction(async (tx) => {
    if (used) {
      await tx.question.update({ where: { id }, data: { isLatest: false } });
      return tx.question.create({
        data: {
          ...questionData(input),
          rootId: existing.rootId,
          version: existing.version + 1,
          courseId: existing.courseId,
          createdById: user.id,
          options: { create: optionsData(input) },
        },
        include: questionInclude,
      });
    }
    await tx.questionOption.deleteMany({ where: { questionId: id } });
    return tx.question.update({
      where: { id },
      data: { ...questionData(input), rubric: questionData(input).rubric ?? Prisma.DbNull, options: { create: optionsData(input) } },
      include: questionInclude,
    });
  });
  await audit({
    userId: user.id,
    action: used ? 'QUESTION_VERSIONED' : 'QUESTION_UPDATED',
    entity: 'Question',
    entityId: result.id,
    details: { previousId: id, version: result.version },
  });
  return { ...result, versioned: used };
}

/** Archives a question (kept for past exams, hidden from the bank and new exams). */
export async function archiveQuestion(user: AuthUser, id: string) {
  const q = await prisma.question.findUnique({ where: { id } });
  if (!q) throw notFound('Question');
  await assertCourseAccess(user, q.courseId);
  await prisma.question.update({ where: { id }, data: { isArchived: true } });
  await audit({ userId: user.id, action: 'QUESTION_ARCHIVED', entity: 'Question', entityId: id });
}
