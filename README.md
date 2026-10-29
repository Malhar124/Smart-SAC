# Smart SAC

The equipment counter at IIIT Allahabad's Student Activity Center, online. Students see what's free before they walk over, reserve it for 15 minutes, book rooms, find people to play with and report problems. Desk staff lend and take back equipment in a few keystrokes, see what's overdue, manage rooms and answer tickets.

Developed as a DBMS group project.

---

## Features

### Students
- **Sign up with an institute email.** Only `@iiita.ac.in` addresses; the email is confirmed with a 6-digit code before the first sign-in. The roll number comes from a student email (`iit2023001@…` is `IIT2023001`) and can't be changed afterwards, because loans and borrowing blocks are kept by it.
- **Equipment rack.** Every item with its state: free, held, out (with who has it and when it's due back) or broken. Updates live.
- **Reservations.** Hold a free item for 15 minutes, one at a time, then collect it at the desk. Reminders before a hold ends.
- **Due times and reminders.** Each loan has a due time; students get a reminder 15 minutes before and a notice if it goes overdue.
- **Borrowing standing.** Late returns are counted over 30 days (returns within 10 minutes of the due time don't count). Three late returns, or any overdue item, pause borrowing for a week, and the student can see why.
- **Rooms.** Book the music room, drama room and others in whole-hour slots, up to two hours at a time and a week ahead.
- **Busy times.** How many items are out at each hour of a typical day, calculated from real checkouts, per game.
- **Tickets.** Report broken equipment or ask for new equipment, then follow a timeline of status changes and replies from the desk.
- **Chat and Find players.** Message other students, see unread counts and read receipts, and find people by the games they play.
- **Notifications.** In-app notifications for holds, due times, ticket replies, room changes and announcements.

### Desk staff
- **Desk dashboard.** Overdue loans first (with phone numbers), then counts and the full equipment register.
- **Lend & return.** Keyboard-first: scan or type a roll number (USB barcode scanners work as-is, or use the webcam), see the student's standing and loans, pick an item, press 1 to 4 for a duration, press Enter. Students with a block can be lent to only with a recorded override.
- **Equipment.** Games and their items: add, remove, mark broken or fixed.
- **Rooms.** See bookings with who made them, close a room, cancel a booking with a reason (the student is notified).
- **Tickets.** Filter by status, search, reply and change status with a note to the student.
- **History.** Every status change for every item, with the staff member who made it.
- **Command palette.** Ctrl+K (Cmd+K on a Mac) to find any item, student, room or ticket, or jump to a page.

---

## Tech stack

| Layer | Choices |
|---|---|
| Frontend | React 18, TypeScript (strict), Vite, Tailwind CSS, shadcn/ui on Radix, TanStack Query, Zod, Recharts |
| Backend | Node.js 20, Express 5, Prisma 7 with PostgreSQL 16, Zod validation, OpenAPI docs (Swagger UI), pino logs, node-cron |
| Live updates | Server-Sent Events (`GET /api/v1/events`) |
| Auth | httpOnly JWT cookies; one session per device with rotating, hashed refresh tokens; separate student and staff roles |
| Quality | Vitest + Supertest (backend, against a real database), Vitest + Testing Library (frontend), ESLint, GitHub Actions |
| Operations | Docker images, docker-compose for the full stack, Prisma migrations, optional Sentry on both ends |

---

## Run it locally

### Prerequisites
- Node.js 20 or newer
- Docker Desktop (for PostgreSQL), or your own PostgreSQL 16

### 1. Database
```bash
cd backend
npm install
npm run db:up                 # PostgreSQL in Docker on localhost:5432
cp .env.example .env          # then fill in the secrets (see below)
npm run db:deploy             # apply the migrations
```

### 2. Demo data (optional)
```bash
npm run seed                  # 24 students, 31 items, 4 weeks of checkouts, rooms, tickets
```
The seed refuses to run on a database that already has accounts; use `npm run seed -- --yes` to replace everything. Demo sign-ins (password `Demo@1234` for both):

| | Email |
|---|---|
| Student | `iit2023001@iiita.ac.in` |
| Staff | `desk@iiita.ac.in` |

### 3. Backend
```bash
npm run dev                   # http://localhost:8000, API docs at http://localhost:8000/api/docs
```

### 4. Frontend
```bash
cd ../frontend
npm install
cp .env.example .env.local    # VITE_API_BASE_URL=http://localhost:8000/api/v1
npm run dev                   # http://localhost:5173
```

### Email in development
Leave `EMAIL_USER` / `EMAIL_PASS` empty and verification and reset codes are printed in the backend log instead of emailed. For real email with Gmail, use an [App Password](https://support.google.com/accounts/answer/185833).

### Staff accounts
Staff aren't created through sign-up. Add the email to `ADMIN_EMAILS` in `backend/.env`, then register at `/admin/register`: a 6-digit code goes to that address, and the password is set only with it. Removing an email from the list signs that account out and stops it signing in again.

### Updating an existing database
`npm run db:deploy` applies new migrations. After the October 2026 ones everyone signs in again once (sessions became per-device), and the migration stops if two accounts share a roll number: decide which account owns it and fix the other first.

---

## Run the whole stack in Docker

```bash
docker compose up --build     # http://localhost:8080
```
This builds the API and web app, runs the migrations and seeds demo data into its own database volume (it never touches the development database above). nginx serves the app and proxies `/api`, including the live-updates stream. Set real secrets in a `.env` file next to `docker-compose.yml` for anything beyond a local demo.

---

## Configuration

Backend settings are validated at startup (`backend/src/config/env.js`); the server refuses to start with a missing or, in production, short secret. See `backend/.env.example` for every option.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET` | Token signing secrets (`openssl rand -hex 32`) |
| `ACCESS_TOKEN_EXPIRY`, `REFRESH_TOKEN_EXPIRY` | Session lengths (default 15m and 10d; the app refreshes silently) |
| `CORS_ORIGIN` | Comma-separated frontend origins; the only other sites allowed to make changes (see Security) |
| `ADMIN_EMAILS` | Emails that may be staff accounts; removing one takes away its access |
| `SMTP_HOST`, `SMTP_PORT`, `EMAIL_USER`, `EMAIL_PASS` | Outgoing email |
| `SPORTS_HEAD_EMAIL` | Receives new tickets by email |
| `APP_TIMEZONE` | The SAC's time zone (default `Asia/Kolkata`) |
| `SENTRY_DSN` | Optional error tracking |

Frontend: `VITE_API_BASE_URL`, `VITE_APP_TIMEZONE`, and optional `VITE_SENTRY_DSN` and `VITE_SITE_URL` (absolute URL for link previews; Vercel builds use the production URL if unset). See `frontend/.env.example`.

---

## Scripts

| Backend (`backend/`) | |
|---|---|
| `npm run dev` | API with auto-reload |
| `npm test` | Test suite against `TEST_DATABASE_URL` (wiped on every run) |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Create a migration after changing `prisma/schema.prisma` |
| `npm run db:deploy` | Apply pending migrations |
| `npm run seed` | Demo data |

| Frontend (`frontend/`) | |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | Unit and component tests |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run build` | Production build |

The backend tests need a separate database, by default `smart_sac_test` on the local PostgreSQL:
```bash
docker exec smart-sac-postgres psql -U smartsac -d postgres -c "CREATE DATABASE smart_sac_test"
```

---

## API

Every route is validated with Zod, and the same schemas generate the OpenAPI document:
- Swagger UI: `http://localhost:8000/api/docs`
- OpenAPI JSON: `http://localhost:8000/api/openapi.json`
- Health check: `http://localhost:8000/api/health`

Responses use one envelope, `{ statusCode, success, message, data }`; errors are `{ success: false, message, errors[] }` with one entry per invalid field.

---

## Project structure

```
backend/
  prisma/              schema and migrations
  src/
    config/            validated settings and SAC rules (policy.js)
    controllers/       HTTP handlers
    services/          business rules: lending, standing, rooms, tickets, usage, notifications
    routes/            routes with their Zod schemas (also the API docs)
    jobs/              reminders, overdue notices, hold expiry, cleanup
    lib/               logger, live events, OpenAPI, time zones
  tests/               API tests against a real database
frontend/
  src/
    pages/             one file per screen (each loaded on demand)
    components/        shared UI, including the court band, rack and command palette
    context/           auth and live updates
    lib/               API client, schemas, formatting, types
docker-compose.yml     the full stack
```

---

## Rules at a glance

Defined once in `backend/src/config/policy.js`:

| Rule | Value |
|---|---|
| Reservation hold | 15 minutes, one at a time |
| Lend duration | 15 minutes to 8 hours |
| Late-return grace | 10 minutes |
| Borrowing block | 3 late returns in 30 days, for 7 days; or while anything is overdue |
| Room bookings | Whole hours, 6:00 to 22:00, up to 2 hours, up to 7 days ahead, 2 upcoming per student; the hour under way can still be booked |
| Email codes | 6 digits, 5 tries per code, a new code at most once a minute; sign-up codes last 24 hours, reset codes 10 minutes |
| Unconfirmed sign-ups | Hold nothing (a newer sign-up with the same email, username, phone or roll number replaces them) and are deleted when their code expires |
| Retention | History and notifications 90 days; sessions end 10 days after their last refresh |

---

## Security

- **Sessions.** Every sign-in is a row in `Session`; only a SHA-256 hash of its refresh token is stored. Each refresh replaces the token, and replaying an old one ends the session. Access tokens name their session, so signing out, a password change (other devices) or reset (all devices), or removal from `ADMIN_EMAILS` takes effect at once. The web app refreshes under a Web Lock so two tabs never send the same token.
- **Cross-site requests.** Production cookies are `SameSite=None` (the app and API can be on different sites), so the API accepts only JSON bodies and refuses changes whose `Origin` isn't in `CORS_ORIGIN` or the API's own host.
- **Codes and sign-in.** Rate limits per address on sign-in, sign-up and code endpoints, plus the per-code attempt limit above (counted before comparing, so parallel guesses are capped). Sign-in and code responses don't reveal which emails have accounts.
