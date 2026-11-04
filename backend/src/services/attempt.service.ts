/**
 * Exam attempts - the core technical challenge.
 *
 * startAttempt  : checks enrolment, window and network, then generates a personal
 *                 random paper (rules -> random draw, shuffled questions and options)
 *                 and freezes it in attempt_questions. The server stores startedAt and
 *                 deadlineAt. Calling it again RESUMES the same attempt (same paper).
 * getAttempt    : returns the frozen paper, saved answers and `remainingMs` computed
 *                 from the server clock. Reload/reconnect = same call = full resume.
 * saveAnswer    : saved immediately on every change; REJECTED (409 TIME_UP) once the
 *                 server deadline (+ small network grace) has passed.
 * recordFocus   : tab-switch events (lost/regained) with server-measured duration.
 * submit / sweepExpiredAttempts : manual submit, or automatic submit at the deadline
 *                 with the answers saved so far; auto-grading runs on submit.
 */
import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../lib/prisma';
import { env } from '../config/env';
import { AppError, conflict, forbidden, notFound } from '../lib/errors';
import { computeDeadline, isPastDeadline, remainingMs, windowState } from '../core/timing';
import { drawQuestions, setKey } from '../core/examGenerator';
import { autoGrade } from '../core/grading';
import { isCountedFocusLoss, shouldWarn } from '../core/focus';
import { ipAllowed, normalizeIp } from '../lib/network';
import { shuffle } from '../lib/random';
import { loadBank } from './exam.service';
import { audit } from './audit.service';
import type { AuthUser } from '../middleware/auth';

const IN_PROGRESS = 'IN_PROGRESS' as const;

/** Network rules for an exam: every room's CIDR plus extra allowed addresses. Empty = any. */
async function examNetworkRules(examId: string, extra: string[]): Promise<string[]> {
  const rooms = await prisma.examRoom.findMany({ where: { examId }, include: { room: true } });
  return [...rooms.map((r) => r.room.network).filter((n): n is string => !!n), ...extra];
}

/**
 * Starts (or resumes) the student's attempt.
 * @returns { attemptId, resumed }
 * Errors: 404 exam; 403 NOT_ENROLLED / NETWORK_NOT_ALLOWED; 409 WINDOW_NOT_OPEN,
 * WINDOW_CLOSED, ALREADY_SUBMITTED, EXAM_NOT_SCHEDULED.
 */
export async function startAttempt(student: AuthUser, examId: string, ip: string, now: Date = new Date()) {
  const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { rules: true } });
  if (!exam) throw notFound('Exam');
  if (exam.status !== 'SCHEDULED' || !exam.windowStart || !exam.windowEnd) {
    throw conflict('EXAM_NOT_SCHEDULED', 'This exam is not scheduled');
  }
  const enrolment = await prisma.enrolment.findUnique({
    where: { courseId_studentId: { courseId: exam.courseId, studentId: student.id } },
  });
  if (!enrolment || enrolment.status !== 'ACTIVE') {
    throw new AppError(403, 'NOT_ENROLLED', 'You are not enrolled in this course');
  }

  const existing = await prisma.examAttempt.findUnique({ where: { examId_studentId: { examId, studentId: student.id } } });
  if (existing) {
    if (existing.status !== IN_PROGRESS) throw conflict('ALREADY_SUBMITTED', 'You have already submitted this exam');
    await prisma.examAttempt.update({ where: { id: existing.id }, data: { lastSeenAt: now } });
    return { attemptId: existing.id, resumed: true };
  }

  const state = windowState(exam.windowStart, exam.windowEnd, now);
  if (state === 'NOT_OPEN') throw conflict('WINDOW_NOT_OPEN', 'The exam has not opened yet');
  if (state === 'CLOSED') throw conflict('WINDOW_CLOSED', 'The exam window has closed');

  if (env.ENFORCE_NETWORK) {
    const rules = await examNetworkRules(examId, exam.allowedNetworks);
    if (!ipAllowed(ip, rules)) {
      await audit({ userId: student.id, action: 'EXAM_START_BLOCKED_NETWORK', entity: 'Exam', entityId: examId, ip });
      throw new AppError(403, 'NETWORK_NOT_ALLOWED', 'You must start this exam from an exam room computer');
    }
  }

  // Draw a personal paper. Retry a few times to avoid an exact copy of another student's set.
  const bank = await loadBank(exam.courseId);
  const otherSets = new Set(
    (
      await prisma.examAttempt.findMany({ where: { examId }, select: { questions: { select: { questionId: true } } } })
    ).map((a) => setKey(a.questions.map((q) => q.questionId))),
  );
  let picked = drawQuestions(exam.rules, bank);
  for (let i = 0; i < 10 && otherSets.has(setKey(picked.map((q) => q.id))); i++) {
    picked = drawQuestions(exam.rules, bank);
  }
  if (exam.shuffleQuestions) picked = shuffle(picked);

  const deadlineAt = computeDeadline(now, exam.durationMinutes, exam.windowEnd, 0);
  try {
    const attempt = await prisma.examAttempt.create({
      data: {
        examId,
        studentId: student.id,
        startedAt: now,
        lastSeenAt: now,
        deadlineAt,
        ipAddress: normalizeIp(ip),
        maxScore: picked.reduce((s, q) => s + q.marks, 0),
        questions: {
          create: picked.map((q, i) => ({
            questionId: q.id,
            position: i + 1,
            marks: q.marks,
            optionOrder: (exam.shuffleOptions && q.type === 'MCQ' ? shuffle(q.options) : q.options).map((o) => o.id),
          })),
        },
      },
    });
    await audit({ userId: student.id, action: 'EXAM_STARTED', entity: 'ExamAttempt', entityId: attempt.id, ip, details: { examId } });
    return { attemptId: attempt.id, resumed: false };
  } catch (err) {
    // Double click / two tabs: the unique (examId, studentId) index wins - resume that attempt.
    if ((err as { code?: string }).code === 'P2002') {
      const again = await prisma.examAttempt.findUniqueOrThrow({ where: { examId_studentId: { examId, studentId: student.id } } });
      return { attemptId: again.id, resumed: true };
    }
    throw err;
  }
}

