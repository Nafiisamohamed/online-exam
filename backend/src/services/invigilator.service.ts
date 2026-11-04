/**
 * Invigilator live view.
 *
 * Lists every student of the exam with a live status:
 *   NOT_STARTED | IN_PROGRESS (answered/total) | SUBMITTED | DISCONNECTED (no heartbeat for 30 s)
 * plus tab-switch count, remaining time and notes. The UI polls this every few seconds.
 * Invigilators may add notes and extend one student's time (with reason), at most
 * 15 minutes in total per student.
 */
import { prisma } from '../lib/prisma';
import { badRequest, conflict, notFound } from '../lib/errors';
import { computeDeadline, isPastDeadline, MAX_EXTENSION_MINUTES, remainingMs } from '../core/timing';
import { isDisconnected } from '../core/focus';
import { assertExamInvigilate } from './access.service';
import { audit } from './audit.service';
import { notify } from './notification.service';
import { env } from '../config/env';
import type { AuthUser } from '../middleware/auth';

export type LiveStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'DISCONNECTED';

/** Live list of students for one exam. */
export async function liveView(user: AuthUser, examId: string, now: Date = new Date()) {
  const exam = await assertExamInvigilate(user, examId);
  const [enrolments, attempts, notes] = await Promise.all([
    prisma.enrolment.findMany({
      where: { courseId: exam.courseId, status: 'ACTIVE' },
      include: { student: { select: { id: true, fullName: true, studentId: true } } },
    }),
    prisma.examAttempt.findMany({
      where: { examId },
      include: {
        student: { select: { id: true, fullName: true, studentId: true } },
        _count: { select: { questions: true } },
        questions: { select: { answer: { select: { selectedOptionId: true, textAnswer: true } } } },
        focusEvents: { where: { counted: true }, select: { id: true } },
      },
    }),
    prisma.invigilatorNote.findMany({
      where: { examId },
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { fullName: true } } },
    }),
  ]);

  const attemptByStudent = new Map(attempts.map((a) => [a.studentId, a]));
  const students = new Map(enrolments.map((e) => [e.student.id, e.student]));
  // Students who started but were dropped later still appear.
  attempts.forEach((a) => students.set(a.student.id, a.student));

  const rows = [...students.values()].map((s) => {
    const a = attemptByStudent.get(s.id);
    if (!a) {
      return { studentUserId: s.id, studentId: s.studentId, fullName: s.fullName, status: 'NOT_STARTED' as LiveStatus, attemptId: null, answered: 0, total: 0, tabSwitches: 0, remainingMs: null, extraMinutes: 0, lastSeenAt: null, startedAt: null, ipAddress: null };
    }
    const answered = a.questions.filter((q) => q.answer && (q.answer.selectedOptionId || q.answer.textAnswer?.trim())).length;
    let status: LiveStatus = a.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'SUBMITTED';
    if (status === 'IN_PROGRESS' && isDisconnected(a.lastSeenAt, now)) status = 'DISCONNECTED';
    return {
      studentUserId: s.id,
      studentId: s.studentId,
      fullName: s.fullName,
      status,
      attemptStatus: a.status,
      attemptId: a.id,
      answered,
      total: a._count.questions,
      tabSwitches: a.focusEvents.length,
      remainingMs: a.status === 'IN_PROGRESS' ? remainingMs(a.deadlineAt, now) : 0,
      extraMinutes: a.extraMinutes,
      lastSeenAt: a.lastSeenAt,
      startedAt: a.startedAt,
      ipAddress: a.ipAddress,
    };
  });
  rows.sort((x, y) => (x.fullName ?? '').localeCompare(y.fullName ?? ''));

  const count = (s: LiveStatus) => rows.filter((r) => r.status === s).length;
  return {
    exam: { id: exam.id, title: exam.title, courseCode: exam.course.code, windowStart: exam.windowStart, windowEnd: exam.windowEnd, durationMinutes: exam.durationMinutes },
    serverNow: now,
    summary: { total: rows.length, notStarted: count('NOT_STARTED'), inProgress: count('IN_PROGRESS'), submitted: count('SUBMITTED'), disconnected: count('DISCONNECTED'), flagged: rows.filter((r) => r.tabSwitches >= 3).length },
    students: rows,
    notes: notes.map((n) => ({ id: n.id, attemptId: n.attemptId, text: n.text, author: n.author.fullName, createdAt: n.createdAt })),
  };
}

