# Imtixaan: Online Exam Platform

**Project 18.** A fair, cheat-resistant exam platform that a university can run on its own campus network, with randomised papers, a server-enforced timer and automatic grading. The whole interface is in Somali and English.

## The problem

Somali universities run exams on paper. Marking takes weeks, students copy from neighbours, and lecturers have no data on which questions are too easy or too hard.

Imtixaan gives every student a different paper of equal difficulty and keeps the timer on the server. It grades objective questions the moment a student submits and shows lecturers item analytics for every question.

## Core technical challenge: how it works

| Requirement | Design |
|---|---|
| **Different papers, equal difficulty** | An exam is a set of rules ("6 EASY, 4 MEDIUM from Networking/Security, 2 HARD"). At start, the server draws random questions for each rule using `crypto.randomInt` (Fisher-Yates), then shuffles question and option order. Every student gets the same count per difficulty. If a draw matches another student's set exactly, it is redrawn. The paper is **frozen** in `attempt_questions` (question version + option order). See `backend/src/core/examGenerator.ts`. |
| **Builder blocks impossible rules** | Rules can compete for the same questions. The check uses Hall's theorem: for every group of rules, the union of their pools must hold at least the sum of their counts. Saving is blocked otherwise, and the screen shows which rule is short. |
| **Server-side timer** | The server records `startedAt` and computes `deadlineAt = min(start + duration, windowEnd) + extensions` (`core/timing.ts`). The browser receives only `remainingMs` and counts down with `performance.now()`, a monotonic clock, so changing the device clock does nothing. The timer re-syncs every 10 seconds. |
| **Late answers rejected** | Every save checks the server clock. After the deadline (plus 2 s network grace) the API returns `409 TIME_UP`, does not store the answer, and auto-submits the attempt. A background job auto-submits any expired attempt every 5 s with the answers already saved. |
| **Resume after reload / disconnect** | `POST /exams/:id/start` is idempotent: the unique (exam, student) attempt is returned again. `GET /attempts/:id` returns the same frozen questions, the saved answers and the server's remaining time. While offline, answers are queued in the browser and retried. |
| **Tab-switch detection** | `blur` / `visibilitychange` send LOST and REGAINED events. The server measures the duration itself. Losses under 1 s are logged but not counted. From 3 counted switches the student sees a warning. The count appears in the invigilator view and on results. |

The three "Done when" conditions are covered by automated tests in `backend/tests/integration/examFlow.test.ts`.

## Features

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Courses and enrolment | ✅ Done | Faculties, courses, enrolment one by one or by CSV with preview. Dropping keeps past results. |
| 2 | Question bank | ✅ Done | MCQ (4-5 options, exactly one correct), true/false, short answer, essay with rubric. Optional image. Versioning when an already-used question is edited. Lecturers see only their own courses. |
| 3 | Bulk import | ✅ Done | CSV template download, row-by-row preview (valid / error with reason / duplicate). Only valid rows are saved. |
| 4 | Exam builder | ✅ Done | Difficulty and topic rules with a live bank check, shuffle options, sample-paper preview. |
| 5 | Scheduling | ✅ Done | Lecturer requests, admin approves or rejects. Window, duration (must fit), rooms, network ranges, invigilators. Clashing student exams are blocked. |
| 6 | Exam screen | ✅ Done | Timer, navigator (answered / unanswered / flagged), one question at a time, instant save, warnings at 10 and 1 minutes. Works on phones. |
| 7 | Server-side timing | ✅ Done | See above. |
| 8 | Tab-switch detection | ✅ Done | See above. |
| 9 | Invigilator live view | ✅ Done | Refreshes every 5 s. Not started / in progress (answered count) / submitted / disconnected (orange after 30 s). Notes, time extension with reason (max 15 minutes per student), tab-switch log. |
| 10 | Auto-grading | ✅ Done | MCQ and true/false graded on submit. Short answers match ignoring case and extra spaces; non-matches go to "Needs review". |
| 11 | Essay grading | ✅ Done | Answer shown beside the rubric. Publishing is blocked until everything is graded. Optional blind second grader sees "Candidate N" instead of names. |
| 12 | Results | ✅ Done | Score, letter from the university grade scale, optional question review. Unpublished results return 404. Grading can be re-opened; students are notified when a result changes. Results print to PDF. |
| 13 | Analytics and export | ✅ Done | Difficulty index, discrimination (top vs bottom 27%), flags below 20% and above 95%, "Not enough data" under 5 answers. Average, highest, lowest, distribution chart. Grades CSV export. |

