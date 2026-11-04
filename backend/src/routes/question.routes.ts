/**
 * Question bank endpoints (LECTURER of the course, or ADMIN).
 *
 *   GET    /api/courses/:courseId/questions?type=&difficulty=&topic=&search=   latest questions
 *   GET    /api/courses/:courseId/bank-summary         topics + counts per topic/difficulty
 *   POST   /api/courses/:courseId/questions            QuestionInput -> created question
 *   POST   /api/courses/:courseId/questions/import     { csv, dryRun } -> { rows, summary }
 *   GET    /api/questions/import/template              CSV template (text/csv)
 *   GET    /api/questions/:id                          question + version history
 *   PUT    /api/questions/:id                          QuestionInput -> latest (versioned:true if a new version was made)
 *   DELETE /api/questions/:id                          archive (kept for past exams)
 *
 * QuestionInput: { type, text, imageUrl?, marks, topic, difficulty, options?: [{text,isCorrect}],
 *                  acceptedAnswers?: string[], rubric?: [{criterion, points}] }
 */
import { Router } from 'express';
import { z } from 'zod';
import { parse, zDifficulty, zId, zIdParam, zQuestionType } from '../lib/validate';
import { authenticate, currentUser, requireRole } from '../middleware/auth';
import * as questions from '../services/question.service';
import { importQuestions, QUESTION_CSV_TEMPLATE } from '../services/questionImport.service';

export const questionRouter = Router();
questionRouter.use(authenticate, requireRole('LECTURER', 'ADMIN'));

export const questionInputSchema = z.object({
  type: zQuestionType,
  text: z.string().trim().min(1).max(4000),
  imageUrl: z.string().max(1_000_000).nullable().optional(),
  marks: z.coerce.number().min(0.5).max(100),
  topic: z.string().trim().min(1).max(60),
  difficulty: zDifficulty,
  options: z.array(z.object({ text: z.string().trim().max(500), isCorrect: z.boolean() })).max(5).optional(),
  acceptedAnswers: z.array(z.string().trim().max(200)).max(20).optional(),
  rubric: z.array(z.object({ criterion: z.string().trim().max(200), points: z.coerce.number().min(0).max(100) })).max(10).nullable().optional(),
});

const courseParam = z.object({ courseId: zId });

questionRouter.get('/courses/:courseId/questions', async (req, res) => {
  const { courseId } = parse(courseParam, req.params);
  const filter = parse(
    z.object({ type: zQuestionType.optional(), difficulty: zDifficulty.optional(), topic: z.string().max(60).optional(), search: z.string().max(100).optional() }),
    req.query,
  );
  res.json(await questions.listQuestions(currentUser(req), courseId, filter));
});

questionRouter.get('/courses/:courseId/bank-summary', async (req, res) => {
  const { courseId } = parse(courseParam, req.params);
  res.json(await questions.bankSummary(currentUser(req), courseId));
});

questionRouter.post('/courses/:courseId/questions', async (req, res) => {
  const { courseId } = parse(courseParam, req.params);
  res.status(201).json(await questions.createQuestion(currentUser(req), courseId, parse(questionInputSchema, req.body)));
});

questionRouter.post('/courses/:courseId/questions/import', async (req, res) => {
  const { courseId } = parse(courseParam, req.params);
  const body = parse(z.object({ csv: z.string().min(1).max(3_000_000), dryRun: z.boolean().default(true) }), req.body);
  res.json(await importQuestions(currentUser(req), courseId, body.csv, body.dryRun));
});

questionRouter.get('/questions/import/template', (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="imtixaan-questions-template.csv"');
  res.send(QUESTION_CSV_TEMPLATE);
});

questionRouter.get('/questions/:id', async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await questions.getQuestion(currentUser(req), id));
});

questionRouter.put('/questions/:id', async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await questions.updateQuestion(currentUser(req), id, parse(questionInputSchema, req.body)));
});

questionRouter.delete('/questions/:id', async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  await questions.archiveQuestion(currentUser(req), id);
  res.json({ ok: true });
});
