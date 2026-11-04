/**
 * Registrar / admin endpoints (faculties, courses, enrolment, rooms, users, audit, SMS outbox).
 * All routes require login; write routes require role ADMIN (checked on the server).
 *
 *   GET    /api/faculties                      list faculties
 *   POST   /api/faculties                      { code, name }                       ADMIN
 *   PATCH  /api/faculties/:id                  { code?, name? }                     ADMIN
 *   GET    /api/courses                        role-scoped list
 *   POST   /api/courses                        { code, name, semester, facultyId, lecturerId? }  ADMIN
 *   PATCH  /api/courses/:id                    partial course                       ADMIN
 *   GET    /api/courses/:id/enrolments         enrolments (active + dropped)        ADMIN, course LECTURER
 *   POST   /api/courses/:id/enrolments         { studentUserId }                    ADMIN
 *   DELETE /api/courses/:id/enrolments/:sid    drop (keeps results)                 ADMIN
 *   POST   /api/enrolments/import              { csv, dryRun } -> preview/report    ADMIN
 *   GET    /api/students?search=               students                             ADMIN
 *   GET    /api/rooms | POST /api/rooms | PATCH /api/rooms/:id                      ADMIN (GET: staff)
 *   GET    /api/users?role=                    users (lecturers may list LECTURER/INVIGILATOR)
 *   POST   /api/users                          { username, fullName, role, password, phone?, email?, studentId? } ADMIN
 *   PATCH  /api/users/:id/active               { isActive }                         ADMIN
 *   GET    /api/audit?action=&entity=&page=    audit log                            ADMIN
 *   GET    /api/outbox                         simulated SMS outbox                 ADMIN
 *   GET    /api/grade-scale                    university grade scale               any user
 */
import { Router } from 'express';
import { z } from 'zod';
import { parse, zId, zIdParam, zPhone } from '../lib/validate';
import { authenticate, currentUser, requireRole } from '../middleware/auth';
import { isValidNetworkRule } from '../lib/network';
import { forbidden } from '../lib/errors';
import { listGradeScale } from '../services/grading.service';
import * as courses from '../services/course.service';
import { assertCourseAccess } from '../services/access.service';
import { listAudit } from '../services/audit.service';
import { listOutbox } from '../services/notification.service';

export const adminRouter = Router();
adminRouter.use(authenticate);

const admin = requireRole('ADMIN');
const staff = requireRole('ADMIN', 'LECTURER', 'INVIGILATOR');

// ----- Faculties -----
const facultySchema = z.object({ code: z.string().trim().min(2).max(12).regex(/^[A-Za-z0-9-]+$/), name: z.string().trim().min(3).max(120) });

adminRouter.get('/faculties', async (_req, res) => res.json(await courses.listFaculties()));
adminRouter.post('/faculties', admin, async (req, res) => {
  res.status(201).json(await courses.createFaculty(currentUser(req), parse(facultySchema, req.body)));
});
adminRouter.patch('/faculties/:id', admin, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await courses.updateFaculty(currentUser(req), id, parse(facultySchema.partial(), req.body)));
});

// ----- Courses -----
const courseSchema = z.object({
  code: z.string().trim().min(3).max(16).regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and - only'),
  name: z.string().trim().min(3).max(150),
  semester: z.string().trim().min(3).max(40),
  facultyId: zId,
  lecturerId: zId.nullable().optional(),
});

adminRouter.get('/courses', async (req, res) => res.json(await courses.listCourses(currentUser(req))));
adminRouter.post('/courses', admin, async (req, res) => {
  res.status(201).json(await courses.createCourse(currentUser(req), parse(courseSchema, req.body)));
});
adminRouter.patch('/courses/:id', admin, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await courses.updateCourse(currentUser(req), id, parse(courseSchema.partial(), req.body)));
});

