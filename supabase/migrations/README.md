# Supabase Migrations (`bpwi-app`)

Migrations in this folder are strictly numbered (`001`–`024`) and verified by `npm test` (`lib/__tests__/migrations.test.ts`), which checks:
- Sequential numbering with no gaps or duplicates.
- Every newly created table enables Row Level Security (`ENABLE ROW LEVEL SECURITY`).

## Applying Migrations

### Option A — Supabase CLI (Recommended for Staging / Production)
```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

### Option B — Supabase SQL Editor (Manual)
Run each file in ascending numeric order (`001_init.sql` → `024_pm_actual_performers.sql`). All migrations are written idempotently (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`).

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
