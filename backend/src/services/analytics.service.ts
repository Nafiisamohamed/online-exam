/**
 * Analytics from real database queries (never hard-coded numbers).
 *
 * examAnalytics: score statistics and distribution for one exam, plus per-question
 *   difficulty index and discrimination (see core/analytics).
 * dashboard: counts and chart data for the admin/lecturer dashboard.
 */
import { prisma } from '../lib/prisma';
import { examStats, itemStats } from '../core/analytics';
import { percentage } from '../core/grading';
import { assertExamManage } from './access.service';
import type { AuthUser } from '../middleware/auth';

/**
 * A response counts as "correct" when it earned full marks (objective questions) or at
 * least half the marks (manually graded essays / short answers). Ungraded answers are skipped.
 */
function isCorrect(awarded: number | null, marks: number, manual: boolean): boolean | null {
  if (awarded === null) return null;
  return manual ? awarded >= marks / 2 : awarded >= marks - 1e-9;
}

export async function examAnalytics(user: AuthUser, examId: string) {
  const exam = await assertExamManage(user, examId);
  const attempts = await prisma.examAttempt.findMany({
    where: { examId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
    include: {
      questions: { include: { answer: true, question: { select: { id: true, rootId: true, version: true, text: true, type: true, topic: true, difficulty: true } } } },
      focusEvents: { where: { counted: true }, select: { id: true } },
    },
  });
  const percentages = attempts.map((a) => percentage(a.score ?? 0, a.maxScore));
  // Pass mark = lowest band on the university scale that earns grade points (e.g. D = 60%).
  const scale = await prisma.gradeScale.findMany();
  const passMark = Math.min(...scale.filter((s) => s.points > 0).map((s) => s.minPercent), 100);

  const byQuestion = new Map<string, { meta: (typeof attempts)[number]['questions'][number]['question']; marks: number; responses: { attemptId: string; totalScore: number; correct: boolean }[]; avgMarks: number[] }>();
  for (const a of attempts) {
    for (const aq of a.questions) {
      const entry = byQuestion.get(aq.questionId) ?? { meta: aq.question, marks: aq.marks, responses: [], avgMarks: [] };
      const manual = aq.answer?.status === 'MANUALLY_GRADED';
      const correct = isCorrect(aq.answer?.awardedMarks ?? null, aq.marks, manual);
      if (correct !== null) {
        entry.responses.push({ attemptId: a.id, totalScore: a.score ?? 0, correct });
        entry.avgMarks.push(aq.answer?.awardedMarks ?? 0);
      }
      byQuestion.set(aq.questionId, entry);
    }
  }
  const questions = [...byQuestion.values()]
    .map((q) => ({
      questionId: q.meta.id,
      version: q.meta.version,
      text: q.meta.text,
      type: q.meta.type,
      topic: q.meta.topic,
      difficulty: q.meta.difficulty,
      marks: q.marks,
      averageMarks: q.avgMarks.length ? Math.round((q.avgMarks.reduce((s, x) => s + x, 0) / q.avgMarks.length) * 100) / 100 : null,
      ...itemStats(q.responses),
    }))
    .sort((a, b) => Number(b.flagged) - Number(a.flagged) || (a.difficultyIndex ?? 2) - (b.difficultyIndex ?? 2));

  return {
    exam: { id: exam.id, title: exam.title, courseCode: exam.course.code },
    stats: examStats(percentages),
    passMark,
    passRate: percentages.length ? Math.round((percentages.filter((p) => p >= passMark).length / percentages.length) * 1000) / 10 : null,
    flaggedStudents: attempts.filter((a) => a.focusEvents.length >= 3).length,
    questions,
  };
}

/** Dashboard numbers and chart data, scoped to the lecturer's courses for lecturers. */
export async function dashboard(user: AuthUser) {
  const courseWhere = user.role === 'LECTURER' ? { lecturerId: user.id } : {};
  const courses = await prisma.course.findMany({ where: courseWhere, select: { id: true, code: true } });
  const courseIds = courses.map((c) => c.id);

  const [students, exams, attempts, questions, grades, examStatus, pendingApprovals, needsReview] = await Promise.all([
    prisma.enrolment.findMany({ where: { courseId: { in: courseIds }, status: 'ACTIVE' }, distinct: ['studentId'], select: { studentId: true } }),
    prisma.exam.count({ where: { courseId: { in: courseIds } } }),
    prisma.examAttempt.count({ where: { exam: { courseId: { in: courseIds } } } }),
    prisma.question.count({ where: { courseId: { in: courseIds }, isLatest: true, isArchived: false } }),
    prisma.grade.findMany({
      where: { attempt: { exam: { courseId: { in: courseIds }, resultsPublished: true } } },
      select: { percentage: true, letter: true, attempt: { select: { exam: { select: { course: { select: { code: true } } } } } } },
    }),
    prisma.exam.groupBy({ by: ['status'], where: { courseId: { in: courseIds } }, _count: { _all: true } }),
    prisma.exam.count({ where: { courseId: { in: courseIds }, status: 'PENDING_APPROVAL' } }),
    prisma.answer.count({ where: { status: 'NEEDS_REVIEW', attemptQuestion: { attempt: { exam: { courseId: { in: courseIds } } } } } }),
  ]);

  // Chart 1: average published score per course
  const perCourse = new Map<string, number[]>();
  grades.forEach((g) => {
    const code = g.attempt.exam.course.code;
    perCourse.set(code, [...(perCourse.get(code) ?? []), g.percentage]);
  });
  const averageByCourse = [...perCourse.entries()]
    .map(([course, list]) => ({ course, average: Math.round((list.reduce((s, x) => s + x, 0) / list.length) * 10) / 10, results: list.length }))
    .sort((a, b) => a.course.localeCompare(b.course));

  // Chart 2: grade letter distribution
  const scale = await prisma.gradeScale.findMany({ orderBy: { minPercent: 'desc' } });
  const gradeDistribution = scale.map((s) => ({ letter: s.letter, count: grades.filter((g) => g.letter === s.letter).length }));

  // Chart 3: tab-switch flags per exam (most recent 8 exams with attempts)
  const recent = await prisma.exam.findMany({
    where: { courseId: { in: courseIds }, attempts: { some: {} } },
    orderBy: { windowStart: 'desc' },
    take: 8,
    select: { title: true, course: { select: { code: true } }, attempts: { select: { _count: { select: { focusEvents: { where: { counted: true } } } } } } },
  });
  const focusByExam = recent.map((e) => ({
    exam: `${e.course.code}`,
    title: e.title,
    attempts: e.attempts.length,
    flagged: e.attempts.filter((a) => a._count.focusEvents >= 3).length,
  }));

  return {
    totals: { courses: courses.length, students: students.length, exams, attempts, questions, pendingApprovals, needsReview, publishedResults: grades.length },
    averageByCourse,
    gradeDistribution,
    examStatus: examStatus.map((s) => ({ status: s.status, count: s._count._all })),
    focusByExam,
  };
}
