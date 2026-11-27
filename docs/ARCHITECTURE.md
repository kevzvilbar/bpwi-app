# BPWI Monitoring — System & Security Architecture

## 1. System Overview

`bpwi-app` is the internal shift scheduling, field activity monitoring, preventive maintenance (PM), job-order dispatch, and accomplishment reporting platform for **BP Waterworks, Inc.** Built on **Next.js 16 App Router** (React 19, strict TypeScript), **Supabase** (PostgreSQL + Auth + Storage + Realtime), and **Vercel**:

- **Server-Rendered Data-Loader Pages (`page.tsx` RSC):**
  - `/` (Monthly Roster), `/activities` (Daily Activity Monitor, Job Orders, Shift Handovers, Employee KPIs & Fuel, Footprints & Routes), `/pm` (PM Planner), `/leave` (Leave Summary), `/call-sheet` (Call Sheet & Escalation), `/mobile` (Mobile Field Logger & Tasks), `/generate` (Shift Cycle Generator), `/operators` (Operators & Setup, admin-only), `/org-chart` (Organizational Chart), `/reports` (Daily Accomplishment Reports / `BPEMS-F-002`), and `/requests` (Department Head Change Request Review Queue).
- **Client Entry & Error Boundary:**
  - `/login` (`app/login/page.tsx`, `'use client'`) for sign-in, pending-approval sign-up, and password recovery.
  - `app/error.tsx` (`'use client'`) global App Router error boundary.
- **Server API Route Handlers (`app/api/`):**
  - `GET /api/activities/photo` — Authenticated Storage proxy for private `activity-media` objects.
  - `GET` & `POST /api/activities/purge-photos` — Scheduled (`CRON_SECRET`) and manual supervisor purge for >30-day activity photos, queued 24h sample photos, and expired route-compute cache/rate state.
  - `POST /api/csp-report` — Browser Content Security Policy violation intake.
  - `POST /api/import` — Admin-only idempotent legacy JSON backup importer (10 MB limit, validated via `validateImportPayload`).
  - `GET /api/pm/export` — PM schedule CSV export.
  - `GET /api/reports/leave-export` — Leave summary CSV export.
  - `POST /api/routes/compute` — OSRM / Haversine route calculation backed by Postgres shared cache and per-user rate limits (`028`/`029`).
- **Offline Sync & Visibility-Aware Realtime:**
  - Field activity logs and accomplishment reports submitted offline queue in browser IndexedDB (`bpwi-field-sync-db`, stores `pending_activities` and `pending_reports` in `lib/offline-queue.ts`) and auto-sync when connectivity returns.
  - Client islands (`ActivitiesMonitor`, `EditAccessBanner`, `MobileView`, `NotificationBell`) subscribe to Supabase Realtime channels with `visibilitychange`-aware pause/refresh behavior, including live `edit_grants` window notifications (`036`).

---

## 2. Defense-in-Depth Security Architecture