async function loadOwnAttempt(student: AuthUser, attemptId: string) {
  const attempt = await prisma.examAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt) throw notFound('Attempt');
  if (attempt.studentId !== student.id) throw forbidden('This is not your exam');
  return attempt;
}

async function countedSwitches(attemptId: string, tx: Tx = prisma) {
  return tx.focusEvent.count({ where: { attemptId, counted: true } });
}

/**
 * Full exam state for the exam screen (also used on reload/reconnect).
 * Correct answers are never included. If the deadline has passed the attempt is
 * auto-submitted first and `status` reflects that.
 */
export async function getAttempt(student: AuthUser, attemptId: string, now: Date = new Date()) {
  let attempt = await loadOwnAttempt(student, attemptId);
  if (attempt.status === IN_PROGRESS && isPastDeadline(attempt.deadlineAt, now, env.DEADLINE_GRACE_SECONDS)) {
    await finalizeAttempt(attemptId, true);
    attempt = await prisma.examAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  }
  if (attempt.status === IN_PROGRESS) {
    await prisma.examAttempt.update({ where: { id: attemptId }, data: { lastSeenAt: now } });
  }
  const [exam, questions, switches] = await Promise.all([
    prisma.exam.findUniqueOrThrow({
      where: { id: attempt.examId },
      select: { id: true, title: true, instructions: true, durationMinutes: true, course: { select: { code: true, name: true } } },
    }),
    prisma.attemptQuestion.findMany({
      where: { attemptId },
      orderBy: { position: 'asc' },
      include: { question: { include: { options: true } }, answer: true },
    }),
    countedSwitches(attemptId),
  ]);
  const finished = attempt.status !== IN_PROGRESS;
  return {
    id: attempt.id,
    status: attempt.status,
    exam,
    startedAt: attempt.startedAt,
    deadlineAt: attempt.deadlineAt,
    submittedAt: attempt.submittedAt,
    serverNow: now,
    remainingMs: finished ? 0 : remainingMs(attempt.deadlineAt, now),
    extraMinutes: attempt.extraMinutes,
    tabSwitches: switches,
    warn: shouldWarn(switches),
    questions: finished
      ? []
      : questions.map((aq) => {
          const byId = new Map(aq.question.options.map((o) => [o.id, o]));
          const ordered = aq.optionOrder.length
            ? aq.optionOrder.map((id) => byId.get(id)).filter((o): o is NonNullable<typeof o> => !!o)
            : [...aq.question.options].sort((a, b) => a.position - b.position);
          return {
            attemptQuestionId: aq.id,
            position: aq.position,
            type: aq.question.type,
            text: aq.question.text,
            imageUrl: aq.question.imageUrl,
            marks: aq.marks,
            options: ordered.map((o) => ({ id: o.id, text: o.text })),
            answer: aq.answer
              ? { selectedOptionId: aq.answer.selectedOptionId, textAnswer: aq.answer.textAnswer, flagged: aq.answer.flagged, savedAt: aq.answer.savedAt }
              : null,
          };
        }),
  };
}

export interface SaveAnswerInput {
  attemptQuestionId: string;
  selectedOptionId?: string | null;
  textAnswer?: string | null;
  flagged?: boolean;
}