// ----- Enrolment -----
adminRouter.get('/courses/:id/enrolments', requireRole('ADMIN', 'LECTURER'), async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  await assertCourseAccess(currentUser(req), id);
  res.json(await courses.listEnrolments(id));
});
adminRouter.post('/courses/:id/enrolments', admin, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  const { studentUserId } = parse(z.object({ studentUserId: zId }), req.body);
  res.status(201).json(await courses.enrolStudent(currentUser(req), id, studentUserId));
});
adminRouter.delete('/courses/:id/enrolments/:studentUserId', admin, async (req, res) => {
  const { id, studentUserId } = parse(z.object({ id: zId, studentUserId: zId }), req.params);
  res.json(await courses.dropStudent(currentUser(req), id, studentUserId));
});
const csvSchema = z.object({ csv: z.string().min(1).max(2_000_000), dryRun: z.boolean().default(true) });
adminRouter.post('/enrolments/import', admin, async (req, res) => {
  const body = parse(csvSchema, req.body);
  res.json(await courses.importStudents(currentUser(req), body.csv, body.dryRun));
});
adminRouter.get('/students', admin, async (req, res) => {
  const { search } = parse(z.object({ search: z.string().max(80).optional() }), req.query);
  res.json(await courses.listStudents(search));
});

// ----- Rooms -----
const roomSchema = z.object({
  name: z.string().trim().min(2).max(60),
  building: z.string().trim().min(2).max(80),
  capacity: z.coerce.number().int().min(1).max(2000),
  network: z
    .string()
    .trim()
    .max(40)
    .nullable()
    .optional()
    .refine((v) => !v || isValidNetworkRule(v), 'Use an IPv4 address or CIDR, e.g. 192.168.10.0/24'),
});
adminRouter.get('/rooms', staff, async (_req, res) => res.json(await courses.listRooms()));
adminRouter.post('/rooms', admin, async (req, res) => {
  res.status(201).json(await courses.createRoom(currentUser(req), parse(roomSchema, req.body)));
});
adminRouter.patch('/rooms/:id', admin, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  res.json(await courses.updateRoom(currentUser(req), id, parse(roomSchema.partial(), req.body)));
});

// ----- Users -----
const roleEnum = z.enum(['ADMIN', 'LECTURER', 'STUDENT', 'INVIGILATOR']);
adminRouter.get('/users', staff, async (req, res) => {
  const { role } = parse(z.object({ role: roleEnum.optional() }), req.query);
  const user = currentUser(req);
  // Lecturers may look up colleagues (second grader) and invigilators only.
  if (user.role !== 'ADMIN' && role !== 'LECTURER' && role !== 'INVIGILATOR') throw forbidden();
  res.json(await courses.listUsers(role));
});
const userSchema = z.object({
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/, 'Letters, numbers, . _ - only'),
  fullName: z.string().trim().min(3).max(120),
  role: roleEnum,
  password: z.string().min(8).max(128).regex(/[A-Za-z]/).regex(/[0-9]/),
  phone: zPhone.nullable().optional(),
  email: z.string().email().nullable().optional(),
  studentId: z.string().trim().min(3).max(30).nullable().optional(),
});
adminRouter.post('/users', admin, async (req, res) => {
  res.status(201).json(await courses.createUser(currentUser(req), parse(userSchema, req.body)));
});
adminRouter.patch('/users/:id/active', admin, async (req, res) => {
  const { id } = parse(zIdParam, req.params);
  const { isActive } = parse(z.object({ isActive: z.boolean() }), req.body);
  res.json(await courses.setUserActive(currentUser(req), id, isActive));
});

// ----- Audit, outbox, grade scale -----
adminRouter.get('/audit', admin, async (req, res) => {
  const q = parse(
    z.object({
      action: z.string().max(60).optional(),
      entity: z.string().max(60).optional(),
      userId: z.string().max(64).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(30),
    }),
    req.query,
  );
  res.json(await listAudit(q));
});
adminRouter.get('/outbox', admin, async (_req, res) => res.json(await listOutbox()));
adminRouter.get('/grade-scale', async (_req, res) => res.json(await listGradeScale()));
