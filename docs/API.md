# Imtixaan API reference

Base URL: `http://<server>:4000/api`. All bodies are JSON.

**Authentication:** `POST /auth/login` returns a JWT. Send it on every other request as `Authorization: Bearer <token>`.

**Errors** always look like this:

```json
{ "error": { "code": "TIME_UP", "message": "Time is up...", "details": {} } }
```

| Status | Meaning |
|---|---|
| 400 | `VALIDATION_ERROR` (with field list) or a business rule (`RULES_NOT_FEASIBLE`, `DURATION_EXCEEDS_WINDOW`, ...) |
| 401 | `UNAUTHORIZED` / `INVALID_CREDENTIALS` |
| 403 | `FORBIDDEN`, `NOT_ENROLLED`, `NETWORK_NOT_ALLOWED` |
| 404 | `NOT_FOUND` (also returned for unpublished results, so students cannot detect them) |
| 409 | state conflicts: `TIME_UP`, `ALREADY_SUBMITTED`, `SCHEDULE_CLASH`, `GRADING_INCOMPLETE`, ... |
| 429 | `RATE_LIMITED` |

Roles: **A** = Admin/Registrar, **L** = Lecturer, **S** = Student, **I** = Invigilator. Every role check runs on the server.

---

## Auth (`routes/auth.routes.ts`)

| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| POST | `/auth/login` | public (rate limited) | `{ identifier, password }`: username or student ID | `{ token, user }` |
| GET | `/auth/me` | any | - | profile |
| POST | `/auth/change-password` | any | `{ currentPassword, newPassword }` | `{ ok }` |

## Registrar (`routes/admin.routes.ts`)

| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| GET | `/faculties` | any | - | faculties with course counts |
| POST | `/faculties` | A | `{ code, name }` | faculty |
| PATCH | `/faculties/:id` | A | `{ code?, name? }` | faculty |
| GET | `/courses` | any | - | role-scoped: A all, L own, S enrolled |
| POST | `/courses` | A | `{ code, name, semester, facultyId, lecturerId? }` | course |
| PATCH | `/courses/:id` | A | partial course | course |
| GET | `/courses/:id/enrolments` | A, course L | - | active and dropped enrolments |
| POST | `/courses/:id/enrolments` | A | `{ studentUserId }` | enrolment |
| DELETE | `/courses/:id/enrolments/:studentUserId` | A | - | enrolment marked DROPPED (results kept) |
| POST | `/enrolments/import` | A | `{ csv, dryRun }` | `{ rows[{line,status,errors}], summary }` |
| GET | `/students?search=` | A | - | students with active courses |
| GET | `/rooms` | A, L, I | - | rooms |
| POST | `/rooms` | A | `{ name, building, capacity, network? }` | room |
| PATCH | `/rooms/:id` | A | partial room | room |
| GET | `/users?role=` | A (L, I: only `LECTURER` / `INVIGILATOR` lists) | - | users |
| POST | `/users` | A | `{ username, fullName, role, password, phone?, email?, studentId? }` | user |
| PATCH | `/users/:id/active` | A | `{ isActive }` | `{ id, isActive }` |
| GET | `/audit?action=&entity=&userId=&page=&pageSize=` | A | - | `{ items, total, page, pageSize }` |
| GET | `/outbox` | A | - | simulated SMS messages |
| GET | `/grade-scale` | any | - | `[{ letter, minPercent, points }]` |