### Common baseline

| Item | Status | Where |
|---|---|---|
| 1. Layered architecture | ✅ | Next.js UI → Express routes → services → Prisma. The UI never touches the database. See [Architecture](#architecture). |
| 2. Login + roles + audit | ✅ | JWT (HS256, 8 h). 4 roles, checked on the server for every request. `AuditLog` table plus an admin screen. |
| 3. Relational DB | ✅ | 22 tables with PK/FK, Prisma migrations, Somali seed data. See [docs/DATABASE.md](docs/DATABASE.md). |
| 4. Automated tests | ✅ | 44 tests (unit + integration on real PostgreSQL). `npm test`. GitHub Actions CI. |
| 5. GitHub + docs | ✅ | This README, [docs/API.md](docs/API.md), [docs/DATABASE.md](docs/DATABASE.md), doc comments on every module. |
| 6. Security basics | ✅ | bcrypt, zod validation on every input, rate limiting (login and API), helmet headers, `.env` + `.env.example`. |
| 7. Analytics dashboard | ✅ | Average score per course, grade distribution and tab-switch flags per exam, all from database queries. Per-exam distribution too. |
| 8. Somali + English | ✅ | Every screen, button, message, notification, SMS and printable result/receipt. Switch on every page. Responsive down to phone width. |
| Payments + SMS (simulated) | ✅ | Mock EVC Plus / Zaad / eDahab screen with PIN step and receipt (resit, re-mark and transcript fees). SMS written to an in-app outbox. Both behind adapter interfaces (`backend/src/adapters`). |

## Architecture

```
 Browser (phone / lab PC)                     Campus server
┌───────────────────────────┐   HTTPS/JSON  ┌────────────────────────────────────────────────┐
│ Next.js 15 + Tailwind      │  Bearer JWT  │ Express 5 API (port 4000)                       │
│ frontend/src/app/*  pages  │ ───────────► │  routes/*      HTTP, zod validation, roles      │
│ lib/api.ts  (only data     │              │  services/*    business rules, permissions      │
│   access from the UI)      │              │  core/*        pure logic: generator, timer,    │
│ lib/i18n + dictionary      │              │                grading, analytics (unit tested) │
│   (so / en)                │              │  adapters/*    SMS outbox, mock mobile money    │
└───────────────────────────┘              │  jobs/autoSubmit.ts  (every 5 s)                 │
                                           │  lib/prisma.ts  data access (Prisma client)      │
                                           └──────────────────────┬─────────────────────────┘
                                                                  │
                                                   PostgreSQL: Supabase, or local fallback
```

* **UI layer** (`frontend/`): pages call `api()` in `lib/api.ts` and nothing else. The API address defaults to the same host on port 4000, so any device on the campus network works without configuration.
* **Service layer** (`backend/src/services`): every business rule and ownership check (for example "a lecturer sees only their own courses").
* **Data access** (`backend/src/lib/prisma.ts` + Prisma schema): only services import it.

## Tech stack

| Part | Technology (version) |
|---|---|
| Runtime | Node.js 20+ (built and tested on 24.20; CI uses 22) |
| Frontend | Next.js 15.5.29, React 19.1, TypeScript 5.9, Tailwind CSS 3.4.17, Recharts 2.15 |
| Backend | Express 5.1, TypeScript 5.9, Zod 3.25, jsonwebtoken 9, bcryptjs 3, helmet 8, express-rate-limit 7, csv-parse 7 |
| Database | PostgreSQL 17 on Supabase, Prisma ORM 6.19.3 |
| Tests | Vitest 3.2, Supertest 7, embedded-postgres 17 (local), GitHub Actions with postgres:17 (CI) |

## Setup from a fresh computer

**Needs:** Node.js 20 or newer and Git. Docker and a system PostgreSQL are not needed.

```bash
git clone https://github.com/Nafiisamohamed/online-exam.git
cd online-exam
npm install
cp backend/.env.example backend/.env
```

### Option A: Supabase (online)

1. Create a project at [supabase.com](https://supabase.com).
2. Go to **Project Settings → Database → Connection string**.
3. In `backend/.env`:
   * set `DATABASE_URL` to the **Transaction pooler** string (port 6543) and add `?pgbouncer=true&connection_limit=5` to the end;
   * set `DIRECT_URL` to the **Session / direct** string (port 5432);
   * set `JWT_SECRET` to a long random string: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

### Option B: offline campus server (no internet)

```bash
npm run db:local        # starts PostgreSQL 17 on port 5433 (keep this terminal open)
```

In `backend/.env`, set both `DATABASE_URL` and `DIRECT_URL` to `postgresql://postgres:postgres@localhost:5433/imtixaan`.

### Create tables, load demo data, run

```bash
npm run db:migrate      # applies prisma/migrations
npm run db:seed         # demo university (deletes existing data!)
npm run dev             # API on :4000 and web app on :3000
```

* Open **http://localhost:3000**.
* Other devices on the campus network open **http://SERVER-IP:3000**.

The seed is time-relative: the CS101 Midterm and the HS120 Rapid Quiz open at the moment you seed. Re-run `npm run db:seed` just before a demo.

## Running the tests

```bash
npm test
```

* A throw-away embedded PostgreSQL is started automatically, migrated, and stopped afterwards. Nothing else is needed.
* To use an existing database instead, set `TEST_DATABASE_URL`.
* CI (`.github/workflows/ci.yml`) type-checks, tests and builds on every push.

| Test file | Covers |
|---|---|
| `tests/integration/examFlow.test.ts` | Different equal-difficulty papers, no answers leaked, resume after reload, late answers rejected, tab-switch counting, invigilator view, disconnected status, extension limit |
| `tests/integration/businessRules.test.ts` | Login/role/ownership checks, enrolment and drop, network restriction, builder feasibility, duration and clash rules, approval, CSV import, question versioning, review, publish, unpublished hidden, re-open |
| `tests/unit/*` | Generator (Hall check), timing, grading, question rules, focus rules, analytics, CIDR matching |

## Demo accounts

| Role | Login | Password | What to show |
|---|---|---|---|
| Admin / Registrar | `admin` | `Admin@123` | Courses, CSV enrolment, rooms, approvals (BA110 is pending), audit log, SMS outbox, dashboard |
| Lecturer | `abdirahman` | `Lecturer@123` | CS101/CS205 bank, CSV import, builder, CS205 Final analytics, blind second grader for HS120 Quiz 1 |
| Lecturer | `yusuf` | `Lecturer@123` | HS120: Quiz 1 essays to grade → publish |
| Lecturer | `ifrah` | `Lecturer@123` | BA110 |
| Invigilator | `mohamed.jama` | `Invigilator@123` | Live view of the CS101 Midterm |
| Invigilator | `sahra.ahmed` | `Invigilator@123` | HS120 exams |
| Student | `JB-24-001`, `JB-24-002` | `Student@123` | CS101 Midterm (open now), CS205 results |
| Student | `JB-24-026` | `Student@123` | HS120 Rapid Quiz (3 minutes): wait for the time to run out to show late answers rejected |

### Demo checklist

1. **Import and build:** as `abdirahman`, go to Question bank → Import questions, choose the template, preview, then save. Then Exams → New exam → add rules → Preview.
2. **Two different papers:** log in as `JB-24-001` in one browser and `JB-24-002` in a private window. Both start the CS101 Midterm and get different questions with the same difficulty mix.
3. **Tab switch:** switch tabs 3 times as a student. The warning appears, and `mohamed.jama` sees the red count in the Live view.
4. **Resume and late rejection:** reload the student page mid-exam; the same questions, answers and time come back. For late rejection, sit the 3-minute Rapid Quiz as `JB-24-026` and let the time run out.
5. **Grade, publish, analytics:** as `yusuf`, go to Exams → Quiz 1 → Grading, mark the essays, then Results → Publish. CS205 Final → Results & analytics shows flagged questions.

## Screenshots

Screenshots of the main screens go in `docs/screenshots/` (login, student exam screen, invigilator live view, exam builder, grading, analytics dashboard).

## Assumptions

* **Exam window vs extensions:** students must finish by the window end. An invigilator extension (max 15 minutes total per student) is compensation for lost time, so it may run past the window end.
* **Network grace:** answers are accepted for up to 2 s after the deadline (`DEADLINE_GRACE_SECONDS`) to absorb network delay. After that they are rejected.
* **Rooms / networks:** an exam may be started only from its rooms' network ranges plus any extra addresses. The demo data allows private campus ranges and localhost. No rooms and no addresses means any network.
* **One attempt per student per exam.** Resits are a new exam (a resit fee can be paid with the mock mobile-money screen).
* **"Correct" for analytics:** full marks on objective questions, or at least half marks on manually graded ones. Ungraded answers are excluded.
* **Pass mark** = lowest grade band that earns points (D = 60% in the seed scale).
* **Timezone:** times are stored in UTC and shown in Mogadishu time (EAT, UTC+3).
* **Student accounts from CSV** get the password in `DEFAULT_STUDENT_PASSWORD`, and an SMS (outbox) with their login ID.
* **Second grader:** optional. A second lecturer can grade essays blind; the last saved mark counts.
* **Fees** (resit $10, re-mark $5, transcript $3) are fixed in code because the brief has no fee management.
* **Simulated payment failure:** a phone number ending in `0000` returns "insufficient balance".

## Known limitations

* The JWT is kept in `localStorage`. React escapes output and there is no third-party script, but an httpOnly cookie would be stronger.
* Tab-switch detection cannot see a second device, a second monitor without a focus change, or a phone in the student's hand. It is a deterrent, not proctoring (webcam proctoring is out of scope).
* `npm audit` still lists advisories that need major upgrades: Next 16, Prisma 7, Zod 4 and Vitest 5 (Vitest is a dev-only test tool). The runtime CSV parser was upgraded. These upgrades were left for after the judged build to avoid breaking changes.
* Essay rubric marks from two graders are not averaged automatically.
* The auto-submit job runs in the API process. With several API instances it would run on each one; this is safe, because finalising is idempotent, but redundant.

## Project structure

```
backend/
  prisma/            schema.prisma, migrations/, seed.ts, seed-data.ts
  src/core/          pure exam logic (generator, timing, grading, focus, analytics, question rules)
  src/services/      business logic per area
  src/routes/        HTTP endpoints (documented at the top of each file)
  src/adapters/      sms/, payment/ (interfaces + simulated implementations)
  src/middleware/    auth (JWT + roles), rate limit, errors
  tests/             unit/ and integration/
frontend/
  src/app/           pages (App Router): (app)/... for logged-in screens, exam/[attemptId] exam screen
  src/components/    UI kit, charts, question editor, CSV import
  src/lib/           api client, auth, i18n (dictionary.ts = all Somali/English text)
docs/                API.md, DATABASE.md
```
