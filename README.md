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
  - If a target changed after a proposal was drafted (schedule, standby, PM task or leave), the row is flagged `⚠️ Changed since proposed` and shows the **live value**. A proposal on a previously empty cell conflicts if someone filled it meanwhile. If a PM task / leave record was deleted, the row reads `Target no longer exists`.
  - **Approve all / non-conflicting** applies everything that is safe and leaves conflicts open. **Review & override…** on a conflict row shows original vs. live vs. proposed and requires confirmation; overriding a deleted target discards the item (it is never recreated).
  - Partial flow: **Approve selected**, **Reject selected**, or **Reject remaining**, each with an optional note/reason; notes accumulate across batches and the requester is notified of each. Each call is one Postgres transaction (`approve_change_request`, row-locked so two approvers cannot double-apply), and the screen always sends explicit item ids.
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

## Routing and map tiles
Route visualization in **Activities → Footprints & Routes** and map pin picking in **Activity Logger / Base HQ** support self-hosted OSRM routing and custom XYZ tile servers via environment variables (see [`.env.example`](.env.example)):

- `OSRM_BASE_URL`: Base URL of your self-hosted OSRM router (e.g. `https://osrm.internal.example.com`). When set, `/api/routes/compute` exclusively routes through that server.
- `ALLOW_PUBLIC_OSRM_FALLBACK`: Defaults to `false`. In `production`, when `OSRM_BASE_URL` is unset and `ALLOW_PUBLIC_OSRM_FALLBACK` is not `'true'`, `/api/routes/compute` does not call public demo OSRM servers and instead returns straight-line Haversine leg distances. Set to `'true'` only if non-critical public demo fallback is intended.
- `NEXT_PUBLIC_MAP_STREET_TILE_URL` & `NEXT_PUBLIC_MAP_STREET_ATTRIBUTION`: Custom `{z}/{x}/{y}` street tile template and HTML attribution. When unset, the map falls back to `tile.openstreetmap.org` and displays an admin-only notice on the map.
- `NEXT_PUBLIC_MAP_SATELLITE_TILE_URL` & `NEXT_PUBLIC_MAP_SATELLITE_ATTRIBUTION`: Custom `{z}/{x}/{y}` satellite tile template and attribution. When unset, Satellite mode falls back to Esri World Imagery and displays an admin-only notice on the map.
- **Shared Route Cache & Rate Limits (migration `028`):** Apply `supabase/migrations/028_route_compute_store_and_pm_sub_limit.sql` so `/api/routes/compute` shares route caching (30 min TTL) and per-user rate limits (60 req / 5 min total, 20 upstream req / 5 min) across serverless instances via Postgres RPCs, falling back to per-instance memory if `028` has not yet been applied.

## Included (v1 core)
Login, role-aware monthly roster with click-to-paint (admin/scheduler), RLS, audit triggers, realtime-ready tables, JSON importer.
Also: Daily Activity Monitor (`/activities`), PM Planner (`/pm`: monthly/week calendar, recurring series, editable activity names/colors, `.ics` export), Leave Summary (`/leave`), Call Sheet (`/call-sheet`), Mobile/Tasks (`/mobile`), Generate Schedule (`/generate`: repeating shift cycles), Operators & Setup (`/operators`, admin only: operators, shift types, area/leave codes, users & roles), OC standby painting, drag-to-paint, Ctrl+Z/Ctrl+Y undo/redo, Ctrl+C/Ctrl+V copy/paste, realtime sync, CSV/print exports, PWA offline support.
