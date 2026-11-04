/**
 * Database seed (run: npm run db:seed). WARNING: deletes all existing data first.
 *
 * Creates a realistic demo university (Mogadishu, Hargeisa and Garowe campuses):
 *  - 1 registrar/admin, 3 lecturers, 2 invigilators, 40 students (Somali names, phones)
 *  - 3 faculties, 5 courses, 4 rooms with campus network ranges, grade scale
 *  - question banks for 4 courses (MCQ, true/false, short answer, essay)
 *  - exams in every state:
 *      CS101 Midterm      - OPEN NOW (students take it in the demo)
 *      HS120 Rapid Quiz   - OPEN NOW, 3 minutes (demo of late answers being rejected)
 *      CS205 Final        - finished, graded and PUBLISHED (analytics demo)
 *      HS120 Quiz 1       - finished, essays waiting for grading (grading demo)
 *      BA110 Midterm      - PENDING_APPROVAL (admin approval demo)
 *      CS205 Quiz 2       - DRAFT with rules (exam builder demo)
 * Simulated attempts are generated with the same generator and grading code the app uses.
 */
import { PrismaClient, type Prisma, type Question, type QuestionOption } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomInt, randomUUID } from 'node:crypto';
import { validateQuestion } from '../src/core/questionRules';
import { drawQuestions, type RuleSpec } from '../src/core/examGenerator';
import { autoGrade, letterFor, percentage } from '../src/core/grading';
import { computeDeadline, MINUTE_MS } from '../src/core/timing';
import { shuffle } from '../src/lib/random';
import { BA110_QUESTIONS, CS101_QUESTIONS, CS205_QUESTIONS, ESSAY_ANSWERS, HS120_QUESTIONS, STUDENTS, type SeedQuestion } from './seed-data';

const prisma = new PrismaClient();
const DAY = 24 * 60 * MINUTE_MS;
const rand = () => randomInt(0, 1_000_000) / 1_000_000;

type BankQ = Question & { options: QuestionOption[]; p?: number };

