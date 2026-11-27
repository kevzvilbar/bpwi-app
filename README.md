# BPWI Monitoring (Next.js + Supabase + Vercel)

## Setup
1. Create a Supabase project and apply migrations via Supabase CLI (recommended default):
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
   (Or run `supabase/migrations/001_init.sql` through `042_photo_storage_retention_and_jo_rls.sql` in ascending order in the SQL Editor; see [`supabase/migrations/README.md`](supabase/migrations/README.md).)
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
4. Import legacy data (admin session cookie required; payload validated at runtime; disabled in `production` unless `ENABLE_LEGACY_IMPORT=true`):
   `curl -X POST "http://localhost:3000/api/import?dryRun=true" -H "Content-Type: application/json" -H "Cookie: <your session cookie>" --data @backup.json`
   Default mode skips existing rows (`ignoreDuplicates: true`) so re-runs never overwrite newer edits; pass `?overwrite=true` explicitly to overwrite matching legacy records.
5. Deploy: import the repo in Vercel and configure env vars (`SUPABASE_SECRET_KEY` server-only, `CRON_SECRET` for scheduled photo/cache purges). Self sign-up is enabled by default so staff can register with their employee name and wait for admin validation (`role = 'viewer'`, `is_active = false`); set `NEXT_PUBLIC_ALLOW_PUBLIC_SIGNUP=false` and disable **Allow new users to sign up** in Supabase Authentication settings for invite-only deployments, or enable **Confirm email** and configure **Sign-Up Access & Domain Allowlist** in **Operators & Setup → Users & roles** (`organizations.allowed_signup_domains`, migrations `030`–`032`). Enforce strong passwords (minimum 12 characters on sign-up/reset; set Supabase Auth minimum password length to 12 as well). Per-request nonce CSP headers are applied in [`proxy.ts`](proxy.ts).

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
- **Mobile Field Logger (`/field` & `/mobile`):** Supports 20 water utility activity types with dynamic telemetry forms (Genset fuel, Pump pressure/flow, Flushing blow-offs, 3-trial volumetric Meter Test ±5% calculator + witness signature, Leak Repair materials, Water Hauling trips, and Water Sampling), GPS capture, and IndexedDB offline queue auto-sync (`/field` is the only HTML shell cached offline by the service worker).
- **Evidence Photo Retention (`activity-media`), Automated 365d PII Cleanup & 24h Sample Logs:** Uploaded photos are compressed client-side before upload to private Supabase Storage (storage reads follow `daily_activities` RLS visibility) and default to **30-day** expiration (`180 days` for `meter_test` and `leak_repair`; flagged logs and supervisor `photo_hold` records are exempt up to a hard **365-day** ceiling). Daily Vercel Cron `GET /api/activities/purge-photos` (and manual supervisor `POST`) removes expired photo objects, drains expired 24-hour `is_sample` photo queues, and invokes `purge_expired_telemetry_pii(365)` to scrub GPS/signatures/witness & customer names (`job_orders.account_number` is kept for billing audit) while failing HTTP `500` on RPC error. Sample logs (`is_sample`) are excluded from KPIs/reports/audit logs and visible only to their creator and admins for 24 hours. **Department heads can create, edit and delete sample logs only; real activity logs, job orders, handovers and accomplishment reports are read-only for them** (they can still verify/flag activities, hold evidence photos, and check/return reports). Expired samples are deleted in SQL by the hourly `pg_cron` job (or the daily `/api/activities/purge-photos` cron as a fallback); their photo files are queued in `sample_photo_cleanup` and removed by that route, and admins see a warning banner on `/activities` if cleanup is overdue (migration `035`).
- **Monitoring Hub (`/activities`):**
  - **Duty & Activity Feed:** Reconciles today's on-duty schedule against logged activities and PMs, highlights idle on-duty operators (`0 logs`), and provides supervisor verification (`verify` / `flag`) plus printable Field Activity Reports & Meter Test Certificates.
  - **Job Orders & Shift Handovers:** Dispatches job orders with 12-digit utility account auto-parsing, Turnaround Time (TAT) / SLA tracking, end-of-shift handovers, and a Daily Operations Huddle Brief.
  - **Employee KPIs & Fuel:** 7/30/90-day scorecards combining roster duty hours, field activities, PM compliance %, Job Order TAT, and genset fuel telemetry.

