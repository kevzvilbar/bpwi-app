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
    assert.ok(files.length >= 20, `Expected at least 20 migrations, found ${files.length}`);
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

  it('documents 019 and 020 in supabase/migrations/README.md', () => {
    const readme = fs.readFileSync(path.join(MIGRATIONS_DIR, 'README.md'), 'utf8');
    assert.match(readme, /\b019\b/);
    assert.match(readme, /\b020\b/);
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
});