async function wipe() {
  // Children first (foreign keys).
  await prisma.$transaction([
    prisma.grade.deleteMany(),
    prisma.answer.deleteMany(),
    prisma.focusEvent.deleteMany(),
    prisma.timeExtension.deleteMany(),
    prisma.invigilatorNote.deleteMany(),
    prisma.attemptQuestion.deleteMany(),
    prisma.examAttempt.deleteMany(),
    prisma.examRule.deleteMany(),
    prisma.examRoom.deleteMany(),
    prisma.examInvigilator.deleteMany(),
    prisma.exam.deleteMany(),
    prisma.questionOption.deleteMany(),
    prisma.question.deleteMany(),
    prisma.enrolment.deleteMany(),
    prisma.course.deleteMany(),
    prisma.faculty.deleteMany(),
    prisma.room.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.smsOutbox.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.gradeScale.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

/**
 * Inserts a course's questions with two batched queries (fast on a remote database such
 * as Supabase). IDs are generated here so options can reference their question.
 */
async function createQuestions(courseId: string, authorId: string, list: SeedQuestion[]): Promise<BankQ[]> {
  const out: BankQ[] = [];
  const questionRows: Prisma.QuestionCreateManyInput[] = [];
  const optionRows: Prisma.QuestionOptionCreateManyInput[] = [];
  const createdAt = new Date();
  for (const q of list) {
    const errors = validateQuestion(q);
    if (errors.length) throw new Error(`Invalid seed question "${q.text}": ${errors.join(', ')}`);
    const id = randomUUID();
    const options = (q.options ?? []).map((o, i) => ({ id: randomUUID(), questionId: id, text: o.text, isCorrect: o.isCorrect, position: i }));
    questionRows.push({
      id,
      rootId: id,
      courseId,
      createdById: authorId,
      type: q.type,
      text: q.text,
      marks: q.marks,
      topic: q.topic,
      difficulty: q.difficulty,
      acceptedAnswers: q.acceptedAnswers ?? [],
      rubric: q.rubric ? (q.rubric as object[]) : undefined,
      createdAt,
    });
    optionRows.push(...options);
    out.push({
      id, rootId: id, version: 1, isLatest: true, isArchived: false, courseId, createdById: authorId, createdAt,
      type: q.type, text: q.text, imageUrl: null, marks: q.marks, topic: q.topic, difficulty: q.difficulty,
      acceptedAnswers: q.acceptedAnswers ?? [], rubric: (q.rubric ?? null) as Prisma.JsonValue, options, p: q.p,
    });
  }
  await prisma.question.createMany({ data: questionRows });
  await prisma.questionOption.createMany({ data: optionRows });
  return out;
}

interface SimOptions {
  examId: string;
  studentId: string;
  rules: RuleSpec[];
  bank: BankQ[];
  durationMinutes: number;
  windowStart: Date;
  windowEnd: Date;
  ability: number; // 0..1
  gradeManually: boolean; // true = lecturer already graded essays/reviews
  graderId: string;
  tabSwitches: number;
}

const DIFF_FACTOR = { EASY: 1, MEDIUM: 0.8, HARD: 0.55 } as const;

/** Simulates one finished attempt, auto-grades it, and optionally applies manual grades. */
async function simulateAttempt(o: SimOptions) {
  const picked = shuffle(drawQuestions(o.rules, o.bank));
  const startedAt = new Date(o.windowStart.getTime() + randomInt(0, 15) * MINUTE_MS);
  const deadlineAt = computeDeadline(startedAt, o.durationMinutes, o.windowEnd);
  const used = Math.max(10, Math.floor(o.durationMinutes * (0.55 + rand() * 0.4)));
  const submittedAt = new Date(Math.min(startedAt.getTime() + used * MINUTE_MS, deadlineAt.getTime()));
  const auto = submittedAt.getTime() === deadlineAt.getTime();
  const attemptId = randomUUID();
  const maxScore = picked.reduce((s, q) => s + q.marks, 0);
  // Built in memory, then written with a few batched queries (see the end of this function).
  const paper: Prisma.AttemptQuestionCreateManyInput[] = [];
  const answers: Prisma.AnswerCreateManyInput[] = [];

  let score = 0;
  let pending = false;
  for (let i = 0; i < picked.length; i++) {
    const q = picked[i];
    const order = q.type === 'MCQ' ? shuffle(q.options) : q.options;
    const aq = { id: randomUUID() };
    paper.push({ id: aq.id, attemptId, questionId: q.id, position: i + 1, marks: q.marks, optionOrder: order.map((x) => x.id) });
    const pCorrect = q.p ?? Math.min(0.97, o.ability * DIFF_FACTOR[q.difficulty] + 0.1);
    const correct = rand() < pCorrect;
    let selectedOptionId: string | null = null;
    let textAnswer: string | null = null;
    if (q.type === 'MCQ' || q.type === 'TRUE_FALSE') {
      const right = q.options.find((x) => x.isCorrect)!;
      const wrong = q.options.filter((x) => !x.isCorrect);
      selectedOptionId = correct ? right.id : wrong[randomInt(0, wrong.length)].id;
    } else if (q.type === 'SHORT_ANSWER') {
      const r = rand();
      if (correct) textAnswer = r < 0.5 ? q.acceptedAnswers[0] : `  ${q.acceptedAnswers[0].toUpperCase()} `;
      else textAnswer = r < 0.3 ? '' : r < 0.6 ? `${q.acceptedAnswers[0]} protocol` : 'I am not sure';
    } else {
      textAnswer = rand() < 0.92 ? ESSAY_ANSWERS[randomInt(0, ESSAY_ANSWERS.length)] : '';
    }

    const graded = autoGrade(
      { type: q.type, marks: q.marks, acceptedAnswers: q.acceptedAnswers, options: q.options },
      { selectedOptionId, textAnswer },
    );
    let status: 'AUTO_GRADED' | 'NEEDS_REVIEW' | 'MANUALLY_GRADED' = graded.status;
    let awarded = graded.awardedMarks;
    let rubricScores: object[] | undefined;
    let comment: string | null = null;
    if (graded.status === 'NEEDS_REVIEW' && o.gradeManually) {
      status = 'MANUALLY_GRADED';
      if (q.type === 'ESSAY') {
        const rubric = (q.rubric as { criterion: string; points: number }[] | null) ?? [{ criterion: 'Overall', points: q.marks }];
        rubricScores = rubric.map((c) => ({ ...c, awarded: Math.round(c.points * Math.min(1, o.ability * 0.8 + rand() * 0.35) * 2) / 2 }));
        awarded = (rubricScores as { awarded: number }[]).reduce((s, c) => s + c.awarded, 0);
        comment = awarded >= q.marks * 0.7 ? 'Good, well explained answer.' : 'Needs more detail and examples.';
      } else {
        awarded = textAnswer?.toLowerCase().includes(q.acceptedAnswers[0].toLowerCase()) ? q.marks : 0;
        comment = awarded ? 'Accepted after review.' : 'Not correct.';
      }
    }
    if (status === 'NEEDS_REVIEW') pending = true;
    score += awarded ?? 0;
    answers.push({
      attemptQuestionId: aq.id,
      selectedOptionId,
      textAnswer,
      savedAt: new Date(startedAt.getTime() + (i + 1) * 2 * MINUTE_MS),
      status,
      awardedMarks: awarded,
      rubricScores: rubricScores ?? undefined,
      comment,
      gradedById: status === 'MANUALLY_GRADED' ? o.graderId : null,
      gradedAt: status === 'MANUALLY_GRADED' ? new Date(submittedAt.getTime() + DAY) : null,
    });
  }

  const focus: Prisma.FocusEventCreateManyInput[] = [];
  for (let k = 0; k < o.tabSwitches; k++) {
    const lostAt = new Date(startedAt.getTime() + randomInt(2, Math.max(3, used - 1)) * MINUTE_MS);
    const durationMs = k === 0 && o.tabSwitches > 1 ? 600 : randomInt(2000, 45000);
    focus.push({ attemptId, lostAt, regainedAt: new Date(lostAt.getTime() + durationMs), durationMs, counted: durationMs >= 1000 });
  }

  await prisma.examAttempt.create({
    data: {
      id: attemptId,
      examId: o.examId,
      studentId: o.studentId,
      status: auto ? 'AUTO_SUBMITTED' : 'SUBMITTED',
      startedAt,
      deadlineAt,
      submittedAt,
      lastSeenAt: submittedAt,
      ipAddress: `192.168.10.${randomInt(10, 200)}`,
      maxScore,
      score: Math.round(score * 100) / 100,
      gradingStatus: pending ? 'NEEDS_REVIEW' : 'GRADED',
    },
  });
  await prisma.attemptQuestion.createMany({ data: paper });
  await prisma.answer.createMany({ data: answers });
  if (focus.length) await prisma.focusEvent.createMany({ data: focus });
  return { attemptId, score, maxScore };
}

/** Today at hh:mm in Mogadishu time (UTC+3) + dayOffset days. */
function eatTime(dayOffset: number, hh: number, mm = 0): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset, hh - 3, mm));
  return d;
}

