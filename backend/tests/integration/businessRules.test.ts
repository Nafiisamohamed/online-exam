/**
 * Business rules through the API: permissions, enrolment, builder checks, scheduling
 * clashes, CSV import, question versioning, grading and publishing.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma';
import { app, auth, fixture, login } from '../helpers';

let f: Awaited<ReturnType<typeof fixture>>;
let lec1: string;

beforeAll(async () => {
  f = await fixture();
  lec1 = await login('lec1');
});

describe('authentication and server-side permissions', () => {
  it('rejects wrong passwords, missing tokens and invalid input', async () => {
    expect((await request(app).post('/api/auth/login').send({ identifier: 'lec1', password: 'wrong' })).status).toBe(401);
    expect((await request(app).get('/api/exams')).status).toBe(401);
    const bad = await request(app).post('/api/auth/login').send({ identifier: 'x' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('checks roles and ownership on every request', async () => {
    const student = await login('T-001');
    const lec2 = await login('lec2');
    expect((await request(app).get('/api/exams').set(auth(student))).status).toBe(403);
    expect((await request(app).get(`/api/courses/${f.c1.id}/questions`).set(auth(student))).status).toBe(403);
    // A lecturer only sees their own course's bank
    expect((await request(app).get(`/api/courses/${f.c1.id}/questions`).set(auth(lec2))).status).toBe(403);
    expect((await request(app).get(`/api/courses/${f.c1.id}/questions`).set(auth(lec1))).status).toBe(200);
    expect((await request(app).post('/api/courses').set(auth(lec1)).send({})).status).toBe(403);
  });

  it('lets students and invigilators reach their shared endpoints', async () => {
    const student = await login('T-001');
    const inv = await login('inv1');
    for (const token of [student, inv]) {
      expect((await request(app).get('/api/notifications').set(auth(token))).status).toBe(200);
      expect((await request(app).get('/api/payments/fees').set(auth(token))).status).toBe(200);
      expect((await request(app).get('/api/courses').set(auth(token))).status).toBe(200);
    }
    expect((await request(app).get('/api/student/exams').set(auth(student))).status).toBe(200);
  });
});

describe('enrolment and exam access', () => {
  it('only enrolled students can start; dropping keeps past results', async () => {
    const s3 = await login('T-003');
    const notEnrolled = await request(app).post(`/api/exams/${f.openExam.id}/start`).set(auth(s3));
    expect(notEnrolled.status).toBe(403);
    expect(notEnrolled.body.error.code).toBe('NOT_ENROLLED');

    const admin = await login('admin');
    const s1 = await login('T-001');
    const started = await request(app).post(`/api/exams/${f.writtenExam.id}/start`).set(auth(s1));
    expect(started.status).toBe(200);
    await request(app).post(`/api/attempts/${started.body.attemptId}/submit`).set(auth(s1));

    const drop = await request(app).delete(`/api/courses/${f.c1.id}/enrolments/${f.s1.id}`).set(auth(admin));
    expect(drop.status).toBe(200);
    expect(await prisma.examAttempt.count({ where: { id: started.body.attemptId } })).toBe(1);
    const blocked = await request(app).post(`/api/exams/${f.openExam.id}/start`).set(auth(s1));
    expect(blocked.body.error.code).toBe('NOT_ENROLLED');
    // re-enrol for later tests
    await request(app).post(`/api/courses/${f.c1.id}/enrolments`).set(auth(admin)).send({ studentUserId: f.s1.id });
  });

  it('blocks starting from a network outside the exam rooms', async () => {
    const exam = await prisma.exam.create({
      data: {
        courseId: f.c1.id, title: 'Lab only', status: 'SCHEDULED', windowStart: new Date(Date.now() - 60_000), windowEnd: new Date(Date.now() + 3_600_000),
        durationMinutes: 30, allowedNetworks: ['10.9.9.0/24'], createdById: f.lecturer1.id, rules: { create: [{ difficulty: 'EASY', count: 2, topics: [] }] },
      },
    });
    const s2 = await login('T-002');
    const res = await request(app).post(`/api/exams/${exam.id}/start`).set(auth(s2));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NETWORK_NOT_ALLOWED');
    await prisma.exam.delete({ where: { id: exam.id } });
  });
});

describe('exam builder and scheduling', () => {
  let draftId: string;

  it('blocks saving rules the bank cannot satisfy', async () => {
    const created = await request(app).post('/api/exams').set(auth(lec1)).send({ courseId: f.c1.id, title: 'Final exam', durationMinutes: 60 });
    expect(created.status).toBe(201);
    draftId = created.body.id;
    const bad = await request(app).put(`/api/exams/${draftId}/rules`).set(auth(lec1)).send({ rules: [{ difficulty: 'HARD', count: 9, topics: [] }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('RULES_NOT_FEASIBLE');
    const ok = await request(app).put(`/api/exams/${draftId}/rules`).set(auth(lec1)).send({ rules: [{ difficulty: 'EASY', count: 4, topics: ['Hardware'] }] });
    expect(ok.status).toBe(200);
    const preview = await request(app).post(`/api/exams/${draftId}/preview`).set(auth(lec1));
    expect(preview.body.questions).toHaveLength(4);
  });

  it('rejects a duration longer than the window and clashing schedules', async () => {
    const start = new Date(Date.now() + 30 * 60_000);
    const long = await request(app).post(`/api/exams/${draftId}/schedule`).set(auth(lec1)).send({
      windowStart: start, windowEnd: new Date(start.getTime() + 60 * 60_000), durationMinutes: 90,
    });
    expect(long.body.error.code).toBe('DURATION_EXCEEDS_WINDOW');
    // The open Midterm (same students) is running now -> clash
    const clash = await request(app).post(`/api/exams/${draftId}/schedule`).set(auth(lec1)).send({
      windowStart: start, windowEnd: new Date(start.getTime() + 120 * 60_000), durationMinutes: 60,
    });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('SCHEDULE_CLASH');
    // A free slot next week is accepted and waits for the admin
    const nextWeek = new Date(Date.now() + 7 * 24 * 3_600_000);
    const ok = await request(app).post(`/api/exams/${draftId}/schedule`).set(auth(lec1)).send({
      windowStart: nextWeek, windowEnd: new Date(nextWeek.getTime() + 120 * 60_000), durationMinutes: 60, invigilatorIds: [f.inv1.id],
    });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('PENDING_APPROVAL');
    const admin = await login('admin');
    const approved = await request(app).post(`/api/exams/${draftId}/approve`).set(auth(admin));
    expect(approved.body.status).toBe('SCHEDULED');
  });
});

describe('question bank', () => {
  it('previews a CSV import and saves only valid rows, skipping duplicates', async () => {
    const csv = [
      'type,text,option_a,option_b,option_c,option_d,option_e,correct,accepted_answers,marks,topic,difficulty,image_url',
      'MCQ,What does RAM stand for?,Random Access Memory,Read Any Memory,Run All Memory,Random Active Mode,,A,,2,Hardware,EASY,',
      'MCQ,Bad question with two options,Yes,No,,,,A,,2,Hardware,EASY,',
      'TRUE_FALSE,EASY Hardware question number 0?,,,,,,true,,1,Hardware,EASY,',
    ].join('\n');
    const preview = await request(app).post(`/api/courses/${f.c1.id}/questions/import`).set(auth(lec1)).send({ csv, dryRun: true });
    expect(preview.body.summary).toMatchObject({ total: 3, valid: 1, errors: 1, duplicates: 1, saved: 0 });
    expect(preview.body.rows[1].errors).toContain('MCQ_OPTION_COUNT');
    const commit = await request(app).post(`/api/courses/${f.c1.id}/questions/import`).set(auth(lec1)).send({ csv, dryRun: false });
    expect(commit.body.summary.saved).toBe(1);
    expect(await prisma.question.count({ where: { text: 'What does RAM stand for?' } })).toBe(1);
  });

  it('creates a new version when a question used in an exam is edited', async () => {
    const s2 = await login('T-002');
    const started = await request(app).post(`/api/exams/${f.openExam.id}/start`).set(auth(s2));
    const used = await prisma.attemptQuestion.findFirstOrThrow({
      include: { question: { include: { options: true } } },
      where: { attemptId: started.body.attemptId },
    });
    const old = used.question;
    const res = await request(app).put(`/api/questions/${old.id}`).set(auth(lec1)).send({
      type: 'MCQ', text: `${old.text} (edited)`, marks: old.marks, topic: old.topic, difficulty: old.difficulty,
      options: old.options.sort((a, b) => a.position - b.position).map((o) => ({ text: o.text, isCorrect: o.isCorrect })),
    });
    expect(res.status).toBe(200);
    expect(res.body.versioned).toBe(true);
    expect(res.body.version).toBe(2);
    const oldRow = await prisma.question.findUniqueOrThrow({ where: { id: old.id } });
    expect(oldRow).toMatchObject({ text: old.text, isLatest: false });
    // The past attempt still points to the old version
    expect((await prisma.attemptQuestion.findUniqueOrThrow({ where: { id: used.id } })).questionId).toBe(old.id);
  });
});

describe('grading and results', () => {
  it('needs review before publishing; unpublished results are hidden from students', async () => {
    const s2 = await login('T-002');
    const start = await request(app).post(`/api/exams/${f.writtenExam.id}/start`).set(auth(s2));
    const attemptId = start.body.attemptId;
    const paper = await request(app).get(`/api/attempts/${attemptId}`).set(auth(s2));
    for (const q of paper.body.questions) {
      const text = q.type === 'SHORT_ANSWER' ? 'the smtp protocol' : 'A LAN connects hospital computers so records can be shared.';
      await request(app).put(`/api/attempts/${attemptId}/answers`).set(auth(s2)).send({ attemptQuestionId: q.attemptQuestionId, textAnswer: text });
    }
    await request(app).post(`/api/attempts/${attemptId}/submit`).set(auth(s2));

    const blocked = await request(app).post(`/api/exams/${f.writtenExam.id}/publish`).set(auth(lec1));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('GRADING_INCOMPLETE');
    expect((await request(app).get(`/api/student/results/${attemptId}`).set(auth(s2))).status).toBe(404);

    const queue = await request(app).get(`/api/exams/${f.writtenExam.id}/grading`).set(auth(lec1));
    // s1's earlier submission was empty (0 marks, auto graded); s2 has 2 answers to review
    const mine = queue.body.items.filter((i: { attemptId: string }) => i.attemptId === attemptId);
    expect(mine).toHaveLength(2);
    for (const item of mine) {
      const body = item.question.type === 'ESSAY'
        ? { rubricScores: [{ criterion: 'Content', points: 6, awarded: 5 }, { criterion: 'Clarity', points: 4, awarded: 3 }], comment: 'Good' }
        : { awardedMarks: 2, comment: 'Accepted' };
      expect((await request(app).put(`/api/answers/${item.answerId}/grade`).set(auth(lec1)).send(body)).status).toBe(200);
    }
    const tooHigh = await request(app).put(`/api/answers/${mine[0].answerId}/grade`).set(auth(lec1)).send({ awardedMarks: 50 });
    expect(tooHigh.body.error.code).toBe('MARKS_OUT_OF_RANGE');

    const published = await request(app).post(`/api/exams/${f.writtenExam.id}/publish`).set(auth(lec1));
    expect(published.status).toBe(200);
    const result = await request(app).get(`/api/student/results/${attemptId}`).set(auth(s2));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ score: 10, maxScore: 12, letter: 'B' }); // 83.33%

    const analytics = await request(app).get(`/api/exams/${f.writtenExam.id}/analytics`).set(auth(lec1));
    expect(analytics.body.questions[0].enoughData).toBe(false); // fewer than 5 answers

    await request(app).post(`/api/exams/${f.writtenExam.id}/reopen`).set(auth(lec1)).send({ reason: 'Re-check essay' });
    expect((await request(app).get(`/api/student/results/${attemptId}`).set(auth(s2))).status).toBe(404);
  });
});
