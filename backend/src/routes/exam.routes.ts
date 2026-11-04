/**
 * Exam builder, scheduling and approval endpoints.
 *
 *   GET  /api/exams                       role-scoped list (lecturer: own; invigilator: assigned)
 *   POST /api/exams                       { courseId, title, instructions?, shuffleQuestions?, shuffleOptions?, durationMinutes?, allowReview? }  LECTURER/ADMIN
 *   GET  /api/exams/approvals             pending schedules with clash info               ADMIN
 *   GET  /api/exams/:id                   detail + rules feasibility                       LECTURER/ADMIN
 *   PATCH /api/exams/:id                  update details (draft/rejected only)             LECTURER/ADMIN
 *   POST /api/exams/:id/rules/check       { rules } -> feasibility (no save)
 *   PUT  /api/exams/:id/rules             { rules } -> saved rules; 400 RULES_NOT_FEASIBLE blocks saving
 *   POST /api/exams/:id/preview           sample generated paper (not saved)
 *   POST /api/exams/:id/schedule          { windowStart, windowEnd, durationMinutes, roomIds, allowedNetworks, invigilatorIds } -> PENDING_APPROVAL
 *   POST /api/exams/:id/withdraw          back to DRAFT (only before anyone started)
 *   PUT  /api/exams/:id/second-grader     { lecturerId | null }
 *   POST /api/exams/:id/approve           ADMIN
 *   POST /api/exams/:id/reject            { reason }  ADMIN
 *
 * rules: [{ difficulty: EASY|MEDIUM|HARD, count: 1..100, topics: string[] }]
 */
import { Router } from 'express';
import { z } from 'zod';
import { parse, zDifficulty, zId, zIdParam } from '../lib/validate';
import { authenticate, currentUser, requireRole } from '../middleware/auth';
import * as exams from '../services/exam.service';

export const examRouter = Router();
examRouter.use(authenticate);

const lecturer = requireRole('LECTURER', 'ADMIN');

const detailsSchema = z.object({
  courseId: zId,
  title: z.string().trim().min(3).max(150),
  instructions: z.string().trim().max(4000).optional(),
  shuffleQuestions: z.boolean().optional(),
  shuffleOptions: z.boolean().optional(),
  durationMinutes: z.coerce.number().int().min(1).max(480).optional(),
  allowReview: z.boolean().optional(),
});

const rulesSchema = z.object({
  rules: z
    .array(z.object({ difficulty: zDifficulty, count: z.coerce.number().int().min(1).max(100), topics: z.array(z.string().trim().max(60)).max(30).default([]) }))
    .min(1)
    .max(12),
});

const scheduleSchema = z.object({
  windowStart: z.coerce.date(),
  windowEnd: z.coerce.date(),
  durationMinutes: z.coerce.number().int().min(1).max(480),
  roomIds: z.array(zId).max(30).default([]),
  allowedNetworks: z.array(z.string().trim().min(7).max(40)).max(30).default([]),
  invigilatorIds: z.array(zId).max(30).default([]),
});

examRouter.get('/', requireRole('LECTURER', 'ADMIN', 'INVIGILATOR'), async (req, res) => {
  res.json(await exams.listExams(currentUser(req)));
});

examRouter.post('/', lecturer, async (req, res) => {
  res.status(201).json(await exams.createExam(currentUser(req), parse(detailsSchema, req.body)));
});

examRouter.get('/approvals', requireRole('ADMIN'), async (_req, res) => {
  res.json(await exams.listPendingApprovals());
});

examRouter.get('/:id', lecturer, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await exams.getExam(currentUser(req), id));
});

examRouter.patch('/:id', lecturer, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await exams.updateExam(currentUser(req), id, parse(detailsSchema.omit({ courseId: true }).partial(), req.body)));
});

examRouter.post('/:id/rules/check', lecturer, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await exams.checkRules(currentUser(req), id, parse(rulesSchema, req.body).rules));
});

examRouter.put('/:id/rules', lecturer, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await exams.setRules(currentUser(req), id, parse(rulesSchema, req.body).rules));
});

examRouter.post('/:id/preview', lecturer, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await exams.previewExam(currentUser(req), id));
});

examRouter.post('/:id/schedule', lecturer, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await exams.requestSchedule(currentUser(req), id, parse(scheduleSchema, req.body)));
});

examRouter.post('/:id/withdraw', lecturer, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await exams.withdrawExam(currentUser(req), id));
});

examRouter.put('/:id/second-grader', lecturer, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  const { lecturerId } = parse(z.object({ lecturerId: zId.nullable() }), req.body);
  res.json(await exams.setSecondGrader(currentUser(req), id, lecturerId));
});

examRouter.post('/:id/approve', requireRole('ADMIN'), async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await exams.approveExam(currentUser(req), id));
});

examRouter.post('/:id/reject', requireRole('ADMIN'), async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
  res.json(await exams.rejectExam(currentUser(req), id, reason));
});
