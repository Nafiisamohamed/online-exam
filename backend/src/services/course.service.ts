/**
 * Courses and enrolment (Admin/Registrar).
 *
 * Rules enforced here:
 * - Course codes and student IDs are unique.
 * - Dropping a student only marks the enrolment DROPPED; attempts and grades stay,
 *   so past results are kept. A dropped student cannot start new exams.
 */
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { parseCsv } from '../lib/csv';
import { env } from '../config/env';
import { hashPassword } from './auth.service';
import { audit } from './audit.service';
import { sms } from '../adapters/sms';
import type { AuthUser } from '../middleware/auth';

// ---------- Faculties ----------

export const listFaculties = () =>
  prisma.faculty.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { courses: true } } } });

export async function createFaculty(actor: AuthUser, data: { code: string; name: string }) {
  const faculty = await prisma.faculty.create({ data: { code: data.code.toUpperCase(), name: data.name } });
  await audit({ userId: actor.id, action: 'FACULTY_CREATED', entity: 'Faculty', entityId: faculty.id, details: data });
  return faculty;
}

export async function updateFaculty(actor: AuthUser, id: string, data: { code?: string; name?: string }) {
  const faculty = await prisma.faculty.update({
    where: { id },
    data: { ...data, code: data.code?.toUpperCase() },
  });
  await audit({ userId: actor.id, action: 'FACULTY_UPDATED', entity: 'Faculty', entityId: id, details: data });
  return faculty;
}

// ---------- Courses ----------

/** Admin sees all courses; a lecturer sees only courses they teach; a student sees their enrolments. */
export async function listCourses(user: AuthUser) {
  const where =
    user.role === 'LECTURER'
      ? { lecturerId: user.id }
      : user.role === 'STUDENT'
        ? { enrolments: { some: { studentId: user.id, status: 'ACTIVE' as const } } }
        : {};
  return prisma.course.findMany({
    where,
    orderBy: { code: 'asc' },
    include: {
      faculty: { select: { id: true, name: true, code: true } },
      lecturer: { select: { id: true, fullName: true } },
      _count: { select: { enrolments: { where: { status: 'ACTIVE' } }, questions: { where: { isLatest: true, isArchived: false } }, exams: true } },
    },
  });
}

interface CourseInput {
  code: string;
  name: string;
  semester: string;
  facultyId: string;
  lecturerId?: string | null;
}

async function assertLecturer(lecturerId: string | null | undefined) {
  if (!lecturerId) return;
  const lec = await prisma.user.findFirst({ where: { id: lecturerId, role: 'LECTURER', isActive: true } });
  if (!lec) throw badRequest('INVALID_LECTURER', 'Selected lecturer does not exist');
}

export async function createCourse(actor: AuthUser, data: CourseInput) {
  await assertLecturer(data.lecturerId);
  const course = await prisma.course.create({ data: { ...data, code: data.code.toUpperCase() } });
  await audit({ userId: actor.id, action: 'COURSE_CREATED', entity: 'Course', entityId: course.id, details: { ...data } });
  return course;
}

export async function updateCourse(actor: AuthUser, id: string, data: Partial<CourseInput>) {
  await assertLecturer(data.lecturerId);
  const course = await prisma.course.update({
    where: { id },
    data: { ...data, code: data.code?.toUpperCase() },
  });
  await audit({ userId: actor.id, action: 'COURSE_UPDATED', entity: 'Course', entityId: id, details: { ...data } });
  return course;
}

/** Enrolments of a course (active and dropped), with student details. */
export async function listEnrolments(courseId: string) {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw notFound('Course');
  return prisma.enrolment.findMany({
    where: { courseId },
    orderBy: [{ status: 'asc' }, { student: { fullName: 'asc' } }],
    include: { student: { select: { id: true, fullName: true, studentId: true, phone: true } } },
  });
}

