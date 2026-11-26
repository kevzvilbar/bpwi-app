# BPWI Monitoring (Next.js + Supabase + Vercel)

## Setup
1. Create a Supabase project and apply migrations via Supabase CLI (recommended default):
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
   (Or run `supabase/migrations/001_init.sql` through `040_field_integrity_and_inventory_hardening.sql` in ascending order in the SQL Editor; see [`supabase/migrations/README.md`](supabase/migrations/README.md).)
2. Bootstrap the organization and initial admin (sign-ups never auto-promote to `admin`):
   - First, initialize the organization in the Supabase SQL Editor:
     ```sql
     select bootstrap_initial_org_admin('BP Waterworks, Inc.');
     ```
   - Create or invite the owner account in **Supabase Auth → Users**, then promote that user as the active admin:
     ```sql
     select bootstrap_initial_org_admin('BP Waterworks, Inc.', 'owner@bpwaterworks.com', 'Owner Name');
     ```
3. `cp .env.example .env.local`, fill in the keys, `npm install`, `npm run dev`.
4. Import legacy data (admin session cookie required; payload validated at runtime):
   `curl -X POST http://localhost:3000/api/import -H "Content-Type: application/json" -H "Cookie: <your session cookie>" --data @backup.json`
   Re-running is safe (idempotent upsert).
5. Deploy: import the repo in Vercel and configure env vars (`SUPABASE_SECRET_KEY` server-only, `CRON_SECRET` for scheduled photo/cache purges). Self sign-up is enabled by default so staff can register with their employee name and wait for admin validation (`role = 'viewer'`, `is_active = false`); set `NEXT_PUBLIC_ALLOW_PUBLIC_SIGNUP=false` and disable **Allow new users to sign up** in Supabase Authentication settings for invite-only deployments, or enable **Confirm email** and configure **Sign-Up Access & Domain Allowlist** in **Operators & Setup → Users & roles** (`organizations.allowed_signup_domains`, migrations `030`–`032`). Enforce strong passwords (minimum 12 characters on sign-up/reset; set Supabase Auth minimum password length to 12 as well). Per-request nonce CSP headers are applied in [`middleware.ts`](middleware.ts).

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
- **30-Day Photo Retention (`activity-media`) & 24h Sample Logs:** Uploaded photos are compressed client-side before upload to Supabase Storage and carry a 30-day expiration (`photos_expires_at`). Calling `POST /api/activities/purge-photos` (or clicking **Purge Expired Photos (>30d)** in `/activities`) removes expired photo objects while preserving the text and telemetry logs, and also sweeps expired 24-hour `is_sample` logs/photos across `daily_activities`, `job_orders`, `shift_handovers`, and `accomplishment_reports` (migration `034`). Sample logs are excluded from KPIs/reports/audit logs and visible only to their creator and admins for 24 hours. **Department heads can create, edit and delete sample logs only; real activity logs, job orders, handovers and accomplishment reports are read-only for them** (they can still verify/flag activities and check/return reports). Expired samples are deleted in SQL by the hourly `pg_cron` job (or the daily `/api/activities/purge-photos` cron as a fallback); their photo files are queued in `sample_photo_cleanup` and removed by that route, and admins see a warning banner on `/activities` if cleanup is overdue (migration `035`).
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
- **Shared Route Cache & Rate Limits (migrations `028` & `029`):** Apply `supabase/migrations/028_route_compute_store_and_pm_sub_limit.sql` and `029_harden_route_compute_store.sql` and ensure `SUPABASE_SECRET_KEY` is configured on the server so `/api/routes/compute` shares organization-scoped, size-bounded route caching (30 min TTL) and fixed per-user rate limits (60 req / 5 min total, 20 upstream req / 5 min) across serverless instances via `service_role`-only Postgres RPCs (swept automatically by `/api/activities/purge-photos`). If `SUPABASE_SECRET_KEY` or `029` is missing, `/api/routes/compute` logs a server warning, surfaces an admin banner on the Routes tab, and falls back to per-instance memory.

## Included (v1 core)
Login, role-aware monthly roster with click-to-paint (admin/scheduler), RLS, audit triggers, realtime-ready tables, JSON importer.
Also: Daily Activity Monitor (`/activities`), PM Planner (`/pm`: monthly/week calendar, recurring series, editable activity names/colors, `.ics` export), Leave Summary (`/leave`), Call Sheet (`/call-sheet`), Mobile/Tasks (`/mobile`), Generate Schedule (`/generate`: repeating shift cycles), Operators & Setup (`/operators`, admin only: operators, shift types, area/leave codes, users & roles), OC standby painting, drag-to-paint, Ctrl+Z/Ctrl+Y undo/redo, Ctrl+C/Ctrl+V copy/paste, realtime sync, CSV/print exports, PWA offline support.

## Documentation
- [System & Security Architecture (`docs/ARCHITECTURE.md`)](docs/ARCHITECTURE.md) — App Router layout, defense-in-depth Postgres/CSP architecture, RBAC role matrix, and operations/DR runbook.
- [Privacy & Data Retention (`docs/PRIVACY_AND_RETENTION.md`)](docs/PRIVACY_AND_RETENTION.md) — RA 10173 data inventory, 24h/30d/365d retention & scrubbing schedules, and admin execution guide.
- [Supabase Migrations Index (`supabase/migrations/README.md`)](supabase/migrations/README.md) — Ordered migration guide (`001`–`040`) and RLS test conventions.