async function main() {
  console.log('Seeding Imtixaan demo data...');
  await wipe();

  await prisma.gradeScale.createMany({
    data: [
      { letter: 'A', minPercent: 90, points: 4 },
      { letter: 'B', minPercent: 80, points: 3 },
      { letter: 'C', minPercent: 70, points: 2 },
      { letter: 'D', minPercent: 60, points: 1 },
      { letter: 'F', minPercent: 0, points: 0 },
    ],
  });

  const [adminHash, lecHash, invHash, stuHash] = await Promise.all([
    bcrypt.hash('Admin@123', 10),
    bcrypt.hash('Lecturer@123', 10),
    bcrypt.hash('Invigilator@123', 10),
    bcrypt.hash('Student@123', 10),
  ]);

  const admin = await prisma.user.create({
    data: { username: 'admin', fullName: 'Hodan Warsame Abdi', role: 'ADMIN', phone: '+252615000001', email: 'registrar@imtixaan.demo', passwordHash: adminHash },
  });
  const drAbdirahman = await prisma.user.create({
    data: { username: 'abdirahman', fullName: 'Dr. Abdirahman Farah Ali', role: 'LECTURER', phone: '+252615000010', email: 'a.farah@imtixaan.demo', passwordHash: lecHash },
  });
  const drIfrah = await prisma.user.create({
    data: { username: 'ifrah', fullName: 'Dr. Ifrah Mohamed Hassan', role: 'LECTURER', phone: '+252634000011', email: 'i.hassan@imtixaan.demo', passwordHash: lecHash },
  });
  const drYusuf = await prisma.user.create({
    data: { username: 'yusuf', fullName: 'Dr. Yusuf Abdullahi Nur', role: 'LECTURER', phone: '+252907000012', email: 'y.nur@imtixaan.demo', passwordHash: lecHash },
  });
  const invMohamed = await prisma.user.create({
    data: { username: 'mohamed.jama', fullName: 'Mohamed Jama Osman', role: 'INVIGILATOR', phone: '+252615000020', passwordHash: invHash },
  });
  const invSahra = await prisma.user.create({
    data: { username: 'sahra.ahmed', fullName: 'Sahra Ahmed Yusuf', role: 'INVIGILATOR', phone: '+252634000021', passwordHash: invHash },
  });

  const students: { id: string; phone: string | null; studentId: string | null }[] = [];
  const studentRows = STUDENTS.map(([fullName, phone], i) => {
    const sid = `JB-24-${String(i + 1).padStart(3, '0')}`;
    return { id: randomUUID(), username: sid.toLowerCase(), studentId: sid, fullName, phone, role: 'STUDENT' as const, passwordHash: stuHash };
  });
  await prisma.user.createMany({ data: studentRows });
  students.push(...studentRows);

  const fcit = await prisma.faculty.create({ data: { code: 'FCIT', name: 'Faculty of Computing and Information Technology' } });
  const fba = await prisma.faculty.create({ data: { code: 'FBA', name: 'Faculty of Business and Accounting' } });
  const fhs = await prisma.faculty.create({ data: { code: 'FHS', name: 'Faculty of Health Sciences' } });

  const labA = await prisma.room.create({ data: { name: 'Lab A', building: 'Mogadishu Campus - Hodan, ICT Block', capacity: 40, network: '192.168.10.0/24' } });
  const labB = await prisma.room.create({ data: { name: 'Lab B', building: 'Mogadishu Campus - Hodan, ICT Block', capacity: 35, network: '192.168.20.0/24' } });
  await prisma.room.create({ data: { name: 'Hall 3', building: 'Hargeisa Campus - Main Building', capacity: 60, network: '10.10.3.0/24' } });
  const garowe = await prisma.room.create({ data: { name: 'Room G2', building: 'Garowe Campus - Health Sciences', capacity: 30, network: '172.16.2.0/24' } });

  const semester = 'Fall 2026';
  const cs101 = await prisma.course.create({ data: { code: 'CS101', name: 'Introduction to Computing', semester, facultyId: fcit.id, lecturerId: drAbdirahman.id } });
  const cs205 = await prisma.course.create({ data: { code: 'CS205', name: 'Database Systems', semester, facultyId: fcit.id, lecturerId: drAbdirahman.id } });
  const ba110 = await prisma.course.create({ data: { code: 'BA110', name: 'Principles of Accounting', semester, facultyId: fba.id, lecturerId: drIfrah.id } });
  const hs120 = await prisma.course.create({ data: { code: 'HS120', name: 'Public Health Basics', semester, facultyId: fhs.id, lecturerId: drYusuf.id } });
  await prisma.course.create({ data: { code: 'CS310', name: 'Computer Networks', semester: 'Spring 2027', facultyId: fcit.id, lecturerId: drAbdirahman.id } });

  const enrol = (courseId: string, from: number, to: number) =>
    prisma.enrolment.createMany({ data: students.slice(from, to).map((s) => ({ courseId, studentId: s.id })) });
  await enrol(cs101.id, 0, 25); // JB-24-001 .. 025
  await enrol(cs205.id, 0, 20); // JB-24-001 .. 020
  await enrol(ba110.id, 9, 30); // JB-24-010 .. 030
  await enrol(hs120.id, 25, 37); // JB-24-026 .. 037 (no overlap with CS101 => no clash)
  // One CS205 student dropped after the final: their result is kept.
  await prisma.enrolment.update({
    where: { courseId_studentId: { courseId: cs205.id, studentId: students[19].id } },
    data: { status: 'DROPPED', droppedAt: new Date(Date.now() - 2 * DAY) },
  });

  const bankCS101 = await createQuestions(cs101.id, drAbdirahman.id, CS101_QUESTIONS);
  const bankCS205 = await createQuestions(cs205.id, drAbdirahman.id, CS205_QUESTIONS);
  const bankHS120 = await createQuestions(hs120.id, drYusuf.id, HS120_QUESTIONS);
  await createQuestions(ba110.id, drIfrah.id, BA110_QUESTIONS);

  const campusNetworks = ['127.0.0.1', '192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12'];
  const now = Date.now();

  // ----- CS101 Midterm: open now -----
  const midtermRules: RuleSpec[] = [
    { difficulty: 'EASY', count: 6, topics: [] },
    { difficulty: 'MEDIUM', count: 4, topics: ['Networking', 'Security', 'Software'] },
    { difficulty: 'HARD', count: 2, topics: [] },
  ];
  await prisma.exam.create({
    data: {
      courseId: cs101.id,
      title: 'Midterm Exam',
      instructions: 'Answer all questions. Your answers are saved automatically. Do not leave this tab: every switch is recorded. / Ka jawaab dhammaan su\'aalaha. Jawaabahaaga si toos ah ayaa loo kaydiyaa. Ha ka bixin bogga.',
      status: 'SCHEDULED',
      windowStart: new Date(now - 30 * MINUTE_MS),
      windowEnd: new Date(now + 6 * 60 * MINUTE_MS),
      durationMinutes: 40,
      allowedNetworks: campusNetworks,
      createdById: drAbdirahman.id,
      rules: { create: midtermRules },
      rooms: { create: [{ roomId: labA.id }, { roomId: labB.id }] },
      invigilators: { create: [{ userId: invMohamed.id }] },
    },
  });

  // ----- HS120 Rapid Quiz: open now, 3 minutes -----
  await prisma.exam.create({
    data: {
      courseId: hs120.id,
      title: 'Rapid Quiz (3 minutes)',
      instructions: 'A short timed quiz. / Imtixaan gaaban oo waqti xaddidan leh.',
      status: 'SCHEDULED',
      windowStart: new Date(now - 10 * MINUTE_MS),
      windowEnd: new Date(now + 6 * 60 * MINUTE_MS),
      durationMinutes: 3,
      allowedNetworks: campusNetworks,
      createdById: drYusuf.id,
      rules: { create: [{ difficulty: 'EASY', count: 3, topics: [] }, { difficulty: 'MEDIUM', count: 2, topics: [] }] },
      rooms: { create: [{ roomId: garowe.id }] },
      invigilators: { create: [{ userId: invSahra.id }, { userId: invMohamed.id }] },
    },
  });

  // ----- CS205 Final: finished and published -----
  const finalRules: RuleSpec[] = [
    { difficulty: 'EASY', count: 5, topics: [] },
    { difficulty: 'MEDIUM', count: 5, topics: [] },
    { difficulty: 'HARD', count: 2, topics: [] },
  ];
  const finalStart = eatTime(-12, 9);
  const finalEnd = eatTime(-12, 11);
  const finalExam = await prisma.exam.create({
    data: {
      courseId: cs205.id,
      title: 'Final Exam',
      instructions: 'Closed book. 90 minutes.',
      status: 'SCHEDULED',
      windowStart: finalStart,
      windowEnd: finalEnd,
      durationMinutes: 90,
      allowedNetworks: campusNetworks,
      createdById: drAbdirahman.id,
      resultsPublished: true,
      publishedAt: eatTime(-8, 14),
      rules: { create: finalRules },
      rooms: { create: [{ roomId: labA.id }] },
      invigilators: { create: [{ userId: invMohamed.id }] },
    },
  });
  const scale = await prisma.gradeScale.findMany();
  for (let i = 0; i < 20; i++) {
    const r = await simulateAttempt({
      examId: finalExam.id, studentId: students[i].id, rules: finalRules, bank: bankCS205, durationMinutes: 90,
      windowStart: finalStart, windowEnd: finalEnd, ability: 0.35 + rand() * 0.6, gradeManually: true, graderId: drAbdirahman.id,
      tabSwitches: i % 7 === 3 ? 4 : i % 5 === 0 ? 1 : 0,
    });
    const pct = percentage(r.score, r.maxScore);
    await prisma.grade.create({ data: { attemptId: r.attemptId, score: Math.round(r.score * 100) / 100, maxScore: r.maxScore, percentage: pct, letter: letterFor(pct, scale), publishedAt: eatTime(-8, 14) } });
  }

  // ----- HS120 Quiz 1: finished, essays waiting -----
  const quizRules: RuleSpec[] = [
    { difficulty: 'EASY', count: 4, topics: [] },
    { difficulty: 'MEDIUM', count: 3, topics: [] },
    { difficulty: 'HARD', count: 2, topics: [] },
  ];
  const quizStart = eatTime(-3, 10);
  const quizEnd = eatTime(-3, 11);
  const quiz = await prisma.exam.create({
    data: {
      courseId: hs120.id,
      title: 'Quiz 1',
      instructions: 'Answer every question. Essays are marked with a rubric.',
      status: 'SCHEDULED',
      windowStart: quizStart,
      windowEnd: quizEnd,
      durationMinutes: 45,
      allowedNetworks: campusNetworks,
      createdById: drYusuf.id,
      secondGraderId: drAbdirahman.id,
      rules: { create: quizRules },
      rooms: { create: [{ roomId: garowe.id }] },
      invigilators: { create: [{ userId: invSahra.id }] },
    },
  });
  for (let i = 25; i < 35; i++) {
    await simulateAttempt({
      examId: quiz.id, studentId: students[i].id, rules: quizRules, bank: bankHS120, durationMinutes: 45,
      windowStart: quizStart, windowEnd: quizEnd, ability: 0.4 + rand() * 0.55, gradeManually: false, graderId: drYusuf.id,
      tabSwitches: i === 27 ? 5 : i === 30 ? 2 : 0,
    });
  }

  // ----- BA110 Midterm: waiting for admin approval -----
  await prisma.exam.create({
    data: {
      courseId: ba110.id,
      title: 'Midterm Exam',
      instructions: 'Calculators allowed. Show your working in essay answers.',
      status: 'PENDING_APPROVAL',
      windowStart: eatTime(7, 9),
      windowEnd: eatTime(7, 11),
      durationMinutes: 60,
      allowedNetworks: campusNetworks,
      createdById: drIfrah.id,
      rules: { create: [{ difficulty: 'EASY', count: 4, topics: [] }, { difficulty: 'MEDIUM', count: 3, topics: [] }, { difficulty: 'HARD', count: 2, topics: [] }] },
      rooms: { create: [{ roomId: labB.id }] },
      invigilators: { create: [{ userId: invMohamed.id }] },
    },
  });

  // ----- CS205 Quiz 2: draft in the builder -----
  await prisma.exam.create({
    data: {
      courseId: cs205.id,
      title: 'Quiz 2 - SQL',
      instructions: 'Short SQL quiz.',
      status: 'DRAFT',
      durationMinutes: 20,
      createdById: drAbdirahman.id,
      rules: { create: [{ difficulty: 'EASY', count: 3, topics: ['SQL'] }, { difficulty: 'MEDIUM', count: 2, topics: ['SQL'] }] },
    },
  });

  // ----- Notifications, SMS outbox, payments -----
  await prisma.notification.createMany({
    data: students.slice(0, 20).map((s) => ({
      userId: s.id,
      title: 'Results published: Final Exam',
      titleSo: 'Natiijada waa la daabacay: Final Exam',
      body: 'Your CS205 result is ready on Imtixaan.',
      bodySo: 'Natiijadaada CS205 waa diyaar Imtixaan.',
      createdAt: eatTime(-8, 14),
    })),
  });
  await prisma.smsOutbox.createMany({
    data: students.slice(0, 5).map((s) => ({
      toPhone: s.phone!,
      message: 'Natiijadaada CS205 waa diyaar Imtixaan. / Your CS205 result is ready on Imtixaan.',
      provider: 'outbox',
      status: 'SENT',
      createdAt: eatTime(-8, 14),
    })),
  });
  await prisma.payment.create({
    data: { userId: students[4].id, provider: 'EVC_PLUS', phone: students[4].phone!, amount: 5, purpose: 'REMARK_REQUEST', reference: 'EVC-SEED-0001', status: 'SUCCESS', createdAt: eatTime(-6, 12) },
  });
  await prisma.payment.create({
    data: { userId: students[9].id, provider: 'ZAAD', phone: students[9].phone!, amount: 10, purpose: 'RESIT_EXAM', reference: 'ZAD-SEED-0002', status: 'SUCCESS', createdAt: eatTime(-5, 9) },
  });
  await prisma.auditLog.create({ data: { userId: admin.id, action: 'DATABASE_SEEDED', entity: 'System', details: { students: students.length } } });

  console.log('Done. Demo accounts:');
  console.log('  Admin/Registrar : admin / Admin@123');
  console.log('  Lecturer        : abdirahman / Lecturer@123   (also: yusuf, ifrah)');
  console.log('  Invigilator     : mohamed.jama / Invigilator@123   (also: sahra.ahmed)');
  console.log('  Students        : JB-24-001 and JB-24-002 / Student@123  (CS101 Midterm open now)');
  console.log('  Student (quiz)  : JB-24-026 / Student@123  (HS120 Rapid Quiz, 3 min)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
