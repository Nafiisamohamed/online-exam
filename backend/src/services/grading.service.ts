/**
 * Manual grading, publishing and student results.
 *
 * - Grading queue: essays and "Needs review" short answers, beside the rubric.
 *   A second (blind) grader sees "Candidate N" instead of student names.
 * - Results can only be published when NOTHING still needs review and no attempt is
 *   still in progress. Publishing writes the `grades` table (score, %, letter).
 * - Unpublished results are never visible to students (checked on every request).
 * - Grading can be re-opened after publishing; on re-publish, students whose score
 *   changed are notified (in-app + SMS outbox).
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { letterFor, percentage } from '../core/grading';
import { assertExamGrade, assertExamManage } from './access.service';
import { recomputeAttempt } from './attempt.service';
import { audit } from './audit.service';
import { notify } from './notification.service';
import type { AuthUser } from '../middleware/auth';

const FINISHED = ['SUBMITTED', 'AUTO_SUBMITTED'] as const;

/** Answers that need a lecturer, grouped by question. */
export async function gradingQueue(user: AuthUser, examId: string, includeGraded = false) {
  const { exam, blind } = await assertExamGrade(user, examId);
  const answers = await prisma.answer.findMany({
    where: {
      attemptQuestion: { attempt: { examId, status: { in: [...FINISHED] } }, question: { type: { in: ['ESSAY', 'SHORT_ANSWER'] } } },
      status: includeGraded ? { in: ['NEEDS_REVIEW', 'MANUALLY_GRADED'] } : 'NEEDS_REVIEW',
    },
    include: {
      attemptQuestion: {
        include: {
          question: true,
          attempt: { select: { id: true, student: { select: { fullName: true, studentId: true } } } },
        },
      },
      gradedBy: { select: { fullName: true } },
    },
    orderBy: [{ attemptQuestion: { questionId: 'asc' } }],
  });
  // Stable anonymous numbering for blind grading.
  const attemptIds = [...new Set(answers.map((a) => a.attemptQuestion.attempt.id))].sort();
  const candidate = new Map(attemptIds.map((id, i) => [id, `Candidate ${i + 1}`]));
  const remaining = await prisma.answer.count({
    where: { status: 'NEEDS_REVIEW', attemptQuestion: { attempt: { examId } } },
  });
  return {
    exam: { id: exam.id, title: exam.title, resultsPublished: exam.resultsPublished },
    blind,
    remaining,
    items: answers.map((a) => ({
      answerId: a.id,
      status: a.status,
      attemptId: a.attemptQuestion.attempt.id,
      student: blind ? candidate.get(a.attemptQuestion.attempt.id)! : `${a.attemptQuestion.attempt.student.fullName} (${a.attemptQuestion.attempt.student.studentId})`,
      question: {
        id: a.attemptQuestion.question.id,
        type: a.attemptQuestion.question.type,
        text: a.attemptQuestion.question.text,
        marks: a.attemptQuestion.marks,
        rubric: a.attemptQuestion.question.rubric,
        acceptedAnswers: a.attemptQuestion.question.acceptedAnswers,
      },
      textAnswer: a.textAnswer,
      awardedMarks: a.awardedMarks,
      rubricScores: a.rubricScores,
      comment: a.comment,
      gradedBy: a.gradedBy?.fullName ?? null,
    })),
  };
}

export interface GradeInput {
  awardedMarks?: number;
  rubricScores?: { criterion: string; points: number; awarded: number }[];
  comment?: string | null;
}

/**
 * Grades one answer (essay, short answer review, or an override).
 * With a rubric, marks = sum of criteria marks; each must be within 0..points.
 * Errors: 409 RESULTS_PUBLISHED (re-open first), 400 MARKS_OUT_OF_RANGE / RUBRIC_INVALID.
 */
export async function gradeAnswer(user: AuthUser, answerId: string, input: GradeInput) {
  const answer = await prisma.answer.findUnique({
    where: { id: answerId },
    include: { attemptQuestion: { include: { attempt: true, question: true } } },
  });
  if (!answer) throw notFound('Answer');
  const { exam } = await assertExamGrade(user, answer.attemptQuestion.attempt.examId);
  if (exam.resultsPublished) throw conflict('RESULTS_PUBLISHED', 'Re-open grading before changing marks');
  if (!FINISHED.includes(answer.attemptQuestion.attempt.status as (typeof FINISHED)[number])) {
    throw conflict('ATTEMPT_IN_PROGRESS', 'The student is still writing this exam');
  }
  const max = answer.attemptQuestion.marks;
  let awarded = input.awardedMarks;
  let rubricScores: Prisma.InputJsonValue | undefined;
  if (input.rubricScores && input.rubricScores.length > 0) {
    if (input.rubricScores.some((c) => c.awarded < 0 || c.awarded > c.points)) {
      throw badRequest('RUBRIC_INVALID', 'Each criterion mark must be between 0 and its points');
    }
    awarded = input.rubricScores.reduce((s, c) => s + c.awarded, 0);
    rubricScores = input.rubricScores as unknown as Prisma.InputJsonValue;
  }
  if (awarded === undefined || !Number.isFinite(awarded) || awarded < 0 || awarded > max) {
    throw new AppError(400, 'MARKS_OUT_OF_RANGE', `Marks must be between 0 and ${max}`);
  }
  const updated = await prisma.$transaction(async (tx) => {
    const a = await tx.answer.update({
      where: { id: answerId },
      data: {
        awardedMarks: Math.round(awarded! * 100) / 100,
        rubricScores,
        comment: input.comment ?? null,
        status: 'MANUALLY_GRADED',
        gradedById: user.id,
        gradedAt: new Date(),
      },
    });
    await recomputeAttempt(tx, answer.attemptQuestion.attemptId);
    return a;
  });
  await audit({ userId: user.id, action: 'ANSWER_GRADED', entity: 'Answer', entityId: answerId, details: { awarded, previous: answer.awardedMarks } });
  return updated;
}

