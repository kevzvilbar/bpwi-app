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
    assert.ok(files.length >= 26, `Expected at least 26 migrations, found ${files.length}`);
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

  it('documents 019–026 in supabase/migrations/README.md', () => {
    const readme = fs.readFileSync(path.join(MIGRATIONS_DIR, 'README.md'), 'utf8');
    assert.match(readme, /\b019\b/);
    assert.match(readme, /\b020\b/);
    assert.match(readme, /\b021\b/);
    assert.match(readme, /\b022\b/);
    assert.match(readme, /\b023\b/);
    assert.match(readme, /\b024\b/);
    assert.match(readme, /\b025\b/);
    assert.match(readme, /\b026\b/);
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
});