/**
 * Saves one answer immediately.
 * Errors: 409 TIME_UP if received after the server deadline (the attempt is then
 * auto-submitted), 409 ATTEMPT_CLOSED if already submitted, 400 INVALID_OPTION.
 */
export async function saveAnswer(student: AuthUser, attemptId: string, input: SaveAnswerInput, now: Date = new Date()) {
  const attempt = await loadOwnAttempt(student, attemptId);
  if (attempt.status !== IN_PROGRESS) throw conflict('ATTEMPT_CLOSED', 'This exam has already been submitted');
  if (isPastDeadline(attempt.deadlineAt, now, env.DEADLINE_GRACE_SECONDS)) {
    await audit({ userId: student.id, action: 'LATE_ANSWER_REJECTED', entity: 'ExamAttempt', entityId: attemptId, details: { receivedAt: now.toISOString(), deadlineAt: attempt.deadlineAt.toISOString() } });
    await finalizeAttempt(attemptId, true);
    throw conflict('TIME_UP', 'Time is up. Answers received after the deadline are not accepted.');
  }
  const aq = await prisma.attemptQuestion.findFirst({
    where: { id: input.attemptQuestionId, attemptId },
    include: { question: { select: { type: true } } },
  });
  if (!aq) throw notFound('Question in this exam');

  const data: Prisma.AnswerUncheckedUpdateInput = { savedAt: now };
  if (input.selectedOptionId !== undefined) {
    if (input.selectedOptionId !== null && !aq.optionOrder.includes(input.selectedOptionId)) {
      // TRUE_FALSE options are not shuffled but are stored in optionOrder too
      throw new AppError(400, 'INVALID_OPTION', 'This option does not belong to the question');
    }
    data.selectedOptionId = input.selectedOptionId;
  }
  if (input.textAnswer !== undefined) data.textAnswer = input.textAnswer;
  if (input.flagged !== undefined) data.flagged = input.flagged;

  const answer = await prisma.answer.upsert({
    where: { attemptQuestionId: aq.id },
    create: {
      attemptQuestionId: aq.id,
      selectedOptionId: (data.selectedOptionId as string | null | undefined) ?? null,
      textAnswer: (data.textAnswer as string | null | undefined) ?? null,
      flagged: (data.flagged as boolean | undefined) ?? false,
      savedAt: now,
    },
    update: data,
  });
  await prisma.examAttempt.update({ where: { id: attemptId }, data: { lastSeenAt: now } });
  return { savedAt: answer.savedAt, remainingMs: remainingMs(attempt.deadlineAt, now) };
}

/** Keeps the attempt "connected" and re-syncs the timer (extensions show up here). */
export async function heartbeat(student: AuthUser, attemptId: string, now: Date = new Date()) {
  const attempt = await loadOwnAttempt(student, attemptId);
  if (attempt.status === IN_PROGRESS && isPastDeadline(attempt.deadlineAt, now, env.DEADLINE_GRACE_SECONDS)) {
    await finalizeAttempt(attemptId, true);
    return { status: 'AUTO_SUBMITTED' as const, remainingMs: 0, serverNow: now, tabSwitches: await countedSwitches(attemptId) };
  }
  if (attempt.status === IN_PROGRESS) await prisma.examAttempt.update({ where: { id: attemptId }, data: { lastSeenAt: now } });
  const switches = await countedSwitches(attemptId);
  return {
    status: attempt.status,
    remainingMs: attempt.status === IN_PROGRESS ? remainingMs(attempt.deadlineAt, now) : 0,
    deadlineAt: attempt.deadlineAt,
    extraMinutes: attempt.extraMinutes,
    serverNow: now,
    tabSwitches: switches,
    warn: shouldWarn(switches),
  };
}

/**
 * Records a tab-switch event.
 * LOST: opens an event at server time. REGAINED: closes the latest open event and
 * measures the duration on the server. If the LOST event never arrived (offline), the
 * client-measured duration is used. Losses under 1 s are logged but not counted.
 * @returns { tabSwitches, warn } - warn is true from the 3rd counted switch
 */
