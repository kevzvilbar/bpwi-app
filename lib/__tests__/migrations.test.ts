import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'supabase', 'migrations');

describe('Supabase SQL migrations integrity', () => {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  it('has strictly sequential 3-digit prefixes with no gaps or duplicates', () => {
    assert.ok(files.length >= 34, `Expected at least 34 migrations, found ${files.length}`);
    const nums = files.map((f) => {
      const m = f.match(/^(\d{3})_/);
      assert.ok(m, `Migration filename must start with 3-digit prefix: ${f}`);
      return Number(m[1]);
    });
    for (let i = 0; i < nums.length; i += 1) {
      assert.equal(nums[i], i + 1, `Expected migration ${String(i + 1).padStart(3, '0')}, found ${files[i]}`);
    }
  });

  it('enables Row Level Security on every newly created public table', () => {
    const allSql = files.map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')).join('\n');
    const createdTables = [...allSql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi)].map(
      (m) => m[1].toLowerCase(),
    );
    const uniqueTables = [...new Set(createdTables)];
    assert.ok(uniqueTables.length > 0, 'Expected at least one CREATE TABLE statement');

    // Collect tables protected via dynamic `foreach t in array array[...] loop execute format('alter table %I enable row level security', t)`
    const dynamicRlsTables = new Set<string>();
    for (const block of allSql.matchAll(/foreach\s+t\s+in\s+array\s+array\[([^\]]+)\]\s+loop([\s\S]*?)end\s+loop/gi)) {
      if (/enable\s+row\s+level\s+security/i.test(block[2])) {
        for (const nameMatch of block[1].matchAll(/'([a-z0-9_]+)'/gi)) {
          dynamicRlsTables.add(nameMatch[1].toLowerCase());
        }
      }
    }

    for (const tbl of uniqueTables) {
      const rlsPattern = new RegExp(`alter\\s+table\\s+(?:public\\.)?${tbl}\\s+enable\\s+row\\s+level\\s+security`, 'i');
      const hasRls = rlsPattern.test(allSql) || dynamicRlsTables.has(tbl);
      assert.ok(hasRls, `Table "${tbl}" is missing ENABLE ROW LEVEL SECURITY in migrations`);
    }
  });

  it('documents 019–031 in supabase/migrations/README.md', () => {
    const readme = fs.readFileSync(path.join(MIGRATIONS_DIR, 'README.md'), 'utf8');
    assert.match(readme, /\b019\b/);
    assert.match(readme, /\b020\b/);
    assert.match(readme, /\b021\b/);
    assert.match(readme, /\b022\b/);
    assert.match(readme, /\b023\b/);
    assert.match(readme, /\b024\b/);
    assert.match(readme, /\b025\b/);
    assert.match(readme, /\b026\b/);
    assert.match(readme, /\b027\b/);
    assert.match(readme, /\b028\b/);
    assert.match(readme, /\b029\b/);
    assert.match(readme, /\b030\b/);
    assert.match(readme, /\b031\b/);
    assert.match(readme, /\b032\b/);
    assert.match(readme, /\b033\b/);
    assert.match(readme, /\b034\b/);
  });

  it('adds 24h auto-expiring sample logs and cleanup in 034_sample_logs.sql', () => {
    const sql34 = fs.readFileSync(path.join(MIGRATIONS_DIR, '034_sample_logs.sql'), 'utf8');
    for (const required of [
      'enforce_sample_log_lifecycle',
      'purge_expired_sample_records',
      'SAMPLE-JO-',
      'revoke all on function purge_expired_sample_records() from public, anon, authenticated',
    ]) {
      assert.ok(sql34.includes(required), `034_sample_logs.sql missing required construct: ${required}`);
    }
  });

  it('adds genset registry with unique active location index and transfer trigger in 033_genset_registry.sql', () => {
    const sql33 = fs.readFileSync(path.join(MIGRATIONS_DIR, '033_genset_registry.sql'), 'utf8');
    for (const required of [
      'create table if not exists gensets',
      'create table if not exists genset_transfers',
      'gensets_org_active_location_uidx',
      'log_genset_location_change',
      'audit_gensets',
    ]) {
      assert.ok(sql33.includes(required), `033_genset_registry.sql missing required construct: ${required}`);
    }
  });

  it('locks down first-admin bootstrap in 032_lock_down_first_admin_bootstrap.sql', () => {
    const sql32 = fs.readFileSync(path.join(MIGRATIONS_DIR, '032_lock_down_first_admin_bootstrap.sql'), 'utf8');
    for (const required of [
      'bootstrap_initial_org_admin',
      'Organization is not initialized; run bootstrap_initial_org_admin() before creating users',
      'revoke all on function bootstrap_initial_org_admin(text, text, text) from public, anon, authenticated',
    ]) {
      assert.ok(sql32.includes(required), `032_lock_down_first_admin_bootstrap.sql missing required construct: ${required}`);
    }
  });

  it('scopes audit_logs per org and locks first-org bootstrap in 031_scope_audit_logs_and_signup_controls.sql', () => {
    const sql31 = fs.readFileSync(path.join(MIGRATIONS_DIR, '031_scope_audit_logs_and_signup_controls.sql'), 'utf8');
    for (const required of [
      'add column if not exists organization_id uuid references organizations(id)',
      'idx_audit_logs_org_created',
      "organization_id = current_org() and current_role_name() = 'admin'",
      'pg_advisory_xact_lock',
    ]) {
      assert.ok(sql31.includes(required), `031_scope_audit_logs_and_signup_controls.sql missing required construct: ${required}`);
    }
  });

  it('hardens sign-up provisioning and adds user_profiles audit trigger in 030_security_hardening_signup_audit.sql', () => {
    const sql30 = fs.readFileSync(path.join(MIGRATIONS_DIR, '030_security_hardening_signup_audit.sql'), 'utf8');
    for (const required of [
      'allowed_signup_domains',
      'audit_user_profiles',
      'after insert or update or delete on user_profiles',
      'Multiple organizations exist; new users must be invited with an organization_id',
      'Sign-up restricted to approved email domains',
    ]) {
      assert.ok(sql30.includes(required), `030_security_hardening_signup_audit.sql missing required construct: ${required}`);
    }
    const legacyHtmlPath = path.resolve(process.cwd(), 'legacy', 'legacy-standalone.html');
    assert.equal(fs.existsSync(legacyHtmlPath), false, 'legacy/legacy-standalone.html must not exist in repository');
  });

  it('hardens route compute store to service_role, org keys, size caps, and cron purge in 029_harden_route_compute_store.sql', () => {
    const sql29 = fs.readFileSync(path.join(MIGRATIONS_DIR, '029_harden_route_compute_store.sql'), 'utf8');
    for (const required of [
      'drop function if exists check_route_compute_rate_limit(text, int, int)',
      'drop function if exists get_route_compute_cache(text)',
      'drop function if exists set_route_compute_cache(text, jsonb, jsonb, int)',
      'add column organization_id uuid not null references organizations(id)',
      'route_compute_cache_legs_chk',
      'route_compute_cache_polys_chk',
      'purge_expired_route_compute_state',
      'revoke all on function set_route_compute_cache(uuid, text, jsonb, jsonb) from public, anon, authenticated',
      'grant execute on function set_route_compute_cache(uuid, text, jsonb, jsonb) to service_role',
    ]) {
      assert.ok(sql29.includes(required), `029_harden_route_compute_store.sql missing required construct: ${required}`);
    }
  });

  it('adds shared route cache/rate-limit store and substitute colleague restriction in 028_route_compute_store_and_pm_sub_limit.sql', () => {
    const sql28 = fs.readFileSync(path.join(MIGRATIONS_DIR, '028_route_compute_store_and_pm_sub_limit.sql'), 'utf8');
    for (const required of [
      'create table if not exists route_compute_cache',
      'create table if not exists route_compute_rate_hits',
      'check_route_compute_rate_limit',
      'get_route_compute_cache',
      'set_route_compute_cache',
      '<@ array_append(coalesce(',
      'Operators may only credit themselves and the originally assigned operators when closing a PM task',
    ]) {
      assert.ok(sql28.includes(required), `028_route_compute_store_and_pm_sub_limit.sql missing required construct: ${required}`);
    }
  });

  it('adds pm_locations catalog, uniqueness index, and RLS policies in 027_pm_locations.sql', () => {
    const sql27 = fs.readFileSync(path.join(MIGRATIONS_DIR, '027_pm_locations.sql'), 'utf8');
    for (const required of [
      'create table if not exists pm_locations',
      'pm_locations_org_name_lower_uidx',
      'enable row level security',
      'pm_locations read',
      'pm_locations write',
    ]) {
      assert.ok(sql27.includes(required), `027_pm_locations.sql missing required construct: ${required}`);
    }
  });

  it('fixes unchanged target re-validation on item status updates in 026_fix_change_request_item_org_trigger.sql', () => {
    const sql26 = fs.readFileSync(path.join(MIGRATIONS_DIR, '026_fix_change_request_item_org_trigger.sql'), 'utf8');
    assert.ok(sql26.includes('validate_change_request_item_org'), '026 missing validate_change_request_item_org');
    assert.ok(sql26.includes('new.target_id is distinct from old.target_id'), '026 missing distinct target_id guard');
  });

  it('hardens PM operator close RLS & trigger in 025_harden_pm_operator_close.sql', () => {
    const sql25 = fs.readFileSync(path.join(MIGRATIONS_DIR, '025_harden_pm_operator_close.sql'), 'utf8');
    for (const required of [
      "status <> 'done'",
      'current_operator_id() = any(completed_by_operator_ids)',
      'Operators cannot reopen or modify completed PM tasks',
      'Unlisted operators may only close open PM tasks as done',
    ]) {
      assert.ok(sql25.includes(required), `025_harden_pm_operator_close.sql missing required construct: ${required}`);
    }
  });

  it('tracks actual PM performers safely in 024_pm_actual_performers.sql', () => {
    const sql24 = fs.readFileSync(path.join(MIGRATIONS_DIR, '024_pm_actual_performers.sql'), 'utf8');
    for (const required of [
      'completed_by_operator_ids',
      'pm_tasks operator close',
      'enforce_operator_pm_update',
      'assigned_operator_ids is distinct from old.assigned_operator_ids',
    ]) {
      assert.ok(sql24.includes(required), `024_pm_actual_performers.sql missing required construct: ${required}`);
    }
  });

  it('consolidates station codes cleanly in 022_consolidate_station_codes.sql', () => {
    const sql22 = fs.readFileSync(path.join(MIGRATIONS_DIR, '022_consolidate_station_codes.sql'), 'utf8');
    for (const required of [
      'consolidate_station_codes_for_org',
      'revoke all on function consolidate_station_codes_for_org',
      'Plant Operations',
      'Field Operations',
      'Water Delivery',
    ]) {
      assert.ok(sql22.includes(required), `022_consolidate_station_codes.sql missing required construct: ${required}`);
    }
  });

  it('hardens change requests in 020_change_requests_hardening.sql', () => {
    const sql20 = fs.readFileSync(path.join(MIGRATIONS_DIR, '020_change_requests_hardening.sql'), 'utf8');
    for (const required of [
      'drop function if exists approve_change_request',
      'p_allow_self_override',
      'partially_approved',
      'trg_validate_change_request_item_org',
      'trg_guard_change_request_transition',
    ]) {
      assert.ok(sql20.includes(required), `020_change_requests_hardening.sql missing required construct: ${required}`);
    }
  });

  it('applies Phase 3 security hardening in 021_security_hardening.sql without committed employee names', () => {
    const sql21 = fs.readFileSync(path.join(MIGRATIONS_DIR, '021_security_hardening.sql'), 'utf8');
    for (const required of [
      'app.change_request_rpc',
      'set public = false',
      'activity-media org read',
      'revoke all on function seed_bpwi_iloilo_org_chart',
    ]) {
      assert.ok(sql21.includes(required), `021_security_hardening.sql missing required construct: ${required}`);
    }

    const allSql = files.map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')).join('\n');
    const encodedNames = [
      'SGVybmFuIFRhbGF2ZXJh',
      'S2V2aW4gVmlsYmFy',
      'QXJub2xkIERpYWRheQ==',
      'Sm9uZWxhIEFtb3lhbg==',
      'QW5kcmVhIEZhaXRoIEdhbG9u',
      'TWF5cm9zZSBMZWJ1bmE=',
      'R2hlbHNvbiBWaWVqbw==',
      'SmFzc29uIFNhbGFyZGE=',
      'SGF5ZGVsaW5lIFF1aW50bw==',
    ];
    for (const encoded of encodedNames) {
      const target = Buffer.from(encoded, 'base64').toString('utf8');
      assert.ok(!allSql.includes(target), 'Committed migrations must not contain employee PII names');
    }
  });

  it('creates consumables inventory tables with RLS and activity sync trigger in 039_consumables_inventory.sql', () => {
    const sql39 = fs.readFileSync(path.join(MIGRATIONS_DIR, '039_consumables_inventory.sql'), 'utf8');
    for (const required of [
      'create table if not exists consumable_items',
      'create table if not exists consumable_movements',
      'alter table consumable_items enable row level security',
      'alter table consumable_movements enable row level security',
      'seed_default_consumables',
      'sync_consumable_inventory_from_activity',
    ]) {
      assert.ok(sql39.includes(required), `039_consumables_inventory.sql missing required construct: ${required}`);
    }
  });
});