/** Enrols an existing student (re-activates a dropped enrolment). */
export async function enrolStudent(actor: AuthUser, courseId: string, studentUserId: string) {
  const student = await prisma.user.findFirst({ where: { id: studentUserId, role: 'STUDENT' } });
  if (!student) throw notFound('Student');
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw notFound('Course');
  const enrolment = await prisma.enrolment.upsert({
    where: { courseId_studentId: { courseId, studentId: studentUserId } },
    create: { courseId, studentId: studentUserId },
    update: { status: 'ACTIVE', droppedAt: null },
  });
  await audit({ userId: actor.id, action: 'STUDENT_ENROLLED', entity: 'Enrolment', entityId: enrolment.id, details: { course: course.code, student: student.studentId } });
  return enrolment;
}

/** Drops a student. Past attempts and grades are kept (status change only). */
export async function dropStudent(actor: AuthUser, courseId: string, studentUserId: string) {
  const enrolment = await prisma.enrolment.findUnique({ where: { courseId_studentId: { courseId, studentId: studentUserId } } });
  if (!enrolment) throw notFound('Enrolment');
  const updated = await prisma.enrolment.update({
    where: { id: enrolment.id },
    data: { status: 'DROPPED', droppedAt: new Date() },
  });
  await audit({ userId: actor.id, action: 'STUDENT_DROPPED', entity: 'Enrolment', entityId: enrolment.id });
  return updated;
}

// ---------- Students ----------

export async function listStudents(search?: string) {
  return prisma.user.findMany({
    where: {
      role: 'STUDENT',
      ...(search
        ? { OR: [{ fullName: { contains: search, mode: 'insensitive' } }, { studentId: { contains: search, mode: 'insensitive' } }] }
        : {}),
    },
    orderBy: { fullName: 'asc' },
    take: 300,
    select: {
      id: true,
      fullName: true,
      studentId: true,
      phone: true,
      isActive: true,
      enrolments: { where: { status: 'ACTIVE' }, select: { course: { select: { code: true } } } },
    },
  });
}

export interface StudentImportRow {
  line: number;
  studentId: string;
  name: string;
  phone: string;
  courseCodes: string[];
  status: 'NEW' | 'EXISTING' | 'ERROR';
  errors: string[];
}

const STUDENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9\-\/]{2,30}$/;
const PHONE_RE = /^\+?[0-9 ]{7,16}$/;

/**
 * Enrols students from CSV with columns: student_id, name, phone, course_codes
 * (course codes separated by ";" or "|").
 * @param dryRun true = only validate and return the preview
 * New students get an account (username = student ID, default password) and an SMS.
 */
export async function importStudents(actor: AuthUser, csv: string, dryRun: boolean) {
  const rows = parseCsv(csv);
  const courses = await prisma.course.findMany({ select: { id: true, code: true } });
  const courseByCode = new Map(courses.map((c) => [c.code.toUpperCase(), c.id]));
  const existing = await prisma.user.findMany({
    where: { studentId: { not: null } },
    select: { id: true, studentId: true, role: true },
  });
  const existingById = new Map(existing.map((u) => [u.studentId!.toUpperCase(), u]));
  const seen = new Set<string>();

  const report: StudentImportRow[] = rows.map(({ line, data }) => {
    const studentId = (data.student_id ?? data.studentid ?? data.id ?? '').trim();
    const name = (data.name ?? data.full_name ?? '').trim();
    const phone = (data.phone ?? '').trim();
    const courseCodes = (data.course_codes ?? data.courses ?? '')
      .split(/[;|]/)
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    const errors: string[] = [];
    if (!STUDENT_ID_RE.test(studentId)) errors.push('Invalid or missing student ID');
    if (name.length < 3) errors.push('Name is required');
    if (phone && !PHONE_RE.test(phone)) errors.push('Invalid phone number');
    if (courseCodes.length === 0) errors.push('At least one course code is required');
    courseCodes.filter((c) => !courseByCode.has(c)).forEach((c) => errors.push(`Unknown course code ${c}`));
    const key = studentId.toUpperCase();
    if (seen.has(key)) errors.push('Student ID repeated in this file');
    seen.add(key);
    const ex = existingById.get(key);
    if (ex && ex.role !== 'STUDENT') errors.push('ID belongs to a non-student account');
    return { line, studentId, name, phone, courseCodes, status: errors.length ? 'ERROR' : ex ? 'EXISTING' : 'NEW', errors };
  });

  const summary = {
    total: report.length,
    valid: report.filter((r) => r.status !== 'ERROR').length,
    errors: report.filter((r) => r.status === 'ERROR').length,
    created: 0,
    enrolments: 0,
  };
  if (dryRun) return { rows: report, summary };

  const passwordHash = await hashPassword(env.DEFAULT_STUDENT_PASSWORD);
  for (const row of report.filter((r) => r.status !== 'ERROR')) {
    let userId = existingById.get(row.studentId.toUpperCase())?.id;
    if (!userId) {
      const created = await prisma.user.create({
        data: {
          username: row.studentId.toLowerCase(),
          studentId: row.studentId.toUpperCase(),
          fullName: row.name,
          phone: row.phone || null,
          role: 'STUDENT',
          passwordHash,
        },
      });
      userId = created.id;
      summary.created++;
      if (row.phone) {
        await sms.send({
          to: row.phone,
          message: `Ku soo dhawoow Imtixaan. Aqoonsigaaga: ${created.studentId}. / Welcome to Imtixaan. Your login ID: ${created.studentId}.`,
        });
      }
    }
    for (const code of row.courseCodes) {
      const courseId = courseByCode.get(code)!;
      await prisma.enrolment.upsert({
        where: { courseId_studentId: { courseId, studentId: userId } },
        create: { courseId, studentId: userId },
        update: { status: 'ACTIVE', droppedAt: null },
      });
      summary.enrolments++;
    }
  }
  await audit({ userId: actor.id, action: 'STUDENTS_IMPORTED', entity: 'Enrolment', details: summary });
  return { rows: report, summary };
}