/** Adds a note to the exam log (optionally about one attempt). */
export async function addNote(user: AuthUser, examId: string, input: { attemptId?: string | null; text: string }) {
  await assertExamInvigilate(user, examId);
  if (input.attemptId) {
    const a = await prisma.examAttempt.findFirst({ where: { id: input.attemptId, examId } });
    if (!a) throw notFound('Attempt');
  }
  const note = await prisma.invigilatorNote.create({
    data: { examId, attemptId: input.attemptId ?? null, authorId: user.id, text: input.text },
  });
  await audit({ userId: user.id, action: 'INVIGILATOR_NOTE', entity: 'Exam', entityId: examId, details: { attemptId: input.attemptId ?? null } });
  return note;
}

/**
 * Extends one student's time. Total extensions per attempt are capped at 15 minutes.
 * Errors: 400 EXTENSION_LIMIT, 409 ATTEMPT_CLOSED (already submitted / time already up).
 */
export async function extendTime(user: AuthUser, attemptId: string, minutes: number, reason: string, now: Date = new Date()) {
  const attempt = await prisma.examAttempt.findUnique({ where: { id: attemptId }, include: { exam: true } });
  if (!attempt) throw notFound('Attempt');
  await assertExamInvigilate(user, attempt.examId);
  if (attempt.status !== 'IN_PROGRESS' || isPastDeadline(attempt.deadlineAt, now, env.DEADLINE_GRACE_SECONDS)) {
    throw conflict('ATTEMPT_CLOSED', 'This attempt has already ended');
  }
  const total = attempt.extraMinutes + minutes;
  if (minutes < 1 || total > MAX_EXTENSION_MINUTES) {
    throw badRequest('EXTENSION_LIMIT', `Extensions are limited to ${MAX_EXTENSION_MINUTES} minutes per student (already ${attempt.extraMinutes})`);
  }
  const deadlineAt = computeDeadline(attempt.startedAt, attempt.exam.durationMinutes, attempt.exam.windowEnd!, total);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.timeExtension.create({ data: { attemptId, minutes, reason, grantedById: user.id } });
    await tx.invigilatorNote.create({
      data: { examId: attempt.examId, attemptId, authorId: user.id, text: `+${minutes} min: ${reason}` },
    });
    return tx.examAttempt.update({ where: { id: attemptId }, data: { extraMinutes: total, deadlineAt } });
  });
  await audit({ userId: user.id, action: 'TIME_EXTENDED', entity: 'ExamAttempt', entityId: attemptId, details: { minutes, reason, newDeadline: deadlineAt.toISOString() } });
  await notify(
    [attempt.studentId],
    { en: 'Extra time added', so: 'Waqti dheeraad ah ayaa lagu daray' },
    { en: `You received ${minutes} extra minutes.`, so: `Waxaad heshay ${minutes} daqiiqo oo dheeraad ah.` },
  );
  return { extraMinutes: updated.extraMinutes, deadlineAt: updated.deadlineAt, remainingMs: remainingMs(updated.deadlineAt, now) };
}

/** Focus (tab-switch) events of one attempt for the detail drawer. */
export async function attemptFocusEvents(user: AuthUser, attemptId: string) {
  const attempt = await prisma.examAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt) throw notFound('Attempt');
  await assertExamInvigilate(user, attempt.examId);
  return prisma.focusEvent.findMany({ where: { attemptId }, orderBy: { lostAt: 'asc' } });
}
