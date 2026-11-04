/**
 * Exam builder and scheduling service.
 *
 * Builder (Lecturer): title, instructions, rules like "10 EASY from topics X,Y",
 *   shuffle options. Saving rules is BLOCKED if the bank cannot satisfy them.
 *   A sample paper can be previewed before publishing.
 * Scheduling: the lecturer requests a window + duration + rooms/networks + invigilators
 *   (status PENDING_APPROVAL); the admin approves (SCHEDULED) or rejects.
 * Rules: duration must fit the window; a student's exams may not overlap - any
 *   clash with another pending/scheduled exam that shares a student is blocked.
 */
import type { Difficulty, ExamStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { checkFeasibility, drawQuestions, difficultyProfile, type RuleSpec } from '../core/examGenerator';
import { durationFitsWindow, windowState } from '../core/timing';
import { isValidNetworkRule } from '../lib/network';
import { shuffle } from '../lib/random';
import { assertCourseAccess, assertExamManage } from './access.service';
import { audit } from './audit.service';
import { notify } from './notification.service';
import type { AuthUser } from '../middleware/auth';

const examInclude = {
  course: { select: { id: true, code: true, name: true, lecturerId: true } },
  rules: true,
  rooms: { include: { room: true } },
  invigilators: { include: { user: { select: { id: true, fullName: true } } } },
  secondGrader: { select: { id: true, fullName: true } },
  _count: { select: { attempts: true } },
} satisfies Prisma.ExamInclude;

/** Active bank questions of a course (latest versions only). */
export async function loadBank(courseId: string) {
  return prisma.question.findMany({
    where: { courseId, isLatest: true, isArchived: false },
    include: { options: { orderBy: { position: 'asc' } } },
  });
}

/** Lists exams visible to the user (scoped by role). */
export async function listExams(user: AuthUser) {
  let where: Prisma.ExamWhereInput = {};
  if (user.role === 'LECTURER') where = { OR: [{ course: { lecturerId: user.id } }, { secondGraderId: user.id }] };
  if (user.role === 'INVIGILATOR') where = { invigilators: { some: { userId: user.id } }, status: 'SCHEDULED' };
  if (user.role === 'STUDENT') throw forbidden();
  return prisma.exam.findMany({ where, orderBy: [{ windowStart: 'desc' }, { createdAt: 'desc' }], include: examInclude });
}

/** Exam detail with a live feasibility check of its rules. */
export async function getExam(user: AuthUser, examId: string) {
  const exam = await assertExamManage(user, examId);
  const full = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id }, include: examInclude });
  const bank = await loadBank(full.courseId);
  return { ...full, feasibility: checkFeasibility(full.rules, bank), bankSize: bank.length };
}

export interface ExamDetailsInput {
  courseId: string;
  title: string;
  instructions?: string;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  durationMinutes?: number;
  allowReview?: boolean;
}

export async function createExam(user: AuthUser, input: ExamDetailsInput) {
  await assertCourseAccess(user, input.courseId);
  const exam = await prisma.exam.create({
    data: {
      courseId: input.courseId,
      title: input.title,
      instructions: input.instructions ?? '',
      shuffleQuestions: input.shuffleQuestions ?? true,
      shuffleOptions: input.shuffleOptions ?? true,
      durationMinutes: input.durationMinutes ?? 60,
      allowReview: input.allowReview ?? true,
      createdById: user.id,
    },
  });
  await audit({ userId: user.id, action: 'EXAM_CREATED', entity: 'Exam', entityId: exam.id, details: { title: exam.title } });
  return exam;
}

const EDITABLE: ExamStatus[] = ['DRAFT', 'REJECTED'];

function assertEditable(status: ExamStatus) {
  if (!EDITABLE.includes(status)) {
    throw conflict('EXAM_LOCKED', 'Exam is waiting for approval or scheduled. Withdraw it to make changes.');
  }
}

export async function updateExam(user: AuthUser, examId: string, input: Partial<Omit<ExamDetailsInput, 'courseId'>>) {
  const exam = await assertExamManage(user, examId);
  // allowReview can change any time (it only affects what students see after publishing)
  const onlyReview = Object.keys(input).every((k) => k === 'allowReview');
  if (!onlyReview) assertEditable(exam.status);
  const updated = await prisma.exam.update({ where: { id: examId }, data: input });
  await audit({ userId: user.id, action: 'EXAM_UPDATED', entity: 'Exam', entityId: examId, details: input });
  return updated;
}