## Routing and map tiles
Route visualization in **Activities → Footprints & Routes** and map pin picking in **Activity Logger / Base HQ** support self-hosted OSRM routing and custom XYZ tile servers via environment variables (see [`.env.example`](.env.example)):

- `OSRM_BASE_URL`: Base URL of your self-hosted OSRM router (e.g. `https://osrm.internal.example.com`). When set, `/api/routes/compute` exclusively routes through that server.
- `ALLOW_PUBLIC_OSRM_FALLBACK`: Defaults to `false`. In `production`, when `OSRM_BASE_URL` is unset and `ALLOW_PUBLIC_OSRM_FALLBACK` is not `'true'`, `/api/routes/compute` does not call public demo OSRM servers and instead returns straight-line Haversine leg distances. Set to `'true'` only if non-critical public demo fallback is intended.
- **Map Basemap (OpenFreeMap + MapLibre GL):** By default, maps render via **MapLibre GL** and **OpenFreeMap** (`tiles.openfreemap.org`, Liberty style in Street mode) with ESRI World Imagery in Satellite mode. Optional `NEXT_PUBLIC_MAP_STREET_TILE_URL` / `NEXT_PUBLIC_MAP_STREET_ATTRIBUTION` and `NEXT_PUBLIC_MAP_SATELLITE_TILE_URL` / `NEXT_PUBLIC_MAP_SATELLITE_ATTRIBUTION` env vars override those defaults with custom `{z}/{x}/{y}` XYZ layers.
- **Shared Route Cache & Rate Limits (migrations `028` & `029`):** Apply `supabase/migrations/028_route_compute_store_and_pm_sub_limit.sql` and `supabase/migrations/029_harden_route_compute_store.sql` and ensure `SUPABASE_SECRET_KEY` is configured on the server so `/api/routes/compute` shares organization-scoped, size-bounded route caching (30 min TTL) and fixed per-user rate limits (60 req / 5 min total, 20 upstream req / 5 min) across serverless instances via `service_role`-only Postgres RPCs (swept automatically by `/api/activities/purge-photos`). In `production`, `/api/routes/compute` **fails closed (`503`)** when `SUPABASE_SECRET_KEY` or migration `029` is unavailable (unless `ALLOW_MEMORY_RATE_LIMIT_FALLBACK=true` is explicitly set); dev/test falls back to per-instance memory with an admin notice.

## Environment Variables
Configure these in `.env.local` locally and in Vercel Project Settings for production (see [`.env.example`](.env.example)):

| Variable | Scope | Default / Requirement | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | Required | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Client + Server | Required | Supabase anon/publishable key |
| `SUPABASE_SECRET_KEY` | Server only | Required in prod | Service-role key for route rate limits/cache, photo purge, and admin operations |
| `CRON_SECRET` | Server only | Required in prod | Bearer secret guarding scheduled `/api/activities/purge-photos` runs |
| `NEXT_PUBLIC_ALLOW_PUBLIC_SIGNUP` | Client + Server | `true` | Set to `false` for invite-only deployments |
| `CSP_REPORT_ONLY` | Server only | `false` | Set to `true` to report CSP violations without blocking |
| `ENABLE_LEGACY_IMPORT` | Server only | `false` | Opt-in gate allowing `/api/import` in production |
| `OSRM_BASE_URL` | Server only | Unset | Optional self-hosted OSRM routing server base URL |
| `ALLOW_PUBLIC_OSRM_FALLBACK` | Server only | `false` | Allows public demo OSRM fallback in production when `OSRM_BASE_URL` is unset |
| `ALLOW_MEMORY_RATE_LIMIT_FALLBACK` | Server only | `false` | Allows per-instance memory rate limiting in production when shared store is unavailable |
| `NEXT_PUBLIC_MAP_STREET_TILE_URL` / `_ATTRIBUTION` | Client | Unset | Optional custom `{z}/{x}/{y}` street tile URL and attribution |
| `NEXT_PUBLIC_MAP_SATELLITE_TILE_URL` / `_ATTRIBUTION` | Client | Unset | Optional custom `{z}/{x}/{y}` satellite tile URL and attribution |