export async function recordFocus(
  student: AuthUser,
  attemptId: string,
  input: { type: 'LOST' | 'REGAINED'; durationMs?: number },
  now: Date = new Date(),
) {
  const attempt = await loadOwnAttempt(student, attemptId);
  if (attempt.status !== IN_PROGRESS) return { tabSwitches: await countedSwitches(attemptId), warn: false };

  if (input.type === 'LOST') {
    const open = await prisma.focusEvent.findFirst({ where: { attemptId, regainedAt: null } });
    if (!open) await prisma.focusEvent.create({ data: { attemptId, lostAt: now } });
  } else {
    const open = await prisma.focusEvent.findFirst({ where: { attemptId, regainedAt: null }, orderBy: { lostAt: 'desc' } });
    if (open) {
      const durationMs = now.getTime() - open.lostAt.getTime();
      await prisma.focusEvent.update({
        where: { id: open.id },
        data: { regainedAt: now, durationMs, counted: isCountedFocusLoss(durationMs) },
      });
    } else {
      const durationMs = Math.max(0, Math.min(input.durationMs ?? 0, 6 * 3600_000));
      await prisma.focusEvent.create({
        data: { attemptId, lostAt: new Date(now.getTime() - durationMs), regainedAt: now, durationMs, counted: isCountedFocusLoss(durationMs) },
      });
    }
  }
  const switches = await countedSwitches(attemptId);
  return { tabSwitches: switches, warn: shouldWarn(switches) };
}

/** Manual submit. If it arrives after the deadline it is recorded as AUTO_SUBMITTED. */
export async function submitAttempt(student: AuthUser, attemptId: string, now: Date = new Date()) {
  const attempt = await loadOwnAttempt(student, attemptId);
  if (attempt.status !== IN_PROGRESS) return { status: attempt.status, alreadySubmitted: true };
  const late = isPastDeadline(attempt.deadlineAt, now, env.DEADLINE_GRACE_SECONDS);
  await finalizeAttempt(attemptId, late, now);
  await audit({ userId: student.id, action: late ? 'EXAM_AUTO_SUBMITTED' : 'EXAM_SUBMITTED', entity: 'ExamAttempt', entityId: attemptId });
  return { status: late ? 'AUTO_SUBMITTED' : 'SUBMITTED', alreadySubmitted: false };
}

/**
 * Recomputes an attempt's score and grading status from its answers.
 * gradingStatus = NEEDS_REVIEW while any answer still needs a lecturer.
 */
export async function recomputeAttempt(tx: Tx, attemptId: string) {
  const answers = await tx.answer.findMany({ where: { attemptQuestion: { attemptId } }, select: { status: true, awardedMarks: true } });
  const pending = answers.some((a) => a.status === 'NEEDS_REVIEW' || a.status === 'UNGRADED');
  const score = answers.reduce((s, a) => s + (a.awardedMarks ?? 0), 0);
  await tx.examAttempt.update({
    where: { id: attemptId },
    data: { score: Math.round(score * 100) / 100, gradingStatus: pending ? 'NEEDS_REVIEW' : 'GRADED' },
  });
}

/**
 * Closes an attempt exactly once (safe to call concurrently) and auto-grades it.
 * Unanswered questions get an answer row with 0 marks so analytics count them.
 * @param auto true = time ran out (AUTO_SUBMITTED)
 * @returns true if this call closed the attempt
 */
export async function finalizeAttempt(attemptId: string, auto: boolean, now: Date = new Date()): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const attempt = await tx.examAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    const closed = await tx.examAttempt.updateMany({
      where: { id: attemptId, status: IN_PROGRESS },
      data: {
        status: auto ? 'AUTO_SUBMITTED' : 'SUBMITTED',
        // An automatic submit happens AT the deadline, even if the sweeper runs a moment later.
        submittedAt: auto && now > attempt.deadlineAt ? attempt.deadlineAt : now,
      },
    });
    if (closed.count === 0) return false;

    const aqs = await tx.attemptQuestion.findMany({
      where: { attemptId },
      include: { question: { include: { options: true } }, answer: true },
    });
    for (const aq of aqs) {
      const result = autoGrade(
        { type: aq.question.type, marks: aq.marks, acceptedAnswers: aq.question.acceptedAnswers, options: aq.question.options },
        aq.answer,
      );
      await tx.answer.upsert({
        where: { attemptQuestionId: aq.id },
        create: { attemptQuestionId: aq.id, status: result.status, awardedMarks: result.awardedMarks, savedAt: now },
        update: { status: result.status, awardedMarks: result.awardedMarks },
      });
    }
    await recomputeAttempt(tx, attemptId);
    return true;
  }, { timeout: 30_000 });
}

/** Background job: auto-submits every attempt whose deadline has passed. Returns how many. */
export async function sweepExpiredAttempts(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - env.DEADLINE_GRACE_SECONDS * 1000);
  const expired = await prisma.examAttempt.findMany({
    where: { status: IN_PROGRESS, deadlineAt: { lt: cutoff } },
    select: { id: true, studentId: true },
    take: 200,
  });
  let n = 0;
  for (const a of expired) {
    if (await finalizeAttempt(a.id, true, now)) {
      n++;
      await audit({ userId: a.studentId, action: 'EXAM_AUTO_SUBMITTED', entity: 'ExamAttempt', entityId: a.id });
    }
  }
  return n;
}