/** Checks rules against the course bank without saving (live feedback in the builder). */
export async function checkRules(user: AuthUser, examId: string, rules: RuleSpec[]) {
  const exam = await assertExamManage(user, examId);
  return checkFeasibility(rules, await loadBank(exam.courseId));
}

/**
 * Replaces the exam rules. Errors: 400 RULES_NOT_FEASIBLE (with shortages) if the bank
 * does not have enough questions, 409 EXAM_LOCKED if the exam is not a draft.
 */
export async function setRules(user: AuthUser, examId: string, rules: RuleSpec[]) {
  const exam = await assertExamManage(user, examId);
  assertEditable(exam.status);
  if (rules.length === 0) throw badRequest('RULES_REQUIRED', 'Add at least one rule');
  const feasibility = checkFeasibility(rules, await loadBank(exam.courseId));
  if (!feasibility.ok) {
    throw new AppError(400, 'RULES_NOT_FEASIBLE', 'The question bank does not have enough questions for these rules', feasibility);
  }
  await prisma.$transaction([
    prisma.examRule.deleteMany({ where: { examId } }),
    prisma.examRule.createMany({
      data: rules.map((r) => ({ examId, difficulty: r.difficulty as Difficulty, count: r.count, topics: r.topics.map((t) => t.trim()).filter(Boolean) })),
    }),
  ]);
  await audit({ userId: user.id, action: 'EXAM_RULES_SET', entity: 'Exam', entityId: examId, details: { rules } as unknown as Prisma.InputJsonValue });
  return prisma.examRule.findMany({ where: { examId } });
}

/** Generates one sample paper (not saved) so the lecturer can check it before publishing. */
export async function previewExam(user: AuthUser, examId: string) {
  const exam = await assertExamManage(user, examId);
  const rules = await prisma.examRule.findMany({ where: { examId } });
  if (rules.length === 0) throw badRequest('RULES_REQUIRED', 'Add rules before previewing');
  const bank = await loadBank(exam.courseId);
  const feasibility = checkFeasibility(rules, bank);
  if (!feasibility.ok) throw new AppError(400, 'RULES_NOT_FEASIBLE', 'Not enough questions', feasibility);
  let picked = drawQuestions(rules, bank);
  if (exam.shuffleQuestions) picked = shuffle(picked);
  return {
    profile: difficultyProfile(picked),
    totalMarks: picked.reduce((s, q) => s + q.marks, 0),
    questions: picked.map((q, i) => ({
      position: i + 1,
      id: q.id,
      type: q.type,
      text: q.text,
      imageUrl: q.imageUrl,
      marks: q.marks,
      topic: q.topic,
      difficulty: q.difficulty,
      acceptedAnswers: q.acceptedAnswers,
      options: (exam.shuffleOptions && q.type === 'MCQ' ? shuffle(q.options) : q.options).map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect })),
    })),
  };
}

export interface ScheduleInput {
  windowStart: Date;
  windowEnd: Date;
  durationMinutes: number;
  roomIds: string[];
  allowedNetworks: string[];
  invigilatorIds: string[];
}

export interface Clash {
  examId: string;
  title: string;
  courseCode: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  sharedStudents: number;
}

/**
 * Other pending/scheduled exams whose window overlaps [start, end) and which share at
 * least one actively enrolled student with `courseId`.
 */
export async function findClashes(courseId: string, start: Date, end: Date, excludeExamId?: string): Promise<Clash[]> {
  const overlapping = await prisma.exam.findMany({
    where: {
      id: excludeExamId ? { not: excludeExamId } : undefined,
      status: { in: ['PENDING_APPROVAL', 'SCHEDULED'] },
      windowStart: { lt: end },
      windowEnd: { gt: start },
    },
    include: { course: { select: { code: true } } },
  });
  if (overlapping.length === 0) return [];
  const myStudents = new Set(
    (await prisma.enrolment.findMany({ where: { courseId, status: 'ACTIVE' }, select: { studentId: true } })).map((e) => e.studentId),
  );
  const clashes: Clash[] = [];
  for (const other of overlapping) {
    const theirs = await prisma.enrolment.findMany({ where: { courseId: other.courseId, status: 'ACTIVE' }, select: { studentId: true } });
    const shared = theirs.filter((e) => myStudents.has(e.studentId)).length;
    if (shared > 0) {
      clashes.push({ examId: other.id, title: other.title, courseCode: other.course.code, windowStart: other.windowStart, windowEnd: other.windowEnd, sharedStudents: shared });
    }
  }
  return clashes;
}