## Roles & Permissions Matrix
Permissions are computed in [`lib/permissions.ts`](lib/permissions.ts) and enforced by Postgres Row-Level Security (`operator` accounts land directly on `/field` at login with the full roster accessible at `/?view=roster` via **Schedule**):

| Capability | `admin` | `scheduler` | `manager` (Dept Head) | `operator` | `viewer` |
| --- | :---: | :---: | :---: | :---: | :---: |
| Monthly Roster & Standby Paint | Full | Full | Propose (or Direct w/ Grant) | Read | Read |
| Approve / Reject Change Requests | Full | Delegated (`can_approve`) | No | No | No |
| Schedule Generator (`/generate`) | Yes | Yes | No | No | No |
| Daily Field Activity Logs (`/field`, `/mobile`, `/activities`) | Real + Sample | Verify / Flag only | Sample only + Verify / Flag | Real logs | Read |
| Close / Reopen PM Tasks (`/pm`, `/field`) | Yes | Yes | Only w/ Active Edit Grant | Yes | No |
| Job Orders, Handovers & Reports | Full | Read | Read (Check/Return Reports) | Dispatch/Close/Handover | Handovers & Reports only (no Job Orders) |
| Organization Chart (`/org`) | Full + Restructure | View only | Edit positions/assignments | No | No |
| Operators, Setup & User Roles (`/operators`) | Full | No | No | No | No |

## Offline Mode & Sync Semantics
Field operations support offline work through the data-free `/field` PWA shell and IndexedDB:
- **Data-Free App Shell (`/field`):** Rendered dynamically per request so [`proxy.ts`](proxy.ts) can attach per-request CSP nonces, while containing zero SSR table queries or baked-in dates; cached client-side by the service worker with dynamic local-date initialization and used as the offline navigation fallback.
- **Per-User Reference Snapshots:** Operators, area codes, shifts, roster assignments, PM tasks, and recent logs are cached per user ID in IndexedDB with `lastUpdatedAt` timestamps so signing out or switching accounts never clears or leaks another user's queued work.
- **Unified Outbox & Binary Photo Drafts:** Pending activity logs, accomplishment reports, PM status updates/reopens, shift handovers, and job order completions live in a single IndexedDB outbox. Open form drafts and compressed evidence photos are stored as binary `Blob`s and flushed on app open, `online` event, tab foregrounding, and periodic timers with request timeouts so weak signals fall back to the queue cleanly.
- **Idempotency & Conflict Handling:** Client-generated UUID `id` keys let retries safely ignore Postgres duplicate-key (`23505`) responses without creating duplicate rows. Device capture time (`created_at` / completion timestamp) is preserved separately from server arrival (`received_at`), and offline PM/job-order mutations send `expected_updated_at` / `expectedStatus` checks so concurrent server edits surface as conflicts instead of silently overwriting newer data.

## Testing & Verification
```bash
npm run typecheck   # TypeScript type check
npm run lint        # ESLint
npm test            # Node unit & migration/CSP/offline/rate-limit tests
npm run test:ui     # Vitest + React Testing Library UI component tests
npm run build       # Production Next.js build
npm run test:e2e    # Playwright smoke & PWA checks (builds + starts on :3100)
```
To include the authenticated offline-sync and proposal/approval workflow tests in [`e2e/workflows.spec.ts`](e2e/workflows.spec.ts) against a staging Supabase environment, also set `E2E_ALLOW_MUTATIONS=true`, `E2E_OPERATOR_EMAIL`/`PASSWORD`, `E2E_MANAGER_EMAIL`/`PASSWORD`, and `E2E_ADMIN_EMAIL`/`PASSWORD`.

## Documentation
- [System & Security Architecture (`docs/ARCHITECTURE.md`)](docs/ARCHITECTURE.md) — App Router layout, defense-in-depth Postgres/CSP architecture, RBAC role matrix, and operations/DR runbook.
- [Privacy & Data Retention (`docs/PRIVACY_AND_RETENTION.md`)](docs/PRIVACY_AND_RETENTION.md) — RA 10173 data inventory, 24h/30d/365d retention & scrubbing schedules, and admin execution guide.
- [Supabase Migrations Index (`supabase/migrations/README.md`)](supabase/migrations/README.md) — Ordered migration guide (`001`–`042`) and RLS test conventions.
