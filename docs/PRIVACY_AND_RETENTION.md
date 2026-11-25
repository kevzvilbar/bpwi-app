# Privacy & Data Retention Policy (`bpwi-app`)

**Controller:** BP Waterworks, Inc.  
**Applicable Framework:** Philippine Data Privacy Act of 2012 (Republic Act No. 10173 / RA 10173)  
**Scope:** Internal utility operations, shift scheduling, preventive maintenance, job-order dispatch, and field activity monitoring (`bpwi-app`).

---

## 1. Personal & Operational Data Inventory

| Data Category | Storage Location | Fields Collected | Purpose & Legal Basis |
| --- | --- | --- | --- |
| **Employee Accounts & Directory** | `auth.users`, `user_profiles`, `operators`, `org_positions` | Full name, work email, role, active flag, position/title, station assignment, contact phone number (for Call Sheet / escalation) | Employment & operational dispatch; access control & accountability |
| **Schedules, Leave & Approvals** | `schedule_assignments`, `standby_assignments`, `leave_records`, `edit_grants`, `change_requests` | Shift/area assignments, on-call standby, leave codes/dates, approval notes | Workforce scheduling & service continuity |
| **Field Activity & Handover Logs** | `daily_activities`, `accomplishment_reports`, `shift_handovers`, `pm_tasks` | Activity type, station/site/block-lot, crew tags, operational readings (`details` JSONB), verification/check timestamps | Water utility operations, preventive maintenance, and `BPEMS-F-002` reporting |
| **Optional Field GPS Check-Ins** | `daily_activities` (`gps_lat`, `gps_lng`, `details.gpsSource`, `details.gpsAccuracyM`) | Coordinates & accuracy metadata captured **only when explicitly triggered** by an operator (`Attach GPS` or `Pick on Map`) | Verifying field service/site location for dispatch & route footprints (never continuous background tracking) |
| **Field Evidence Photos** | Supabase Storage (`activity-media` private bucket), `daily_activities.photo_storage_paths` / `photo_urls` | Client-compressed field photos (`sample-*` prefix for sample sandboxes) | Visual verification of repairs, flushing, tank cleaning, and meter tests |
| **Witness / Customer Signatures** | `daily_activities.signature_data` | Base64 signature canvas capture (e.g., 3-trial volumetric Meter Test certificates) | Field test attestation |
| **Customer Job Orders** | `job_orders` | 12-digit utility `account_number`, `account_name`, `contact_number`, `site_or_well`, `block_lot`, SLA/TAT notes | Customer service dispatch & turnaround tracking |
| **Security & Audit Logs** | `audit_logs`, `/api/csp-report` | Tenant-scoped mutation audit trails (admin-read only via `031`) and browser CSP violation metadata | Security monitoring, integrity, and non-repudiation |

---

## 2. Retention & Scrubbing Schedule

| Record / Artifact | Retention Period | Automated / Operational Mechanism | Migration / Implementation |
| --- | --- | --- | --- |
| **Sample Sandbox Logs & Photos** (`is_sample = true` on `daily_activities`, `job_orders`, `shift_handovers`, `accomplishment_reports`) | **24 hours** (`sample_expires_at`) | Deleted hourly by `pg_cron` job `bpwi-purge-expired-samples` (`purge_expired_sample_records()`); queued `sample-*` Storage files removed by `GET/POST /api/activities/purge-photos` | `034`, `035`, `037` |
| **Field Activity Photos** (`activity-media` bucket) | **30 days** (`photos_expires_at`) | Removed daily by Vercel Cron `GET /api/activities/purge-photos` (`0 18 * * *`) or manual supervisor trigger `POST /api/activities/purge-photos`; clears `photo_urls` & `photo_storage_paths` while retaining non-photo work telemetry | `010`, `037` |
| **Field GPS Coordinates, GPS Metadata, Witness Signatures & Closed Job-Order Contact Numbers** | **365 days** default (configurable minimum **30 days**) | Scrubbed (`NULL` / JSONB key removal) via `service_role`-only `purge_expired_telemetry_pii(p_retention_days)` on non-sample `daily_activities` and `completed`/`cancelled` `job_orders` | `038` |
| **Route Compute Cache & Rate-Limit Hits** (`route_compute_cache`, `route_compute_rate_hits`) | **30 min** cache TTL / **5 min** rate window | Swept by `purge_expired_route_compute_state()` during purge runs | `028`, `029` |
| **Offline Browser Queue** (IndexedDB `bpwi-field-sync-db`) | Until synced & confirmed | Stored locally on the user's device only while offline; cleared per item upon successful Supabase sync and cleared on sign-out cache reset | `lib/offline-queue.ts` |

---

## 3. Operational Controls & Transparency Notices

### 3.1 Built-In User Notices
- **Sign-In / Sign-Up (`app/login/page.tsx`):** Displays a concise RA 10173 notice stating that account details, shift/activity logs, and optional field GPS check-ins are processed for utility dispatch and audit, and that field photos expire after 30 days.
- **Media & GPS Capture (`components/ActivityMediaCapture.tsx`):** Displays an inline reminder alongside capture controls that GPS check-in is optional and operator-initiated, photos auto-delete after 30 days, and telemetry is governed by BPWI RA 10173 retention policy.
- **Fail-Closed Access:** Unapproved sign-ups remain inactive (`is_active = false`, `role = 'viewer'`) until verified by an organization administrator; `audit_logs` are readable only by `admin` users within the same organization (`031`).

### 3.2 Administrator Retention Execution & Health Checks
Run these commands in the **Supabase SQL Editor** (executing with `service_role` / database owner privileges):

```sql
-- 1. Scrub field GPS coordinates, accuracy metadata, witness signatures, and closed JO contact numbers older than 365 days:
SELECT * FROM public.purge_expired_telemetry_pii(365);

-- 2. Manually purge expired 24-hour sample logs (fallback if pg_cron is disabled):
SELECT * FROM public.purge_expired_sample_records();
```

To verify 24-hour sample cleanup health as an authenticated `admin` (or via `/activities` warning banner):

```sql
SELECT public.sample_cleanup_health();
```

### 3.3 Data Subject Rights (Access, Correction & Deactivation)
Under RA 10173, BP Waterworks, Inc. personnel and affected customers may request access, correction, or deletion/deactivation of personal data through the **Operations Administrator / Data Protection Officer**:
1. **Correction of Employee Profile / Directory Data:** An `admin` updates `operators` / `user_profiles` in **Operators & Setup** (`/operators`).
2. **Account Deactivation:** An `admin` sets `is_active = false` in **Operators & Setup → Users & roles**, immediately revoking all app and RLS access while preserving historical operational audit trails required for utility governance.
3. **Early Telemetry or Photo Removal:** Supervisors/admins can trigger **Purge Expired Photos (>30d)** in `/activities` (`POST /api/activities/purge-photos`) or execute `purge_expired_telemetry_pii(p_retention_days)` with an approved retention period (`>= 30` days).