/**
 * Lecturer requests a schedule; the exam goes to PENDING_APPROVAL.
 * Errors: 400 DURATION_EXCEEDS_WINDOW, WINDOW_IN_PAST, INVALID_NETWORK, INVALID_ROOM,
 * INVALID_INVIGILATOR, RULES_REQUIRED/RULES_NOT_FEASIBLE; 409 SCHEDULE_CLASH (with clashes).
 */
export async function requestSchedule(user: AuthUser, examId: string, input: ScheduleInput) {
  const exam = await assertExamManage(user, examId);
  assertEditable(exam.status);
  const { windowStart, windowEnd, durationMinutes } = input;
  if (!(windowEnd > windowStart)) throw badRequest('WINDOW_INVALID', 'Window end must be after the start');
  if (windowEnd <= new Date()) throw badRequest('WINDOW_IN_PAST', 'The exam window has already ended');
  if (!durationFitsWindow(windowStart, windowEnd, durationMinutes)) {
    throw badRequest('DURATION_EXCEEDS_WINDOW', 'The duration must fit within the exam window');
  }
  const badNet = input.allowedNetworks.find((n) => !isValidNetworkRule(n));
  if (badNet) throw badRequest('INVALID_NETWORK', `Invalid network address: ${badNet}`);
  const rooms = await prisma.room.findMany({ where: { id: { in: input.roomIds } } });
  if (rooms.length !== new Set(input.roomIds).size) throw badRequest('INVALID_ROOM', 'Unknown room');
  const invigilators = await prisma.user.findMany({ where: { id: { in: input.invigilatorIds }, role: 'INVIGILATOR', isActive: true } });
  if (invigilators.length !== new Set(input.invigilatorIds).size) throw badRequest('INVALID_INVIGILATOR', 'Unknown invigilator');

  const rules = await prisma.examRule.findMany({ where: { examId } });
  if (rules.length === 0) throw badRequest('RULES_REQUIRED', 'Add question rules before scheduling');
  const feasibility = checkFeasibility(rules, await loadBank(exam.courseId));
  if (!feasibility.ok) throw new AppError(400, 'RULES_NOT_FEASIBLE', 'Not enough questions', feasibility);

  const clashes = await findClashes(exam.courseId, windowStart, windowEnd, examId);
  if (clashes.length) throw conflict('SCHEDULE_CLASH', 'Students in this course have another exam at that time', clashes);

  await prisma.$transaction([
    prisma.examRoom.deleteMany({ where: { examId } }),
    prisma.examInvigilator.deleteMany({ where: { examId } }),
    prisma.exam.update({
      where: { id: examId },
      data: {
        windowStart,
        windowEnd,
        durationMinutes,
        allowedNetworks: input.allowedNetworks.map((n) => n.trim()),
        status: 'PENDING_APPROVAL',
        rejectionReason: null,
        rooms: { create: input.roomIds.map((roomId) => ({ roomId })) },
        invigilators: { create: input.invigilatorIds.map((userId) => ({ userId })) },
      },
    }),
  ]);
  await audit({ userId: user.id, action: 'EXAM_SCHEDULE_REQUESTED', entity: 'Exam', entityId: examId, details: { windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString(), durationMinutes } });
  return prisma.exam.findUniqueOrThrow({ where: { id: examId }, include: examInclude });
}

/** Lecturer withdraws a pending (or not yet started) exam back to DRAFT. */
export async function withdrawExam(user: AuthUser, examId: string) {
  const exam = await assertExamManage(user, examId);
  const attempts = await prisma.examAttempt.count({ where: { examId } });
  if (attempts > 0) throw conflict('EXAM_STARTED', 'Students have already started this exam');
  if (exam.status === 'DRAFT') return exam;
  const updated = await prisma.exam.update({ where: { id: examId }, data: { status: 'DRAFT' } });
  await audit({ userId: user.id, action: 'EXAM_WITHDRAWN', entity: 'Exam', entityId: examId });
  return updated;
}

/** Exams waiting for admin approval, with clash information. */
export async function listPendingApprovals() {
  const exams = await prisma.exam.findMany({
    where: { status: 'PENDING_APPROVAL' },
    orderBy: { windowStart: 'asc' },
    include: { ...examInclude, createdBy: { select: { fullName: true } } },
  });
  return Promise.all(
    exams.map(async (e) => ({
      ...e,
      clashes: e.windowStart && e.windowEnd ? await findClashes(e.courseId, e.windowStart, e.windowEnd, e.id) : [],
    })),
  );
}