/** Results table for lecturers: every finished attempt with score, %, letter and flags. */
export async function examResults(user: AuthUser, examId: string) {
  const exam = await assertExamManage(user, examId);
  const [attempts, scale] = await Promise.all([
    prisma.examAttempt.findMany({
      where: { examId },
      include: {
        student: { select: { fullName: true, studentId: true } },
        grade: true,
        focusEvents: { where: { counted: true }, select: { id: true } },
        _count: { select: { questions: true } },
      },
      orderBy: { student: { fullName: 'asc' } },
    }),
    prisma.gradeScale.findMany(),
  ]);
  const needsReview = await prisma.answer.count({ where: { status: 'NEEDS_REVIEW', attemptQuestion: { attempt: { examId } } } });
  return {
    exam: { id: exam.id, title: exam.title, courseCode: exam.course.code, resultsPublished: exam.resultsPublished, publishedAt: exam.publishedAt, allowReview: exam.allowReview, status: exam.status, windowEnd: exam.windowEnd },
    needsReview,
    inProgress: attempts.filter((a) => a.status === 'IN_PROGRESS').length,
    attempts: attempts.map((a) => {
      const pct = percentage(a.score ?? 0, a.maxScore);
      return {
        attemptId: a.id,
        studentId: a.student.studentId,
        fullName: a.student.fullName,
        status: a.status,
        gradingStatus: a.gradingStatus,
        score: a.score,
        maxScore: a.maxScore,
        percentage: pct,
        letter: letterFor(pct, scale),
        tabSwitches: a.focusEvents.length,
        startedAt: a.startedAt,
        submittedAt: a.submittedAt,
        published: a.grade ? { score: a.grade.score, letter: a.grade.letter } : null,
      };
    }),
  };
}

/**
 * Publishes results. Errors: 409 ATTEMPTS_IN_PROGRESS, 409 GRADING_INCOMPLETE (with count).
 * First publish notifies every student; a re-publish notifies only students whose result changed.
 */
export async function publishResults(user: AuthUser, examId: string) {
  const exam = await assertExamManage(user, examId);
  if (exam.resultsPublished) throw conflict('ALREADY_PUBLISHED', 'Results are already published');
  const inProgress = await prisma.examAttempt.count({ where: { examId, status: 'IN_PROGRESS' } });
  if (inProgress > 0) throw conflict('ATTEMPTS_IN_PROGRESS', 'Some students are still writing the exam', { inProgress });
  const needsReview = await prisma.answer.count({ where: { status: { in: ['NEEDS_REVIEW', 'UNGRADED'] }, attemptQuestion: { attempt: { examId } } } });
  if (needsReview > 0) {
    throw conflict('GRADING_INCOMPLETE', 'Grade all essays and "Needs review" answers before publishing', { needsReview });
  }
  const scale = await prisma.gradeScale.findMany();
  const attempts = await prisma.examAttempt.findMany({ where: { examId }, include: { grade: true } });
  const changed: string[] = [];
  const firstTime: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const a of attempts) {
      const score = a.score ?? 0;
      const pct = percentage(score, a.maxScore);
      const letter = letterFor(pct, scale);
      if (a.grade) {
        if (a.grade.score !== score || a.grade.letter !== letter) changed.push(a.studentId);
      } else {
        firstTime.push(a.studentId);
      }
      await tx.grade.upsert({
        where: { attemptId: a.id },
        create: { attemptId: a.id, score, maxScore: a.maxScore, percentage: pct, letter },
        update: { score, maxScore: a.maxScore, percentage: pct, letter },
      });
    }
    await tx.exam.update({ where: { id: examId }, data: { resultsPublished: true, publishedAt: new Date() } });
  });
  await audit({ userId: user.id, action: 'RESULTS_PUBLISHED', entity: 'Exam', entityId: examId, details: { attempts: attempts.length, changed: changed.length } });
  await notify(
    firstTime,
    { en: `Results published: ${exam.title}`, so: `Natiijada waa la daabacay: ${exam.title}` },
    { en: `Your ${exam.course.code} result is ready on Imtixaan.`, so: `Natiijadaada ${exam.course.code} waa diyaar Imtixaan.` },
    true,
  );
  await notify(
    changed,
    { en: `Result changed: ${exam.title}`, so: `Natiijada waa la beddelay: ${exam.title}` },
    { en: `Your ${exam.course.code} result was updated after review.`, so: `Natiijadaada ${exam.course.code} waa la cusboonaysiiyay kadib dib-u-eegis.` },
    true,
  );
  return { published: attempts.length, changed: changed.length };
}

