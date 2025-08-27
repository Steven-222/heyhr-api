# HeyHR API (Node.js + Express + MySQL)

A role-based recruitment backend with JWT auth and refresh cookies. Supports recruiter job management and candidate applications with interview scheduling.

- Tech: Express, MySQL (mysql2), Zod validation, JWT (access + httpOnly refresh cookie)
- Routes mounted at root:
  - /auth
  - /candidate
  - /recruiter and /recruiter/jobs

## Quick Start

1) Install dependencies

```bash
npm install
```

2) Configure environment

- Copy `.env.example` to `.env` and adjust values.
- Key variables (see `.env.example`):
  - PORT=3000
  - MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB
  - DB_OPTIONAL=false (start server even if DB init fails)
  - SKIP_DB=false (skip DB init entirely)
  - JWT_SECRET, REFRESH_SECRET
  - ACCESS_TOKEN_TTL=15m, REFRESH_TOKEN_TTL=7d
  - COOKIE_NAME=heyhr_refresh, COOKIE_DOMAIN=localhost, COOKIE_SECURE=false

3) Initialize database schema

- Ensure MySQL is running and a user has access to the target DB.
- Apply `db/schema.sql`:

```bash
mysql -u <user> -p -h <host> -P <port> < db/schema.sql
```

4) Run the server

```bash
# Dev (auto-reload)
npm run dev

# Prod
npm start
```

Server will log: `heyhr-api listening on http://localhost:<PORT>`.

Health check: `GET /health` => `{ ok: true }`

## Authentication

- Access token (JWT) returned on login/register; send as `Authorization: Bearer <token>`
- Refresh token is issued as an httpOnly cookie (name from `COOKIE_NAME`) and rotated by `/auth/refresh`.

Endpoints in `src/routes/auth.js`:
- POST `/auth/register` { email, password, name?, phone?, role?='CANDIDATE' }
  - Response: `{ accessToken, user }` + sets refresh cookie
- POST `/auth/login` { email, password }
  - Response: `{ accessToken, user }` + sets refresh cookie
- GET `/auth/me` Bearer required
- POST `/auth/refresh` uses refresh cookie; returns `{ accessToken, user }` and rotates cookie
- POST `/auth/logout` clears refresh cookie
- POST `/auth/change-password` Bearer required; body `{ current_password, new_password, repeat_new_password }`; clears refresh cookie

Roles: `RECRUITER` and `CANDIDATE`. Role checks are enforced by `requireRecruiter` and `requireCandidate` middlewares in route files.

## Candidate API (`src/routes/candidate.js`)

Public jobs:
- GET `/candidate/jobs?q&location&job_type&remote_flexible&limit&offset` list published jobs
  - Query: `q` (string), `location` (string), `job_type` (enum), `remote_flexible` (boolean)
  - Response: `{ jobs: [Job], total: number }`
- GET `/candidate/jobs/:id` get a published job

Profile (Candidate auth required):
- GET `/candidate/me` -> `{ user, profile }`
- PATCH `/candidate/me` update profile and optionally `name`/`phone`

Applications (Candidate auth required):
- POST `/candidate/applications`
  - Body: `{ job_id, resume_url?, cover_letter? }`
  - Creates application (source fixed as `APPLY`)
  - 409 if duplicate application
- GET `/candidate/applications?status&limit&offset`
- GET `/candidate/applications/:id` (only owner)

Notifications (Candidate auth required):
- GET `/candidate/notifications?unread_only&limit&offset` list notifications (newest first)
  - Query: `unread_only` (boolean-like: `true|false|1|0|yes|no`), `limit` (1..200), `offset` (>=0)
  - Response: `{ notifications: [Notification] }`
- GET `/candidate/notifications/:id` get single notification
  - Response: `{ notification: Notification }`
- POST `/candidate/notifications/:id/read` mark notification as read
  - Response: `{ notification: Notification }`

Notification object:
- `id`, `user_id`, `type` (string|null), `title` (string), `message` (string|null)
- `data` (JSON object|null), `read` (boolean), `read_at` (timestamp|null)
- `created_at`, `updated_at`

Example:
```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/candidate/notifications?unread_only=1&limit=20"

curl -X POST -H "Authorization: Bearer <token>" \
  "http://localhost:3000/candidate/notifications/123/read"
```

## Recruiter API (`src/routes/recruiter.js` and `src/routes/jobs.js`)

Profile:
- GET `/recruiter/me` (Recruiter auth)
- PATCH `/recruiter/me` (Recruiter auth)
- GET `/recruiter/:id` public recruiter profile
- GET `/recruiter/:id/jobs?limit&offset` public list of published jobs by recruiter

Jobs (mounted under `/recruiter/jobs`, Recruiter auth unless noted):
- POST `/recruiter/jobs` create job (status must be `DRAFT` or `PUBLISHED` on create)
  - Response: `{ id, job, path, url }`
- POST `/recruiter/jobs/autofill` (Recruiter auth)
  - Autofills job creation form from a PDF file.
  - Request: `multipart/form-data` with a `file` field containing the job description.
  - Response: A JSON object with extracted fields, e.g., `{ title, description, requirements, ... }`.
- GET `/recruiter/jobs?status&limit&offset` list own jobs
- PATCH `/recruiter/jobs/:id` update job fields (status can be updated for any job; other fields only when `status === 'DRAFT'`)
- POST `/recruiter/jobs/:id/publish` publish a draft job (transition `DRAFT` -> `PUBLISHED`)
  - Response: `{ id, job }`