// ---------- Rooms ----------

export const listRooms = () => prisma.room.findMany({ orderBy: { name: 'asc' } });

export async function createRoom(actor: AuthUser, data: { name: string; building: string; capacity: number; network?: string | null }) {
  const room = await prisma.room.create({ data });
  await audit({ userId: actor.id, action: 'ROOM_CREATED', entity: 'Room', entityId: room.id, details: data });
  return room;
}

export async function updateRoom(actor: AuthUser, id: string, data: Partial<{ name: string; building: string; capacity: number; network: string | null }>) {
  const room = await prisma.room.update({ where: { id }, data });
  await audit({ userId: actor.id, action: 'ROOM_UPDATED', entity: 'Room', entityId: id, details: data });
  return room;
}

// ---------- Staff users ----------

export const listUsers = (role?: 'ADMIN' | 'LECTURER' | 'STUDENT' | 'INVIGILATOR') =>
  prisma.user.findMany({
    where: role ? { role } : {},
    orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
    take: 500,
    select: { id: true, username: true, fullName: true, role: true, phone: true, email: true, studentId: true, isActive: true, createdAt: true },
  });

export async function createUser(
  actor: AuthUser,
  data: { username: string; fullName: string; role: 'ADMIN' | 'LECTURER' | 'STUDENT' | 'INVIGILATOR'; password: string; phone?: string | null; email?: string | null; studentId?: string | null },
) {
  if (data.role === 'STUDENT' && !data.studentId) throw badRequest('STUDENT_ID_REQUIRED', 'Students need a student ID');
  const user = await prisma.user.create({
    data: {
      username: data.username.toLowerCase(),
      fullName: data.fullName,
      role: data.role,
      phone: data.phone || null,
      email: data.email || null,
      studentId: data.role === 'STUDENT' ? data.studentId!.toUpperCase() : null,
      passwordHash: await hashPassword(data.password),
    },
    select: { id: true, username: true, fullName: true, role: true, studentId: true },
  });
  await audit({ userId: actor.id, action: 'USER_CREATED', entity: 'User', entityId: user.id, details: { username: user.username, role: user.role } });
  return user;
}

export async function setUserActive(actor: AuthUser, id: string, isActive: boolean) {
  if (id === actor.id && !isActive) throw badRequest('CANNOT_DISABLE_SELF', 'You cannot disable your own account');
  const user = await prisma.user.update({ where: { id }, data: { isActive }, select: { id: true, isActive: true } });
  await audit({ userId: actor.id, action: isActive ? 'USER_ENABLED' : 'USER_DISABLED', entity: 'User', entityId: id });
  return user;
}