/** Admin approves: re-checks clashes, schedules the exam and notifies students (+SMS). */
export async function approveExam(admin: AuthUser, examId: string) {
  const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { course: true } });
  if (!exam) throw notFound('Exam');
  if (exam.status !== 'PENDING_APPROVAL') throw conflict('NOT_PENDING', 'Exam is not waiting for approval');
  if (!exam.windowStart || !exam.windowEnd) throw badRequest('WINDOW_INVALID', 'Exam has no window');
  // Enrolments may have changed since the request, so check again.
  const clashes = await findClashes(exam.courseId, exam.windowStart, exam.windowEnd, examId);
  if (clashes.length) throw conflict('SCHEDULE_CLASH', 'This exam clashes with another exam', clashes);
  const updated = await prisma.exam.update({ where: { id: examId }, data: { status: 'SCHEDULED' } });
  await audit({ userId: admin.id, action: 'EXAM_APPROVED', entity: 'Exam', entityId: examId });
  const students = await prisma.enrolment.findMany({ where: { courseId: exam.courseId, status: 'ACTIVE' }, select: { studentId: true } });
  const when = exam.windowStart.toLocaleString('en-GB', { timeZone: 'Africa/Mogadishu', dateStyle: 'medium', timeStyle: 'short' });
  await notify(
    students.map((s) => s.studentId),
    { en: `Exam scheduled: ${exam.title}`, so: `Imtixaan la qorsheeyay: ${exam.title}` },
    {
      en: `${exam.course.code} ${exam.title} opens ${when} (${exam.durationMinutes} min).`,
      so: `${exam.course.code} ${exam.title} wuxuu furmayaa ${when} (${exam.durationMinutes} daqiiqo).`,
    },
    true,
  );
  return updated;
}

export async function rejectExam(admin: AuthUser, examId: string, reason: string) {
  const exam = await prisma.exam.findUnique({ where: { id: examId } });
  if (!exam) throw notFound('Exam');
  if (exam.status !== 'PENDING_APPROVAL') throw conflict('NOT_PENDING', 'Exam is not waiting for approval');
  const updated = await prisma.exam.update({ where: { id: examId }, data: { status: 'REJECTED', rejectionReason: reason } });
  await audit({ userId: admin.id, action: 'EXAM_REJECTED', entity: 'Exam', entityId: examId, details: { reason } });
  await notify(
    [exam.createdById],
    { en: `Exam schedule rejected: ${exam.title}`, so: `Jadwalka imtixaanka waa la diiday: ${exam.title}` },
    { en: reason, so: reason },
  );
  return updated;
}

/** Assigns (or clears) a second lecturer who grades essays blind. */
export async function setSecondGrader(user: AuthUser, examId: string, lecturerId: string | null) {
  const exam = await assertExamManage(user, examId);
  if (lecturerId) {
    const lec = await prisma.user.findFirst({ where: { id: lecturerId, role: 'LECTURER', isActive: true } });
    if (!lec) throw badRequest('INVALID_LECTURER', 'Unknown lecturer');
    if (lec.id === exam.course.lecturerId) throw badRequest('SAME_LECTURER', 'Choose a different lecturer');
  }
  const updated = await prisma.exam.update({ where: { id: examId }, data: { secondGraderId: lecturerId } });
  await audit({ userId: user.id, action: 'SECOND_GRADER_SET', entity: 'Exam', entityId: examId, details: { lecturerId } });
  return updated;
}

/** Student view: scheduled exams of courses they are actively enrolled in, with their attempt state. */
export async function listStudentExams(student: AuthUser) {
  const exams = await prisma.exam.findMany({
    where: { status: 'SCHEDULED', course: { enrolments: { some: { studentId: student.id, status: 'ACTIVE' } } } },
    orderBy: { windowStart: 'asc' },
    include: {
      course: { select: { code: true, name: true } },
      rules: true,
      attempts: { where: { studentId: student.id }, select: { id: true, status: true, deadlineAt: true, submittedAt: true } },
    },
  });
  const now = new Date();
  return exams.map((e) => ({
    id: e.id,
    title: e.title,
    instructions: e.instructions,
    course: e.course,
    windowStart: e.windowStart,
    windowEnd: e.windowEnd,
    durationMinutes: e.durationMinutes,
    questionCount: e.rules.reduce((s, r) => s + r.count, 0),
    windowState: e.windowStart && e.windowEnd ? windowState(e.windowStart, e.windowEnd, now) : 'NOT_OPEN',
    attempt: e.attempts[0] ?? null,
    resultsPublished: e.resultsPublished,
  }));
}
