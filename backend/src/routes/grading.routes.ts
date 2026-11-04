/**
 * Grading, results, analytics and export endpoints.
 *
 * Lecturer / admin:
 *   GET  /api/exams/:id/grading?all=true    essays + "Needs review" answers (blind for 2nd grader)
 *   PUT  /api/answers/:id/grade             { awardedMarks? | rubricScores?, comment? }
 *   GET  /api/exams/:id/results             results table
 *   POST /api/exams/:id/publish             409 GRADING_INCOMPLETE until everything is graded
 *   POST /api/exams/:id/reopen              { reason } hide results and allow re-grading
 *   GET  /api/exams/:id/export.csv          grades CSV
 *   GET  /api/exams/:id/analytics           stats + per-question difficulty/discrimination
 *   GET  /api/dashboard                     dashboard totals + chart data
 * Student:
 *   GET  /api/student/results               my published results
 *   GET  /api/student/results/:attemptId    one result with question review (if allowed)
 */
import { Router } from 'express';
import { z } from 'zod';
import { parse, zIdParam } from '../lib/validate';
import { authenticate, currentUser, requireRole } from '../middleware/auth';
import * as grading from '../services/grading.service';
import { dashboard, examAnalytics } from '../services/analytics.service';

export const gradingRouter = Router();
gradingRouter.use(authenticate);

const lecturer = requireRole('LECTURER', 'ADMIN');

gradingRouter.get('/exams/:id/grading', lecturer, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  const { all } = parse(z.object({ all: z.enum(['true', 'false']).optional() }), req.query);
  res.json(await grading.gradingQueue(currentUser(req), id, all === 'true'));
});

const gradeSchema = z.object({
  awardedMarks: z.coerce.number().min(0).max(100).optional(),
  rubricScores: z
    .array(z.object({ criterion: z.string().max(200), points: z.number().min(0).max(100), awarded: z.number().min(0).max(100) }))
    .max(10)
    .optional(),
  comment: z.string().trim().max(2000).nullable().optional(),
});

gradingRouter.put('/answers/:id/grade', lecturer, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await grading.gradeAnswer(currentUser(req), id, parse(gradeSchema, req.body)));
});

gradingRouter.get('/exams/:id/results', lecturer, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await grading.examResults(currentUser(req), id));
});

gradingRouter.post('/exams/:id/publish', lecturer, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await grading.publishResults(currentUser(req), id));
});

gradingRouter.post('/exams/:id/reopen', lecturer, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
  res.json(await grading.reopenGrading(currentUser(req), id, reason));
});

gradingRouter.get('/exams/:id/export.csv', lecturer, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  const csv = await grading.exportGradesCsv(currentUser(req), id);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="grades-${id}.csv"`);
  res.send('﻿' + csv);
});

gradingRouter.get('/exams/:id/analytics', lecturer, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await examAnalytics(currentUser(req), id));
});

gradingRouter.get('/dashboard', lecturer, async (req, res) => {
  res.json(await dashboard(currentUser(req)));
});

gradingRouter.get('/student/results', requireRole('STUDENT'), async (req, res) => {
  res.json(await grading.myResults(currentUser(req)));
});

gradingRouter.get('/student/results/:id', requireRole('STUDENT'), async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await grading.myResultDetail(currentUser(req), id));
});
