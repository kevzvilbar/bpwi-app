# BPWI Monitoring (Next.js + Supabase + Vercel)

## Setup
1. Create a Supabase project; run `supabase/migrations/001_init.sql` in the SQL editor.
2. Also run `supabase/migrations/002_auto_profile.sql`. Then sign up on the app's login page: the **first** user automatically becomes `admin` (and the organization is created); later sign-ups join as read-only `viewer` and can be promoted by an admin (`update user_profiles set role='scheduler' where id=...`). The manual bootstrap SQL in 001 is no longer needed.
3. `cp .env.example .env.local`, fill in the keys, `npm install`, `npm run dev`.
4. Import your data: in the old HTML app use **Export JSON**, then (logged in as admin):
   `curl -X POST http://localhost:3000/api/import -H "Content-Type: application/json" -H "Cookie: <your session cookie>" --data @backup.json`
   (or call it from a small admin page). Re-running is safe.
5. Deploy: import the repo in Vercel, add the three env vars (`SUPABASE_SECRET_KEY` server-only).

## Department heads (migrations 007, 008 & 009)
Run `007_manager_role.sql` **on its own first** (PostgreSQL cannot use a new enum value in the transaction that adds it), then `008_department_heads.sql`, followed by `009_change_requests.sql`.

- Give a user the **department head** role (`manager`) under Operators & Setup → Users & roles. They are login-only and do not appear on the roster.
- **Two Operating Modes:**
  1. **Direct Edit Mode (Active Edit Window):** Under Setup → **Department heads**, an admin can grant a time-limited edit window (e.g. 24–72 hours, max 14 days, with optional schedule date range limits). During an active window, edits save directly to schedule tables like a scheduler.
  2. **Propose Mode (Default outside windows):** Edits made outside a window queue into a draft change request. On the monthly roster, proposed edits appear as dashed cells (`.cell-pending`) with amber corner markers. Department heads see a floating bar showing queued changes and click **Submit for Approval** with an optional note.
- **Review & Approval Queue (`/requests`):**
  - Admins and delegated approvers (`can_approve = true`) review proposals before-and-after diffs with conflict detection.
  - If a cell changed after a proposal was drafted, it is flagged with a warning (`⚠️ Live conflict`) instead of being silently overwritten.
  - Approvers can **Approve All**, **Approve Selected**, or **Reject** with a recorded reason. Approval applies atomically in a single Postgres transaction (`approve_change_request`).
- **Escalation Contacts:** Department heads appear on the **Call Sheet** under *Management escalation* with direct call and SMS buttons.

## Daily Employee Activity Monitoring (migrations 010 & 011)
Run `supabase/migrations/010_daily_activities.sql` and `supabase/migrations/011_job_orders_and_handovers.sql` in the SQL editor.

- **Who can log (`operator` + `admin` only):** Only active `operator` and `admin` roles can submit daily field activity logs (enforced via Postgres RLS on `daily_activities` and UI gating). Operators can tag co-operators (`crew_operator_ids`) so all crew members receive activity credit.
- **Schedule & Setup Integration:** Stations/areas link directly to `area_codes` configured in Operators & Setup (no hardcoded legacy facilities). Opening the activity logger on `/mobile` or `/activities` auto-fills the operator's roster shift, assigned area, and same-shift co-operators.
- **Mobile Field Logger (`/mobile`):** Supports 20 water utility activity types with dynamic telemetry forms (Genset fuel, Pump pressure/flow, Flushing blow-offs, 3-trial volumetric Meter Test ±5% calculator + witness signature, Leak Repair materials, Water Hauling trips, and Water Sampling), GPS capture, and IndexedDB offline queue auto-sync.
- **30-Day Photo Retention (`activity-media`):** Uploaded photos are compressed client-side before upload to Supabase Storage and carry a 30-day expiration (`photos_expires_at`). Calling `POST /api/activities/purge-photos` (or clicking **Purge Expired Photos (>30d)** in `/activities`) removes expired photo objects while preserving the text and telemetry logs.
- **Monitoring Hub (`/activities`):**
  - **Duty & Activity Feed:** Reconciles today's on-duty schedule against logged activities and PMs, highlights idle on-duty operators (`0 logs`), and provides supervisor verification (`verify` / `flag`) plus printable Field Activity Reports & Meter Test Certificates.
  - **Job Orders & Shift Handovers:** Dispatches job orders with 12-digit utility account auto-parsing, Turnaround Time (TAT) / SLA tracking, end-of-shift handovers, and a Daily Operations Huddle Brief.
  - **Employee KPIs & Fuel:** 7/30/90-day scorecards combining roster duty hours, field activities, PM compliance %, Job Order TAT, and genset fuel telemetry.

## Included (v1 core)
Login, role-aware monthly roster with click-to-paint (admin/scheduler), RLS, audit triggers, realtime-ready tables, JSON importer.
Also: Daily Activity Monitor (`/activities`), PM Planner (`/pm`: monthly/week calendar, recurring series, editable activity names/colors, `.ics` export), Leave Summary (`/leave`), Call Sheet (`/call-sheet`), Mobile/Tasks (`/mobile`), Generate Schedule (`/generate`: repeating shift cycles), Operators & Setup (`/operators`, admin only: operators, shift types, area/leave codes, users & roles), OC standby painting, drag-to-paint, Ctrl+Z/Ctrl+Y undo/redo, Ctrl+C/Ctrl+V copy/paste, realtime sync, CSV/print exports, PWA offline support.
