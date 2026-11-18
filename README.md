# BPWI Monitoring (Next.js + Supabase + Vercel)

## Setup
1. Create a Supabase project; run `supabase/migrations/001_init.sql` in the SQL editor.
2. Also run `supabase/migrations/002_auto_profile.sql`. Then sign up on the app's login page: the **first** user automatically becomes `admin` (and the organization is created); later sign-ups join as read-only `viewer` and can be promoted by an admin (`update user_profiles set role='scheduler' where id=...`). The manual bootstrap SQL in 001 is no longer needed.
3. `cp .env.example .env.local`, fill in the keys, `npm install`, `npm run dev`.
4. Import your data: in the old HTML app use **Export JSON**, then (logged in as admin):
   `curl -X POST http://localhost:3000/api/import -H "Content-Type: application/json" -H "Cookie: <your session cookie>" --data @backup.json`
   (or call it from a small admin page). Re-running is safe.
5. Deploy: import the repo in Vercel, add the three env vars (`SUPABASE_SECRET_KEY` server-only).

## Department heads (migrations 007 + 008)
Run `007_manager_role.sql` **on its own first** (PostgreSQL cannot use a new enum value in the transaction that adds it), then `008_department_heads.sql`.

- Give a user the **department head** role under Operators & Setup → Users & roles. They are not added to the roster.
- Department heads are **read-only by default**. Under Setup → **Department heads**, an admin opens an *edit window* (start/end time in Manila time, optionally limited to a date range, max 14 days). Inside it they can change schedule, standby, leave and PM tasks directly; outside it they are read-only again. Windows are enforced by the database (row-level security, using the server clock), can be revoked at any time, and every change is recorded in the Activity log under their name.
- Department heads with an active account appear on the **Call Sheet** as escalation contacts (set their job title and phone in the same tab).
- *Delegated approvers*: admins can mark other users as approvers (`user_profiles.can_approve`). This is groundwork for the approval queue and has no effect yet.

## Included (v1 core)
Login, role-aware monthly roster with click-to-paint (admin/scheduler), RLS, audit triggers, realtime-ready tables, JSON importer.
Also: PM Planner (`/pm`: monthly/week calendar, recurring series, editable activity names/colors, `.ics` export), Leave Summary (`/leave`), Call Sheet (`/call-sheet`), Mobile/Tasks (`/mobile`), Generate Schedule (`/generate`: repeating shift cycles), Operators & Setup (`/operators`, admin only: operators, shift types, area/leave codes, users & roles), OC standby painting, drag-to-paint, Ctrl+Z/Ctrl+Y undo/redo, Ctrl+C/Ctrl+V copy/paste, realtime sync, CSV/print exports, PWA offline support.
