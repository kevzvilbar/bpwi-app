# Supabase Migrations (`bpwi-app`)

Migrations in this folder are strictly numbered (`001`–`040`) and verified by `npm test` (`lib/__tests__/migrations.test.ts`), which checks:
- Sequential numbering with no gaps or duplicates.
- Every newly created table enables Row Level Security (`ENABLE ROW LEVEL SECURITY`).

## Applying Migrations

### Option A — Supabase CLI (Recommended Default)
```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

### Option B — Supabase SQL Editor (Manual Fallback)
Run each file in ascending numeric order (`001_init.sql` → `040_field_integrity_and_inventory_hardening.sql`). All migrations are written idempotently (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`).

## Optional Local Seeds
Org-chart structural templates do not commit employee names in migrations. To assign local directory names outside version control, copy `supabase/seeds/org_chart.example.sql` to `supabase/seeds/org_chart.local.sql` (gitignored) or assign holders in `/org-chart`.

## Migration Index
- `001`–`006`: Core schema (`organizations`, `operators`, `shift_types`, `area_codes`, `schedule_assignments`, `pm_tasks`, `audit_logs`, `app_title`, `user_profiles`).
- `007`–`009`: Department heads (`manager` role, `edit_grants`, `change_requests`).
- `010`–`011`: Daily field activities (`daily_activities`), job orders (`job_orders`), shift handovers (`shift_handovers`).
- `012`: Philippine & custom holidays (`holidays`).
- `013`: Hardening & area sub-site presets (`area_codes.sub_sites`).
- `014`: Daily Accomplishment Reports (`accomplishment_reports` / `BPEMS-F-002`) and `operators.department_head_id`.
- `015`–`016`: Editable Organizational Chart (`org_positions`, auto-vacate & auto-sync triggers, `organizations.org_chart_meta`).
- `017`: Department Head RPC for chart header (`update_org_chart_meta`) and single-node operator head sync trigger.
- `018`: In-app `notifications` table and triggers for Accomplishment Reports & Change Requests.
- `019`: Enforce admin approval on new sign-ups (`user_profiles.is_active = false`, `handle_new_user()` — supersedes the earlier in-place edit to `002_auto_profile.sql`) and backfill missing profiles.
- `020`: Change-request hardening (`trg_validate_change_request_item_org`, `trg_guard_change_request_transition`, self-approval prevention with `p_allow_self_override`, partial-approval status & follow-up approvals, multi-table conflict checks, leave overlap checks, and `partially_approved` notifications).
- `021`: Phase 3 security hardening (RPC-only `change_requests` / `change_request_items` update RLS & requester guard regardless of `is_approver()`, private `activity-media` bucket + org-scoped policies, and admin-only `seed_bpwi_iloilo_org_chart` without hardcoded employee names).
- `022`: Consolidate 6 station codes (`PW`, `RM`, `LD`, `MR`, `WM`, `WD`) down to 3 (`PL` Plant Operations, `FD` Field Operations, `WD` Water Delivery) via `consolidate_station_codes_for_org`, preserving `RD`, `AL`, `VL`, `SL`, `H`.
- `023`: Approval flow polish (request-row locking, empty-cell conflict semantics, deleted-target handling, accumulating review notes, and requester notifications on partial approvals).
- `024`: PM actual performer attribution (`pm_tasks.completed_by_operator_ids`, historical backfill, org-wide active operator completion RLS, and trigger locking `assigned_operator_ids` for audit while validating org membership of actual performers).
- `025`: Harden PM operator completion RLS & trigger (allow substitutes only to close open tasks as `done`, block operators from reopening or modifying `done` tasks, and require the closing operator to appear in `completed_by_operator_ids`).
- `026`: Fix `validate_change_request_item_org()` trigger so status/review updates on `change_request_items` with unchanged target references succeed even if a referenced `leave_records` or `pm_tasks` row was deleted while pending.
- `027`: Add saved PM locations/sites table (`pm_locations`) with case-insensitive org uniqueness, RLS policies for org read & admin/scheduler/granted-manager writes, and idempotent backfill from station `area_codes.sub_sites` and existing `pm_tasks.locations`.
- `028`: Add Postgres-backed shared route compute cache & per-user sliding-window rate-limit store (`route_compute_cache`, `route_compute_rate_hits`, `check_route_compute_rate_limit`, `get_route_compute_cache`, `set_route_compute_cache`), and restrict operator PM completion attribution to the closing operator plus originally assigned operators.
- `029`: Harden shared route compute store: drop `authenticated`-callable `028` RPC overloads, restrict all route cache/rate-limit RPCs to `service_role`, partition `route_compute_cache` by `organization_id` with payload byte/element caps and per-org entry bounds, hardcode rate-limit windows/thresholds inside SQL, and add cross-user expired sweeps + `purge_expired_route_compute_state()` for scheduled cron cleanup.
- `030`: Harden user sign-up provisioning (`organizations.allowed_signup_domains`, invite-only multi-tenant enforcement in `handle_new_user()`) and add `audit_user_profiles` trigger on `user_profiles` to log role, approval, and active-status changes.
- `031`: Add `audit_logs.organization_id` with historical backfill, populate `organization_id` in `log_audit()`, enforce tenant-scoped `"audit read"` RLS policy (`organization_id = current_org() and current_role_name() = 'admin'`), and serialize first-organization bootstrap in `handle_new_user()` using `pg_advisory_xact_lock`. Note: if public sign-ups are disabled on a brand-new database before first login, insert the first `organizations` and `admin` `user_profiles` rows manually via SQL.
- `032`: Remove auto-created org/auto-admin promotion from `handle_new_user()` (public/unbootstrapped sign-ups can no longer claim `admin` or initialize an org) and add `service_role`/SQL-only `bootstrap_initial_org_admin(p_org_name, p_admin_email, p_admin_full_name)`.
- `033`: Add Genset Registry (`gensets`) and relocation log (`genset_transfers`) with `gensets_org_active_location_uidx` enforcing at most one active genset per site/well, `log_genset_location_change()` trigger, org-scoped RLS, and `audit_gensets`.
- `034`: Add 24-hour auto-expiring sample logs (`is_sample`, `sample_expires_at`) across `daily_activities`, `job_orders`, `shift_handovers`, and `accomplishment_reports` with server-stamped expiry trigger, dedicated `SAMPLE-JO-YYYYMM-NNN` numbering, creator+admin-only visibility, skipped `log_audit()` & report notifications, and `purge_expired_sample_records()` (`service_role` + hourly `pg_cron` where available).
- `035`: Department heads (`manager`) can edit/delete **sample** logs only via `guard_dept_head_real_log_changes()` on `daily_activities`, `job_orders`, `shift_handovers` and `accomplishment_reports` (verify/flag and check/return review actions stay allowed); `purge_expired_sample_records()` now queues sample photo paths in `sample_photo_cleanup` and deletes all expired samples in SQL; admin-only `sample_cleanup_health()`; Storage policies limit department heads to `sample-*` objects; new PM / job-order indexes.
- `036`: Idempotently register `public.edit_grants` in the `supabase_realtime` publication (guarded for missing publication) so live Edit Access window grants/revocations propagate to subscribed clients.
- `037`: Harden RLS, trigger integrity guards, and sample photo isolation: enforce org + `sample-*` photo path/URL checks in `enforce_sample_log_lifecycle()` and `purge_expired_sample_records()`, scope `storage.objects` `"activity-media purge delete"` by role/ownership/activity status, require `logged_by = auth.uid()` and insert/update verification guards on `daily_activities`, add `guard_accomplishment_report_integrity()` and prevent self-review on `accomplishment_reports`, and remove the `current_operator_id() is null` bypass in `"job_orders update"`.
- `038`: Add GIN indexes on `daily_activities` (`photo_storage_paths`, `photo_urls`) for photo-proxy RLS lookups and add `service_role`-only `purge_expired_telemetry_pii(p_retention_days int default 365)` (minimum 30 days) to scrub expired GPS/signature/accuracy metadata on `daily_activities` and `contact_number` on completed/cancelled `job_orders`.
- `039`: Add per-site consumables inventory (`consumable_items` and `consumable_movements`) with org starter seeding (`CHLORINE_GRAN`, `CHLORINE_LIQ`, `GASOLINE`, `DIESEL`), automatic stock sync trigger from real `daily_activities` chlorine & fuel logs (`sync_consumable_inventory_from_activity()`), manager/admin write RLS, and audit triggers.
- `040`: Harden field log integrity & inventory computation: block non-admin deletion of `verified`/`flagged` `daily_activities`, add server-controlled `received_at` column + trigger on `daily_activities`, revoke direct execute on `seed_default_consumables(uuid)`, enforce strict positive quantity & chlorine/fuel validation in `sync_consumable_inventory_from_activity()` without stock churn on non-stock updates, and add `get_consumable_site_balances()` DB aggregation RPC.
