/**
 * End-to-end tests of the core technical challenge through the HTTP API and a real
 * PostgreSQL database:
 *  1. Two students in the same exam get different question sets of equal difficulty.
 *  2. Answers submitted after the server time limit are rejected.
 *  3. A student who reloads resumes with saved answers and the correct remaining time.
 * Plus tab-switch counting, invigilator view and time extensions.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma';
import { difficultyProfile, setKey } from '../../src/core/examGenerator';
import { app, auth, fixture, login } from '../helpers';

let f: Awaited<ReturnType<typeof fixture>>;
let tokenS1: string;
let tokenS2: string;
let attempt1: string;
let attempt2: string;

beforeAll(async () => {
  f = await fixture();
  tokenS1 = await login('T-001');
  tokenS2 = await login('t-002');
});

async function paperOf(attemptId: string) {
  return prisma.attemptQuestion.findMany({ where: { attemptId }, include: { question: true }, orderBy: { position: 'asc' } });
}

describe('core challenge: fair randomised exams', () => {
  it('gives two students different question sets of equal difficulty', async () => {
    const r1 = await request(app).post(`/api/exams/${f.openExam.id}/start`).set(auth(tokenS1));
    const r2 = await request(app).post(`/api/exams/${f.openExam.id}/start`).set(auth(tokenS2));
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    attempt1 = r1.body.attemptId;
    attempt2 = r2.body.attemptId;

    const p1 = await paperOf(attempt1);
    const p2 = await paperOf(attempt2);
    expect(p1).toHaveLength(6);
    expect(difficultyProfile(p1.map((x) => x.question))).toEqual({ EASY: 3, MEDIUM: 2, HARD: 1 });
    expect(difficultyProfile(p2.map((x) => x.question))).toEqual(difficultyProfile(p1.map((x) => x.question)));
    expect(setKey(p1.map((x) => x.questionId))).not.toBe(setKey(p2.map((x) => x.questionId)));
  });

  it('never sends correct answers to the exam screen', async () => {
    const res = await request(app).get(`/api/attempts/${attempt1}`).set(auth(tokenS1));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('isCorrect');
    expect(JSON.stringify(res.body)).not.toContain('acceptedAnswers');
  });

  it('resumes after a reload with the same questions, saved answers and correct remaining time', async () => {
    const first = await request(app).get(`/api/attempts/${attempt1}`).set(auth(tokenS1));
    const q = first.body.questions[0];
    const save = await request(app)
      .put(`/api/attempts/${attempt1}/answers`)
      .set(auth(tokenS1))
      .send({ attemptQuestionId: q.attemptQuestionId, selectedOptionId: q.options[1].id, flagged: true });
    expect(save.status).toBe(200);

    // "Reload": start again + fetch again
    const again = await request(app).post(`/api/exams/${f.openExam.id}/start`).set(auth(tokenS1));
    expect(again.body).toEqual({ attemptId: attempt1, resumed: true });
    const reloaded = await request(app).get(`/api/attempts/${attempt1}`).set(auth(tokenS1));

    expect(reloaded.body.questions.map((x: { attemptQuestionId: string }) => x.attemptQuestionId)).toEqual(
      first.body.questions.map((x: { attemptQuestionId: string }) => x.attemptQuestionId),
    );
    expect(reloaded.body.questions[0].options).toEqual(first.body.questions[0].options); // same option order
    expect(reloaded.body.questions[0].answer).toMatchObject({ selectedOptionId: q.options[1].id, flagged: true });

    const attempt = await prisma.examAttempt.findUniqueOrThrow({ where: { id: attempt1 } });
    const expected = attempt.deadlineAt.getTime() - Date.now();
    expect(Math.abs(reloaded.body.remainingMs - expected)).toBeLessThan(3000);
    expect(reloaded.body.remainingMs).toBeLessThanOrEqual(first.body.remainingMs);
  });

  it('rejects answers that arrive after the server deadline and auto-submits', async () => {
    const before = await request(app).get(`/api/attempts/${attempt2}`).set(auth(tokenS2));
    const q = before.body.questions[0];
    // The student's own clock is irrelevant: move the SERVER deadline into the past.
    await prisma.examAttempt.update({ where: { id: attempt2 }, data: { deadlineAt: new Date(Date.now() - 10_000) } });

    const late = await request(app)
      .put(`/api/attempts/${attempt2}/answers`)
      .set(auth(tokenS2))
      .send({ attemptQuestionId: q.attemptQuestionId, selectedOptionId: q.options[0].id });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('TIME_UP');

    const attempt = await prisma.examAttempt.findUniqueOrThrow({ where: { id: attempt2 } });
    expect(attempt.status).toBe('AUTO_SUBMITTED');
    const ans = await prisma.answer.findUnique({ where: { attemptQuestionId: q.attemptQuestionId } });
    expect(ans?.selectedOptionId ?? null).toBeNull(); // the late answer was not stored
    const restart = await request(app).post(`/api/exams/${f.openExam.id}/start`).set(auth(tokenS2));
    expect(restart.body.error.code).toBe('ALREADY_SUBMITTED');
  });
});

describe('tab-switch detection and invigilation', () => {
  it('logs short focus losses without counting them, warns after 3', async () => {
    const lost = () => request(app).post(`/api/attempts/${attempt1}/focus`).set(auth(tokenS1)).send({ type: 'LOST' });
    const back = () => request(app).post(`/api/attempts/${attempt1}/focus`).set(auth(tokenS1)).send({ type: 'REGAINED' });

    await lost();
    const quick = await back();
    expect(quick.body).toEqual({ tabSwitches: 0, warn: false });

    for (let i = 0; i < 3; i++) {
      await lost();
      // pretend the student stayed away for 5 seconds
      const open = await prisma.focusEvent.findFirstOrThrow({ where: { attemptId: attempt1, regainedAt: null } });
      await prisma.focusEvent.update({ where: { id: open.id }, data: { lostAt: new Date(Date.now() - 5000) } });
      await back();
    }
    const hb = await request(app).post(`/api/attempts/${attempt1}/heartbeat`).set(auth(tokenS1));
    expect(hb.body.tabSwitches).toBe(3);
    expect(hb.body.warn).toBe(true);
    expect(await prisma.focusEvent.count({ where: { attemptId: attempt1 } })).toBe(4); // short one is logged too
  });

  it('shows status, progress and tab switches on the invigilator view (assigned only)', async () => {
    const inv1 = await login('inv1');
    const res = await request(app).get(`/api/exams/${f.openExam.id}/live`).set(auth(inv1));
    expect(res.status).toBe(200);
    const row1 = res.body.students.find((s: { studentId: string }) => s.studentId === 'T-001');
    const row2 = res.body.students.find((s: { studentId: string }) => s.studentId === 'T-002');
    expect(row1).toMatchObject({ status: 'IN_PROGRESS', answered: 1, total: 6, tabSwitches: 3 });
    expect(row2.status).toBe('SUBMITTED');

    await prisma.examAttempt.update({ where: { id: attempt1 }, data: { lastSeenAt: new Date(Date.now() - 40_000) } });
    const later = await request(app).get(`/api/exams/${f.openExam.id}/live`).set(auth(inv1));
    expect(later.body.students.find((s: { studentId: string }) => s.studentId === 'T-001').status).toBe('DISCONNECTED');

    const inv2 = await login('inv2');
    expect((await request(app).get(`/api/exams/${f.openExam.id}/live`).set(auth(inv2))).status).toBe(403);
  });

  it('lets an invigilator extend one student by at most 15 minutes in total', async () => {
    const inv1 = await login('inv1');
    const before = await prisma.examAttempt.findUniqueOrThrow({ where: { id: attempt1 } });
    const ok = await request(app).post(`/api/attempts/${attempt1}/extend`).set(auth(inv1)).send({ minutes: 10, reason: 'Power cut in Lab A' });
    expect(ok.status).toBe(200);
    const after = await prisma.examAttempt.findUniqueOrThrow({ where: { id: attempt1 } });
    expect(after.deadlineAt.getTime() - before.deadlineAt.getTime()).toBe(10 * 60_000);
    const tooMuch = await request(app).post(`/api/attempts/${attempt1}/extend`).set(auth(inv1)).send({ minutes: 6, reason: 'Again' });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.code).toBe('EXTENSION_LIMIT');
  });
});
