# Student Attendance Tracker

A small React + Supabase app for tracking student attendance (TY CE). Built with Vite, React, TypeScript and Tailwind (shadcn UI primitives).

## Quick summary
- Track attendance per student per subject.
- Mark attendance from the Dashboard (one click per lecture).
- View attendance history and per-subject percentages on the Profile page.
- Uses Supabase (Postgres) for auth, storage and realtime updates.

## Table of contents
- Features
- Tech stack
- Repository layout
- Local development
- Database & Supabase notes
- How the app works
- Troubleshooting
- Next steps / TODOs

---

## Features
- One-click attendance marking from a subject card.
- Attendance history table with delete (student can remove own attendance).
- Attendance summary with per-subject percentage calculated against a predefined lecture total per group (TY CE-1 / TY CE-2 / TY CE-3).
- Realtime updates: Profile listens for attendance table changes and refreshes automatically.

## Tech stack
- Frontend: React + TypeScript + Vite
- UI: Tailwind CSS + shadcn-inspired components
- Database & Auth: Supabase (Postgres, Row-Level Security, realtime)

## Repository layout
Important files and folders:

- `src/` — application source code
  - `pages/Dashboard.tsx` — subject cards and attendance marking logic
  - `pages/Profile.tsx` — profile, attendance history, summary, delete logic and realtime subscription
  - `integrations/supabase/client.ts` — supabase client used across the app
  - `components/ui/*` — UI primitives (buttons, table, dialogs, select, etc.)

- `supabase/migrations/` — SQL migrations used to create tables + policies
  - migrations include `attendance` and `profiles` table creation and policies for SELECT/INSERT. Note: a DELETE policy may need to be added (see Database & Supabase notes below).

- `index.html`, `src/index.css` — base HTML and styles
- `package.json` — scripts and dependencies

## Local development

Prerequisites:
- Node.js (recommended v18+)
- npm (or yarn/pnpm)

Install dependencies:

```powershell
npm install
```

Run the development server:

```powershell
npm run dev
```

Build for production:

```powershell
npm run build
```

Preview production build:

```powershell
npm run preview
```

## Environment & Supabase configuration

The project uses Supabase for auth and the DB. The repo contains a generated `src/integrations/supabase/client.ts` that currently initializes the client with a URL and publishable (anon) key.

Recommended approach for production / portable setup:

1. Create a Supabase project and copy the `URL` and `ANON` key from the project settings.
2. Replace the client initialization to read from environment variables instead of hard-coded values. Example:

```ts
// src/integrations/supabase/client.ts
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
```

3. For local development with Vite, set `.env` or `.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

## Database schema (high level)

Tables used:

- `profiles` — additional user metadata (id, user_id -> auth.users(id), name, timestamps)
- `attendance` — attendance records
  - `id` (uuid PK)
  - `student_id` (uuid, references auth.users)
  - `subject` (text) — stored as short codes on the frontend (e.g. `CN`, `ADA`, `SE`, `CPDP`, `CS/PYTHON`, `PE`)
  - `date` (date)
  - `created_at`

Policies and migrations:
- RLS is enabled on both `profiles` and `attendance` tables. Migrations in `supabase/migrations/` create policies for SELECT and INSERT on `attendance` and policies for profiles. If users need to be able to DELETE their own attendance from the UI, make sure a DELETE policy exists for `attendance`:

```sql
CREATE POLICY "Students can delete their own attendance"
ON public.attendance
FOR DELETE
USING (auth.uid() = student_id);
```

Also note: the project originally used a unique constraint/index to prevent duplicate attendance for the same student/subject/date:

```sql
CREATE UNIQUE INDEX idx_attendance_unique_daily ON public.attendance(student_id, subject, date);
```

Remove or change that index if you want to allow multiple marks per day.

## How the app works 

- Dashboard: shows subject cards (subject codes like `CN`, `ADA`). Clicking a card opens a confirmation dialog and writes a row to `attendance` with the `student_id`, `subject` (code), and `date`.
- Profile: fetches `profiles` and `attendance` rows for the current user. Attendance summary is calculated by mapping stored short subject codes to the full subject names used by the internal `SUBJECT_TOTALS` table in the code and computing percentages as `attended / total * 100`.
- Realtime: `Profile.tsx` subscribes to Postgres changes (in `attendance` filtered by `student_id`) and refetches when events occur. Deletions from the UI perform a DB delete and then refresh.

## Important implementation notes

- Subject mapping: the app stores short codes (`CN`, `ADA`, ...). The Profile page maps those codes to the full subject keys used for lecture totals. If users mark attendance with inconsistent subject strings, mapping/normalization may be required (trim/uppercase) to ensure counts match.
- Deleting attendance: the UI does an immediate local-state removal for snappy feedback then refetches data from the DB.
- Realtime: depends on Supabase realtime (postgres_changes) being enabled for the project and proper DB permissions.

## Troubleshooting

- Attendance disappears on refresh: ensure the delete call actually completed and that a Delete policy exists in Supabase RLS. Check browser console for Supabase `delete` responses and `fetch` logs.
- Realtime events not received: verify Supabase project settings allow realtime and the `public.*` schema is replicated. Also confirm the client is using a valid anon key.

## Next steps / improvements

- Persist the selected `group` into the `profiles` table and load it on login so the user doesn't have to reselect each session.
- Normalize subject strings before storing to avoid mismatches.
- Add tests and CI for migrations and basic UI flows.
- Improve mobile responsiveness & accessibility across all pages (some improvements exist in `src/index.css` and `Profile.tsx`).

## Contributing

1. Fork the repo and create a feature branch.
2. Run `npm install` and `npm run dev` to test locally.
3. Open a PR describing changes; include migration SQL if DB schema changes are required.

---



