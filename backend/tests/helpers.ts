/**
 * Integration test helpers: a small, deterministic dataset and login helper.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';
import { createApp } from '../src/app';

export const app = createApp();
export const PASSWORD = 'Test@1234';
const MINUTE = 60_000;

/** Empties every table (fast, keeps the schema). */
export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function login(identifier: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ identifier, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${identifier}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token as string;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function q(courseId: string, authorId: string, difficulty: 'EASY' | 'MEDIUM' | 'HARD', topic: string, i: number) {
  const created = await prisma.question.create({
    data: {
      rootId: 'x',
      courseId,
      createdById: authorId,
      type: 'MCQ',
      text: `${difficulty} ${topic} question number ${i}?`,
      marks: difficulty === 'HARD' ? 3 : 2,
      topic,
      difficulty,
      options: {
        create: [0, 1, 2, 3].map((k) => ({ text: `Option ${k} of ${difficulty}-${i}`, isCorrect: k === 0, position: k })),
      },
    },
  });
  return prisma.question.update({ where: { id: created.id }, data: { rootId: created.id } });
}

/**
 * Creates: grade scale, admin, 2 lecturers, 2 invigilators, 3 students (s1, s2 enrolled in C1; s3 not),
 * course C1 (lecturer1) with a bank of 8 EASY / 6 MEDIUM / 3 HARD MCQs, a "Writing" topic with
 * one short answer + one essay, and:
 *   openExam  - SCHEDULED, open now, 40 min, rules E3 M2 H1, invigilator inv1
 *   writtenExam - SCHEDULED, open now, short answer + essay only
 */
export async function fixture() {
  await resetDb();
  const hash = await bcrypt.hash(PASSWORD, 4);
  await prisma.gradeScale.createMany({
    data: [
      { letter: 'A', minPercent: 90, points: 4 },
      { letter: 'B', minPercent: 80, points: 3 },
      { letter: 'C', minPercent: 70, points: 2 },
      { letter: 'D', minPercent: 60, points: 1 },
      { letter: 'F', minPercent: 0, points: 0 },
    ],
  });
  const mk = (username: string, role: 'ADMIN' | 'LECTURER' | 'STUDENT' | 'INVIGILATOR', fullName: string, studentId?: string) =>
    prisma.user.create({ data: { username, role, fullName, passwordHash: hash, studentId, phone: '+252615550000' } });
  const admin = await mk('admin', 'ADMIN', 'Hodan Warsame');
  const lecturer1 = await mk('lec1', 'LECTURER', 'Dr. Abdirahman Farah');
  const lecturer2 = await mk('lec2', 'LECTURER', 'Dr. Ifrah Hassan');
  const inv1 = await mk('inv1', 'INVIGILATOR', 'Mohamed Jama');
  const inv2 = await mk('inv2', 'INVIGILATOR', 'Sahra Ahmed');
  const s1 = await mk('t-001', 'STUDENT', 'Amina Abdi', 'T-001');
  const s2 = await mk('t-002', 'STUDENT', 'Abdullahi Warsame', 'T-002');
  const s3 = await mk('t-003', 'STUDENT', 'Hassan Elmi', 'T-003');

  const faculty = await prisma.faculty.create({ data: { code: 'FCIT', name: 'Computing' } });
  const c1 = await prisma.course.create({ data: { code: 'CS101', name: 'Intro to Computing', semester: 'Fall 2026', facultyId: faculty.id, lecturerId: lecturer1.id } });
  const c2 = await prisma.course.create({ data: { code: 'BA110', name: 'Accounting', semester: 'Fall 2026', facultyId: faculty.id, lecturerId: lecturer2.id } });
  await prisma.enrolment.createMany({ data: [s1, s2].map((s) => ({ courseId: c1.id, studentId: s.id })) });

  for (let i = 0; i < 8; i++) await q(c1.id, lecturer1.id, 'EASY', 'Hardware', i);
  for (let i = 0; i < 6; i++) await q(c1.id, lecturer1.id, 'MEDIUM', 'Networking', i);
  for (let i = 0; i < 3; i++) await q(c1.id, lecturer1.id, 'HARD', 'Security', i);

  const shortQ = await prisma.question.create({
    data: { rootId: 'x', courseId: c1.id, createdById: lecturer1.id, type: 'SHORT_ANSWER', text: 'Which protocol sends email?', marks: 2, topic: 'Writing', difficulty: 'MEDIUM', acceptedAnswers: ['SMTP'] },
  });
  await prisma.question.update({ where: { id: shortQ.id }, data: { rootId: shortQ.id } });
  const essayQ = await prisma.question.create({
    data: {
      rootId: 'x', courseId: c1.id, createdById: lecturer1.id, type: 'ESSAY', text: 'Explain how a LAN helps a hospital.', marks: 10, topic: 'Writing', difficulty: 'HARD',
      rubric: [{ criterion: 'Content', points: 6 }, { criterion: 'Clarity', points: 4 }],
    },
  });
  await prisma.question.update({ where: { id: essayQ.id }, data: { rootId: essayQ.id } });

  const now = Date.now();
  const openExam = await prisma.exam.create({
    data: {
      courseId: c1.id, title: 'Midterm', status: 'SCHEDULED', windowStart: new Date(now - 10 * MINUTE), windowEnd: new Date(now + 3 * 60 * MINUTE),
      durationMinutes: 40, allowedNetworks: ['127.0.0.1'], createdById: lecturer1.id,
      rules: { create: [{ difficulty: 'EASY', count: 3, topics: [] }, { difficulty: 'MEDIUM', count: 2, topics: ['Networking'] }, { difficulty: 'HARD', count: 1, topics: ['Security'] }] },
      invigilators: { create: [{ userId: inv1.id }] },
    },
  });
  const writtenExam = await prisma.exam.create({
    data: {
      courseId: c1.id, title: 'Written test', status: 'SCHEDULED', windowStart: new Date(now - 10 * MINUTE), windowEnd: new Date(now + 3 * 60 * MINUTE),
      durationMinutes: 30, createdById: lecturer1.id,
      rules: { create: [{ difficulty: 'MEDIUM', count: 1, topics: ['Writing'] }, { difficulty: 'HARD', count: 1, topics: ['Writing'] }] },
    },
  });
  return { admin, lecturer1, lecturer2, inv1, inv2, s1, s2, s3, c1, c2, openExam, writtenExam, shortQ, essayQ };
}