/** Re-opens grading: results are hidden from students again until re-published. */
export async function reopenGrading(user: AuthUser, examId: string, reason: string) {
  const exam = await assertExamManage(user, examId);
  if (!exam.resultsPublished) throw conflict('NOT_PUBLISHED', 'Results are not published');
  await prisma.exam.update({ where: { id: examId }, data: { resultsPublished: false } });
  await audit({ userId: user.id, action: 'GRADING_REOPENED', entity: 'Exam', entityId: examId, details: { reason } });
  return { reopened: true };
}

/** CSV export of grades for the registrar. */
export async function exportGradesCsv(user: AuthUser, examId: string): Promise<string> {
  const { exam, attempts } = await examResults(user, examId);
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['student_id', 'full_name', 'course', 'exam', 'status', 'score', 'max_score', 'percentage', 'grade', 'tab_switches', 'submitted_at'];
  const lines = attempts.map((a) =>
    [a.studentId, a.fullName, exam.courseCode, exam.title, a.status, a.score ?? '', a.maxScore, a.percentage, a.letter, a.tabSwitches, a.submittedAt?.toISOString() ?? '']
      .map(esc)
      .join(','),
  );
  await audit({ userId: user.id, action: 'GRADES_EXPORTED', entity: 'Exam', entityId: examId });
  return [header.join(','), ...lines].join('\n');
}

// ---------- Student side ----------

/** Student's published results only. */
export async function myResults(student: AuthUser) {
  const attempts = await prisma.examAttempt.findMany({
    where: { studentId: student.id, exam: { resultsPublished: true }, grade: { isNot: null } },
    include: { exam: { select: { id: true, title: true, allowReview: true, publishedAt: true, course: { select: { code: true, name: true } } } }, grade: true },
    orderBy: { startedAt: 'desc' },
  });
  return attempts.map((a) => ({
    attemptId: a.id,
    exam: a.exam,
    score: a.grade!.score,
    maxScore: a.grade!.maxScore,
    percentage: a.grade!.percentage,
    letter: a.grade!.letter,
    updatedAt: a.grade!.updatedAt,
  }));
}

/**
 * One published result with per-question review (if the lecturer allows review).
 * Errors: 404 if not the student's attempt or results are not published.
 */
export async function myResultDetail(student: AuthUser, attemptId: string) {
  const attempt = await prisma.examAttempt.findUnique({
    where: { id: attemptId },
    include: { exam: { include: { course: { select: { code: true, name: true } } } }, grade: true },
  });
  if (!attempt || attempt.studentId !== student.id) throw notFound('Result');
  // Unpublished results are never visible - respond as if it does not exist.
  if (!attempt.exam.resultsPublished || !attempt.grade) throw notFound('Result');
  const base = {
    attemptId,
    exam: { id: attempt.exam.id, title: attempt.exam.title, course: attempt.exam.course, allowReview: attempt.exam.allowReview },
    score: attempt.grade.score,
    maxScore: attempt.grade.maxScore,
    percentage: attempt.grade.percentage,
    letter: attempt.grade.letter,
    submittedAt: attempt.submittedAt,
  };
  if (!attempt.exam.allowReview) return { ...base, questions: [] };
  const aqs = await prisma.attemptQuestion.findMany({
    where: { attemptId },
    orderBy: { position: 'asc' },
    include: { question: { include: { options: true } }, answer: true },
  });
  return {
    ...base,
    questions: aqs.map((aq) => {
      const byId = new Map(aq.question.options.map((o) => [o.id, o]));
      const options = (aq.optionOrder.length ? aq.optionOrder.map((id) => byId.get(id)!).filter(Boolean) : aq.question.options).map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect }));
      return {
        position: aq.position,
        type: aq.question.type,
        text: aq.question.text,
        imageUrl: aq.question.imageUrl,
        marks: aq.marks,
        options,
        acceptedAnswers: aq.question.type === 'SHORT_ANSWER' ? aq.question.acceptedAnswers : [],
        yourOptionId: aq.answer?.selectedOptionId ?? null,
        yourText: aq.answer?.textAnswer ?? null,
        awardedMarks: aq.answer?.awardedMarks ?? 0,
        comment: aq.answer?.comment ?? null,
      };
    }),
  };
}

/** University grade scale, highest band first. */
export const listGradeScale = () => prisma.gradeScale.findMany({ orderBy: { minPercent: 'desc' } });

/** Guard used by routes: students may never call lecturer result endpoints. */
export function assertNotStudent(user: AuthUser) {
  if (user.role === 'STUDENT') throw forbidden();
}