- POST `/recruiter/jobs/:id/close` close a published job (transition `PUBLISHED` -> `CLOSED`)
- POST `/recruiter/jobs/:id/reopen` re-open a closed job (transition `CLOSED` -> `PUBLISHED`)
- DELETE `/recruiter/jobs/:id` delete job (any status, only when owned)
- GET `/recruiter/jobs/:id` get job by id (public)

Applications (Recruiter auth required; authorization ensures job ownership):
- GET `/recruiter/jobs/:id/applications?status&q&limit&offset` list applications for a job you own
- GET `/recruiter/jobs/:id/applications/count` get count of applications for a specific job you own
  - Response: `{ count: number }`
- GET `/recruiter/applications/count` get total count of applications across all jobs you own
  - Query params: `withStatus` (boolean-like: `true|false|1|0`) to get counts by status
  - Response: `{ count: number }` or with status: `{ total: number, applied: number, passed: number, failed: number }`
- GET `/recruiter/applications/:id` view application detail
- PATCH `/recruiter/applications/:id` update `{ status?, score?, tags?, notes? }`

Example for application count endpoints:
```bash
# Get total applications count across all jobs
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/recruiter/applications/count"

# Get applications count by status (applied, passed, failed)
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/recruiter/applications/count?withStatus=true"

# Get applications count for a specific job
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/recruiter/jobs/123/applications/count"
```

Notifications (Recruiter auth required):
- GET `/recruiter/notifications?unread_only&limit&offset` list notifications
  - Query: `unread_only` (boolean-like: `true|false|1|0|yes|no`), `limit` (1..200), `offset` (>=0)
  - Response: `{ notifications: [Notification] }`
- GET `/recruiter/notifications/:id` get single notification
  - Response: `{ notification: Notification }`
- POST `/recruiter/notifications/:id/read` mark notification as read
  - Response: `{ notification: Notification }`

Notification object (same as Candidate):
- `id`, `user_id`, `type`, `title`, `message`, `data`, `read`, `read_at`, `created_at`, `updated_at`

Example:
```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/recruiter/notifications?unread_only=true"

curl -X POST -H "Authorization: Bearer <token>" \
  "http://localhost:3000/recruiter/notifications/456/read"
```

## Notification Triggers

- Candidate application submitted:
  - Candidate receives `type: "APPLICATION"` with data `{ job_id, application_id, path: "/candidate/applications/:id" }`
  - Recruiter receives `type: "APPLICATION"` with data `{ job_id, application_id, candidate_id, path: "/recruiter/applications/:id" }`
- Recruiter updates application status:
  - Candidate receives `type: "APPLICATION_STATUS_UPDATE"` with data `{ applicationId, jobId }`
- Job published (either created as `PUBLISHED` or via publish endpoint):
  - Recruiter receives `type: "JOB"` with data `{ job_id, path: "/recruiter/jobs/:id" }`

Notes: notifications are created asynchronously (fire-and-forget) and do not block API responses.

## Response URLs

Some endpoints return `{ path, url }`. The `url` is constructed using `x-forwarded-proto`/`x-forwarded-host` or request host for compatibility behind proxies.

## Error Handling

- Validation errors return 400 with `{ error: 'ValidationError', issues }`
- Auth/role issues return 401/403
- Not found returns 404
- Conflicts (e.g., duplicate application) return 409

## Development Notes

- Input validation via Zod keeps payloads consistent and secure.
- Role-based access enforced by JWT payload role checks in middleware.
- DB JSON columns are used for some structured fields (e.g., job skills, responsibilities, candidate education/experience).

## Contributing & Updating Docs

- When adding or changing an API route:
  1. Update or add validation schemas (Zod) in the route file.
  2. Enforce role checks (`requireRecruiter`/`requireCandidate`).
  3. Update this README: add/modify the endpoint under the correct section with a brief description and request/response notes.
  4. If the DB schema or accessors change, reflect it in `db/schema.sql` and document it here.
  5. Add curl examples if behavior is non-trivial.
  - Suggested convention: include `Docs:` in your commit message when README is updated.

## Seed sample data

- Ensure MySQL is running and `.env` is configured (MYSQL_* vars). The DB will be created if missing.
- Optional: set `SEED_PASSWORD` in `.env` to control the seeded users' password (default: `Passw0rd!`).

Run:

```bash
npm run seed
```

Creates:
- Users (password = `SEED_PASSWORD` or `Passw0rd!`):
  - Recruiters: `rec1@heyhr.test`, `rec2@heyhr.test`
  - Candidates: `cand1@heyhr.test`, `cand2@heyhr.test`
- Jobs:
  - (rec1) Software Engineer — PUBLISHED, auto_offer=true
  - (rec1) QA Engineer — DRAFT
  - (rec2) Data Analyst — PUBLISHED
- Applications:
  - Software Engineer: cand1, cand2
  - Data Analyst: cand2
- Interview:
  - For cand1 on Software Engineer @ `2025-08-30 09:00:00` (60min)

Notifications:
- Candidates:
  - cand1: "Application received" (Software Engineer)
  - cand2: "Application received" (Software Engineer)
  - cand2: "Application received" (Data Analyst)
- Recruiters:
  - rec1: "New application" (cand1 -> Software Engineer)
  - rec1: "New application" (cand2 -> Software Engineer)
  - rec2: "New application" (cand2 -> Data Analyst)

Seeding is idempotent; rerunning will not duplicate notifications.

## Scripts

- `npm run dev` – start with nodemon
- `npm start` – start server
- `npm run pm2` – start via PM2 (if configured)

## File Structure

- `src/server.js` – app setup and route mounts
- `src/routes/` – express routers: `auth.js`, `candidate.js`, `recruiter.js`, `jobs.js`
- `src/utils/` – helpers for JWT and password
- `db/schema.sql` – MySQL schema

## License

Proprietary (adjust as needed).
