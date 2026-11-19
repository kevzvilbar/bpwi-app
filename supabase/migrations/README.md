# Supabase Migrations (`bpwi-app`)

Migrations in this folder are strictly numbered (`001`–`018`) and verified by `npm test` (`lib/__tests__/migrations.test.ts`), which checks:
- Sequential numbering with no gaps or duplicates.
- Every newly created table enables Row Level Security (`ENABLE ROW LEVEL SECURITY`).

## Applying Migrations

### Option A — Supabase CLI (Recommended for Staging / Production)
```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

### Option B — Supabase SQL Editor (Manual)
Run each file in ascending numeric order (`001_init.sql` → `018_notifications.sql`). All migrations are written idempotently (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`).

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
