# BPWI Monitoring (Next.js + Supabase + Vercel)

## Setup
1. Create a Supabase project; run `supabase/migrations/001_init.sql` in the SQL editor.
2. Also run `supabase/migrations/002_auto_profile.sql`. Then sign up on the app's login page: the **first** user automatically becomes `admin` (and the organization is created); later sign-ups join as read-only `viewer` and can be promoted by an admin (`update user_profiles set role='scheduler' where id=...`). The manual bootstrap SQL in 001 is no longer needed.
3. `cp .env.example .env.local`, fill in the keys, `npm install`, `npm run dev`.
4. Import your data: in the old HTML app use **Export JSON**, then (logged in as admin):
   `curl -X POST http://localhost:3000/api/import -H "Content-Type: application/json" -H "Cookie: <your session cookie>" --data @backup.json`
   (or call it from a small admin page). Re-running is safe.
5. Deploy: import the repo in Vercel, add the three env vars (`SUPABASE_SECRET_KEY` server-only).

## Included (v1 core)
Login, role-aware monthly roster with click-to-paint (admin/scheduler), RLS, audit triggers, realtime-ready tables, JSON importer.
Also: PM Planner (`/pm`: monthly calendar, recurring series, status), Leave Summary (`/leave`), Generate Schedule (`/generate`: repeating shift cycles), Operators & Setup (`/operators`, admin only: operators, shift types, area/leave codes), OC standby painting, CSV/print exports.
## Not yet ported
Call sheet, in-app user/role admin screens (promote users via SQL: `update user_profiles set role='scheduler' where id=...`).