## Question bank (`routes/question.routes.ts`): L of the course, or A

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/courses/:courseId/questions?type=&difficulty=&topic=&search=` | - | latest question versions, with options |
| GET | `/courses/:courseId/bank-summary` | - | `{ topics, counts[{topic,difficulty,count}] }` |
| POST | `/courses/:courseId/questions` | QuestionInput | question (409 `DUPLICATE_QUESTION`) |
| POST | `/courses/:courseId/questions/import` | `{ csv, dryRun }` | `{ rows[{line,status:VALID/ERROR/DUPLICATE,errors}], summary }` |
| GET | `/questions/import/template` | - | CSV template file |
| GET | `/questions/:id` | - | question + version history |
| PUT | `/questions/:id` | QuestionInput | latest version, `versioned: true` if a new version was created |
| DELETE | `/questions/:id` | - | archives the question (kept for past exams) |

QuestionInput:

```json
{
  "type": "MCQ | TRUE_FALSE | SHORT_ANSWER | ESSAY",
  "text": "...", "imageUrl": "https://... or data:image/png;base64,...",
  "marks": 2, "topic": "Networking", "difficulty": "EASY | MEDIUM | HARD",
  "options": [{ "text": "...", "isCorrect": true }],
  "acceptedAnswers": ["SMTP"],
  "rubric": [{ "criterion": "Content", "points": 6 }]
}
```

## Exams (`routes/exam.routes.ts`)

| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| GET | `/exams` | A, L, I | - | role-scoped list |
| POST | `/exams` | L, A | `{ courseId, title, instructions?, durationMinutes?, shuffleQuestions?, shuffleOptions?, allowReview? }` | exam (DRAFT) |
| GET | `/exams/approvals` | A | - | pending exams with `clashes` |
| GET | `/exams/:id` | L, A | - | exam + `feasibility` |
| PATCH | `/exams/:id` | L, A | details | exam (409 `EXAM_LOCKED` unless DRAFT/REJECTED) |
| POST | `/exams/:id/rules/check` | L, A | `{ rules }` | feasibility (not saved) |
| PUT | `/exams/:id/rules` | L, A | `{ rules:[{difficulty,count,topics[]}] }` | rules (400 `RULES_NOT_FEASIBLE` blocks saving) |
| POST | `/exams/:id/preview` | L, A | - | one sample paper (not saved) |
| POST | `/exams/:id/schedule` | L, A | `{ windowStart, windowEnd, durationMinutes, roomIds[], allowedNetworks[], invigilatorIds[] }` | exam (PENDING_APPROVAL); 409 `SCHEDULE_CLASH` |
| POST | `/exams/:id/withdraw` | L, A | - | back to DRAFT (only before anyone started) |
| PUT | `/exams/:id/second-grader` | L, A | `{ lecturerId \| null }` | exam |
| POST | `/exams/:id/approve` | A | - | SCHEDULED; students notified with an SMS |
| POST | `/exams/:id/reject` | A | `{ reason }` | REJECTED |

## Taking exams and invigilation (`routes/attempt.routes.ts`)

| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| GET | `/student/exams` | S | - | scheduled exams with `windowState` and `attempt` |
| POST | `/exams/:id/start` | S | - | `{ attemptId, resumed }`: the same attempt every time |
| GET | `/attempts/:id` | S (owner) | - | `{ status, exam, serverNow, deadlineAt, remainingMs, tabSwitches, warn, questions[...] }` (no correct answers) |
| PUT | `/attempts/:id/answers` | S (owner) | `{ attemptQuestionId, selectedOptionId?, textAnswer?, flagged? }` | `{ savedAt, remainingMs }`; **409 `TIME_UP` after the deadline** |
| POST | `/attempts/:id/heartbeat` | S (owner) | - | `{ status, remainingMs, tabSwitches, warn, extraMinutes }` |
| POST | `/attempts/:id/focus` | S (owner) | `{ type: LOST \| REGAINED, durationMs? }` | `{ tabSwitches, warn }` |
| POST | `/attempts/:id/submit` | S (owner) | - | `{ status: SUBMITTED \| AUTO_SUBMITTED }` |
| GET | `/exams/:id/live` | I (assigned), L, A | - | `{ summary, students[{status,answered,total,tabSwitches,remainingMs,...}], notes }` |
| POST | `/exams/:id/notes` | I, L, A | `{ attemptId?, text }` | note |
| POST | `/attempts/:id/extend` | I, L, A | `{ minutes: 1-15, reason }` | new deadline (400 `EXTENSION_LIMIT` above 15 minutes in total) |
| GET | `/attempts/:id/focus-events` | I, L, A | - | tab-switch log |

## Grading, results, analytics (`routes/grading.routes.ts`)

| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| GET | `/exams/:id/grading?all=true` | L (course or second grader), A | - | essays and "Needs review" answers (`blind` hides names) |
| PUT | `/answers/:id/grade` | L, A | `{ awardedMarks? \| rubricScores[{criterion,points,awarded}], comment? }` | answer |
| GET | `/exams/:id/results` | L, A | - | results table |
| POST | `/exams/:id/publish` | L, A | - | `{ published, changed }`; 409 `GRADING_INCOMPLETE` / `ATTEMPTS_IN_PROGRESS` |
| POST | `/exams/:id/reopen` | L, A | `{ reason }` | hides results until re-published |
| GET | `/exams/:id/export.csv` | L, A | - | grades CSV |
| GET | `/exams/:id/analytics` | L, A | - | `{ stats, passRate, questions[{difficultyIndex, discrimination, flagged, enoughData}] }` |
| GET | `/dashboard` | L, A | - | totals + chart data from the database |
| GET | `/student/results` | S | - | published results only |
| GET | `/student/results/:attemptId` | S (owner) | - | score, grade, question review if allowed (404 if unpublished) |

## Notifications and payments (`routes/misc.routes.ts`)

| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| GET | `/notifications` | any | - | `{ items, unread }` (English + Somali text) |
| POST | `/notifications/read` | any | - | `{ ok }` |
| GET | `/payments/fees` | any | - | fee list |
| GET | `/payments` | any (A sees all) | - | payments |
| POST | `/payments` | any | `{ provider: EVC_PLUS \| ZAAD \| EDAHAB, phone, fee }` | receipt (402 `PAYMENT_FAILED`; numbers ending 0000 fail on purpose) |

## Other

| Method | Path | Response |
|---|---|---|
| GET | `/health` | `{ ok: true }` |
| GET | `/time` | `{ serverNow }` |
