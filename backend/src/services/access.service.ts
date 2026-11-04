/**
 * Ownership checks shared by services ("a lecturer sees only their own courses").
 *
 * Every function loads the record and throws 404 if missing or 403 if the user may
 * not touch it. Admins pass every course/exam check (registrar oversight).
 */
import { prisma } from '../lib/prisma';
import { forbidden, notFound } from '../lib/errors';
import type { AuthUser } from '../middleware/auth';

/** Course the user may manage (admin, or the course lecturer). */
export async function assertCourseAccess(user: AuthUser, courseId: string) {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw notFound('Course');
  if (user.role === 'ADMIN') return course;
  if (user.role === 'LECTURER' && course.lecturerId === user.id) return course;
  throw forbidden('This course belongs to another lecturer');
}

/** Exam the user may edit (admin or the course lecturer). */
export async function assertExamManage(user: AuthUser, examId: string) {
  const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { course: true } });
  if (!exam) throw notFound('Exam');
  if (user.role === 'ADMIN') return exam;
  if (user.role === 'LECTURER' && exam.course.lecturerId === user.id) return exam;
  throw forbidden('This exam belongs to another lecturer');
}

/** Exam the user may grade: course lecturer or the assigned second (blind) grader. */
export async function assertExamGrade(user: AuthUser, examId: string) {
  const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { course: true } });
  if (!exam) throw notFound('Exam');
  if (user.role === 'ADMIN') return { exam, blind: false };
  if (user.role === 'LECTURER' && exam.course.lecturerId === user.id) return { exam, blind: false };
  if (user.role === 'LECTURER' && exam.secondGraderId === user.id) return { exam, blind: true };
  throw forbidden('You are not a grader for this exam');
}

/** Exam the user may watch live: assigned invigilators, the course lecturer, admins. */
export async function assertExamInvigilate(user: AuthUser, examId: string) {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: { course: true, invigilators: true },
  });
  if (!exam) throw notFound('Exam');
  if (user.role === 'ADMIN') return exam;
  if (user.role === 'LECTURER' && exam.course.lecturerId === user.id) return exam;
  if (user.role === 'INVIGILATOR' && exam.invigilators.some((i) => i.userId === user.id)) return exam;
  throw forbidden('You are not assigned to invigilate this exam');
}