1. **Proxy & Session Boundaries (`proxy.ts`, `lib/middleware-rules.ts`):**
   - Generates a per-request cryptographic nonce (`generateCspNonce`) and sets strict `Content-Security-Policy` headers via `buildCspHeader` (`lib/csp.ts`: `script-src 'self' 'nonce-...' 'strict-dynamic'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `report-uri /api/csp-report`).
   - Cookie-only `getSession()` in the request proxy gates unauthenticated page redirects; every RSC page and API route re-validates the session via `supabaseServer()` `auth.getUser()`.
2. **Postgres Row Level Security (RLS):**
   - Every table in `supabase/migrations/` enables `ROW LEVEL SECURITY` (enforced by `lib/__tests__/migrations.test.ts`), scoped by `organization_id = current_org()` and `current_role_name()`.
   - Storage bucket `activity-media` is private and org-prefixed (`<org_id>/<user_id>/...`), with role- and ownership-scoped delete protection (`activity_media_is_protected()` in `037`).
3. **JSONB Column-Diff & Integrity `BEFORE` Triggers:**
   - `guard_dept_head_real_log_changes()` (`035`): Iterates `jsonb_each(to_jsonb(new))` vs `to_jsonb(old)` so `manager` (department head) users cannot edit or delete real `daily_activities`, `job_orders`, `shift_handovers`, or `accomplishment_reports` rows — allowing only narrow review fields (`status`/`verified_*`/`review_note` on `daily_activities`; `status`/`checked_*`/`head_remarks` on `accomplishment_reports`) while keeping `is_sample = true` rows editable by their creator.
   - `enforce_sample_log_lifecycle()` (`034`, `037`), `touch_daily_activities_updated_at()` (`010`, `037`), and `guard_accomplishment_report_integrity()` (`037`) enforce immutable sample flags/expiry, `sample-*` photo isolation, `logged_by = auth.uid()` attribution, verified/checked immutability, and anti-self-review guards.
4. **`SECURITY DEFINER` RPCs & `service_role` Isolation:**
   - Privileged multi-table mutations and maintenance jobs run inside `SECURITY DEFINER SET search_path = public` functions (e.g., `approve_change_request` with row locking, `bootstrap_initial_org_admin`, `purge_expired_sample_records()`, `purge_expired_telemetry_pii(int)`, and route cache/rate-limit RPCs restricted to `service_role`).

---

## 3. RBAC Role Matrix (`lib/permissions.ts`)

All UI and helper checks derive from `computePermissions(ctx)` in `lib/permissions.ts`, backed by Postgres RLS:

| Capability | `admin` | `scheduler` | `manager` (Propose Mode) | `manager` (Active Edit Window) | `operator` | `viewer` | `is_active = false` (Pending) |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `canEditSchedule` | Yes | Yes | No (`canProposeRequests`) | Yes | No | No | No |
| `canGenerateSchedule` | Yes | Yes | No | No | No | No | No |
| `canProposeRequests` | No | No | Yes | No | No | No | No |
| `canApproveRequests` | Yes | Flag (`can_approve`) | Flag (`can_approve`) | Flag (`can_approve`) | Flag (`can_approve`) | Flag (`can_approve`) | No |
| `canClosePm` | Yes | Yes | No | Yes | Yes | No | No |
| `canLogActivity` (real logs) | Yes | No | No | No | Yes | No | No |
| `canLogSampleActivity` (24h) | Yes | No | Yes | Yes | No | No | No |
| `canVerifyActivity` | Yes | Yes | Yes | Yes | No | No | No |
| `canViewOrgChart` | Yes | Yes | Yes | Yes | No | No | No |
| `canEditOrgChart` | Yes | No | Yes | Yes | No | No | No |
| `canRestructureOrgChart` | Yes | No | No | No | No | No | No |
| `canExportPmCsv` | Yes | No | Yes | Yes | No | No | No |
| `canExportLeaveCsv` | Yes | Yes | Yes | Yes | No | No | No |
| `canAccessSetup` | Yes | No | No | No | No | No | No |

> **Fail-Closed Provisioning (`019`, `030`–`032`):** New self sign-ups default to `role = 'viewer'` and `is_active = false`, yielding `false` for every permission above until an `admin` verifies and activates the account. Sign-ups never auto-create organizations or auto-promote to `admin`.

---

## 4. Operations & Disaster Recovery Runbook

### 4.1 Database Backups & Restore
- **Primary Backup / PITR:** Managed by Supabase automated daily backups and Point-in-Time Recovery (PITR) on the linked Postgres project.
- **Idempotent JSON Import (`POST /api/import`):** Admins with an active session cookie can import or replay JSON backups (`operators`, `shift_types`, `area_codes`, `schedule_assignments`, `standby_assignments`, `pm_tasks`). Payloads are capped at 10 MB and validated via `validateImportPayload`.

### 4.2 Scheduled Maintenance & Retention Jobs
| Job | Trigger / Schedule | Mechanism | Purpose |
| --- | --- | --- | --- |
| Hourly Sample Purge | `pg_cron` `bpwi-purge-expired-samples` (`15 * * * *`) | `public.purge_expired_sample_records()` (`035`, `037`) | Deletes expired 24h `is_sample` rows across 4 log tables; queues Storage paths in `sample_photo_cleanup`. Monitored by `sample_cleanup_health()`. |
| Daily Photo & Cache Purge | Vercel Cron (`vercel.json`: `0 18 * * *`) or manual `POST` | `GET /api/activities/purge-photos` (`Authorization: Bearer $CRON_SECRET`) | Calls `purge_expired_route_compute_state()`, `purge_expired_sample_records()`, drains `sample_photo_cleanup`, and deletes >30-day `activity-media` objects. |
| Telemetry PII Retention | Periodic Admin / SQL maintenance | `SELECT * FROM public.purge_expired_telemetry_pii(365);` (`038`, `service_role`) | Scrubs expired GPS coordinates, `signature_data`, `gpsSource`/`gpsAccuracyM`, and closed JO `contact_number` (min 30 days). |

### 4.3 Production Environment Variables (`.env.example`)
- **Required:**
  - `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL.
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — Supabase anon/publishable key.
  - `SUPABASE_SECRET_KEY` — Server-only `service_role` secret key (required for `/api/import`, `/api/activities/purge-photos`, and shared route cache/rate-limit RPCs).
  - `CRON_SECRET` — Bearer secret authenticating Vercel Cron requests to `GET /api/activities/purge-photos`.
- **Optional (Auth, CSP & Maps):**
  - `NEXT_PUBLIC_ALLOW_PUBLIC_SIGNUP` — Set `false` for invite-only deployments (`true` by default; `organizations.allowed_signup_domains` also restricts domains).
  - `CSP_REPORT_ONLY` — Set `false` in production (`true` emits `Content-Security-Policy-Report-Only` for diagnostics).
  - `OSRM_BASE_URL` / `ALLOW_PUBLIC_OSRM_FALLBACK` — Self-hosted OSRM URL; in production, unset `OSRM_BASE_URL` falls back to straight-line Haversine unless `ALLOW_PUBLIC_OSRM_FALLBACK=true`.
  - `NEXT_PUBLIC_MAP_STREET_TILE_URL`, `NEXT_PUBLIC_MAP_STREET_ATTRIBUTION`, `NEXT_PUBLIC_MAP_SATELLITE_TILE_URL`, `NEXT_PUBLIC_MAP_SATELLITE_ATTRIBUTION` — Custom XYZ tile templates (`{z}/{x}/{y}`) and attributions.
