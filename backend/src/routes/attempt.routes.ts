/**
 * Exam taking (STUDENT) and live invigilation endpoints.
 *
 * Student:
 *   GET  /api/student/exams                 my scheduled exams + attempt state
 *   POST /api/exams/:id/start               start or resume -> { attemptId, resumed }
 *   GET  /api/attempts/:id                  paper, saved answers, serverNow, deadlineAt, remainingMs
 *   PUT  /api/attempts/:id/answers          { attemptQuestionId, selectedOptionId?, textAnswer?, flagged? } -> { savedAt, remainingMs }
 *                                           409 TIME_UP after the server deadline
 *   POST /api/attempts/:id/heartbeat        -> { status, remainingMs, tabSwitches, warn }
 *   POST /api/attempts/:id/focus            { type: LOST|REGAINED, durationMs? } -> { tabSwitches, warn }
 *   POST /api/attempts/:id/submit           -> { status }
 * Invigilator / lecturer / admin:
 *   GET  /api/exams/:id/live                live student list (poll every few seconds)
 *   POST /api/exams/:id/notes               { attemptId?, text }
 *   POST /api/attempts/:id/extend           { minutes 1..15, reason }
 *   GET  /api/attempts/:id/focus-events     tab-switch log
 */
import { Router } from 'express';
import { z } from 'zod';
import { parse, zId, zIdParam } from '../lib/validate';
import { authenticate, currentUser, requireRole } from '../middleware/auth';
import * as attempts from '../services/attempt.service';
import * as invigilation from '../services/invigilator.service';
import { listStudentExams } from '../services/exam.service';
import { MAX_EXTENSION_MINUTES } from '../core/timing';

export const attemptRouter = Router();
attemptRouter.use(authenticate);

const student = requireRole('STUDENT');
const watcher = requireRole('INVIGILATOR', 'LECTURER', 'ADMIN');

attemptRouter.get('/student/exams', student, async (req, res) => {
  res.json(await listStudentExams(currentUser(req)));
});

attemptRouter.post('/exams/:id/start', student, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await attempts.startAttempt(currentUser(req), id, req.ip ?? ''));
});

attemptRouter.get('/attempts/:id', student, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await attempts.getAttempt(currentUser(req), id));
});

const answerSchema = z
  .object({
    attemptQuestionId: zId,
    selectedOptionId: zId.nullable().optional(),
    textAnswer: z.string().max(20_000).nullable().optional(),
    flagged: z.boolean().optional(),
  })
  .refine((b) => b.selectedOptionId !== undefined || b.textAnswer !== undefined || b.flagged !== undefined, 'Nothing to save');

attemptRouter.put('/attempts/:id/answers', student, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await attempts.saveAnswer(currentUser(req), id, parse(answerSchema, req.body)));
});

attemptRouter.post('/attempts/:id/heartbeat', student, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await attempts.heartbeat(currentUser(req), id));
});

attemptRouter.post('/attempts/:id/focus', student, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  const body = parse(z.object({ type: z.enum(['LOST', 'REGAINED']), durationMs: z.coerce.number().int().min(0).max(86_400_000).optional() }), req.body);
  res.json(await attempts.recordFocus(currentUser(req), id, body));
});

attemptRouter.post('/attempts/:id/submit', student, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await attempts.submitAttempt(currentUser(req), id));
});

// ----- Invigilation -----
attemptRouter.get('/exams/:id/live', watcher, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await invigilation.liveView(currentUser(req), id));
});

attemptRouter.post('/exams/:id/notes', watcher, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  const body = parse(z.object({ attemptId: zId.nullable().optional(), text: z.string().trim().min(2).max(1000) }), req.body);
  res.status(201).json(await invigilation.addNote(currentUser(req), id, body));
});

attemptRouter.post('/attempts/:id/extend', watcher, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  const body = parse(z.object({ minutes: z.coerce.number().int().min(1).max(MAX_EXTENSION_MINUTES), reason: z.string().trim().min(3).max(500) }), req.body);
  res.json(await invigilation.extendTime(currentUser(req), id, body.minutes, body.reason));
});

attemptRouter.get('/attempts/:id/focus-events', watcher, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await invigilation.attemptFocusEvents(currentUser(req), id));
});
