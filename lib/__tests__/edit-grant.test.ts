import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canManagerDirectEditDate, isDateInGrantRange, isGrantActiveAt, type EditGrantWindow } from '../edit-grant.ts';

describe('edit-grant window helpers', () => {
  const baseGrant: EditGrantWindow = {
    starts_at: '2026-11-24T08:00:00.000Z',
    ends_at: '2026-11-24T16:46:00.000Z',
    date_from: null,
    date_to: null,
  };

  it('detects active window strictly within [starts_at, ends_at)', () => {
    const startMs = Date.parse(baseGrant.starts_at);
    const endMs = Date.parse(baseGrant.ends_at);
    assert.equal(isGrantActiveAt(null, startMs + 1000), false);
    assert.equal(isGrantActiveAt(baseGrant, startMs - 1), false);
    assert.equal(isGrantActiveAt(baseGrant, startMs), true);
    assert.equal(isGrantActiveAt(baseGrant, endMs - 1), true);
    assert.equal(isGrantActiveAt(baseGrant, endMs), false);
    assert.equal(isGrantActiveAt(baseGrant, endMs + 60_000), false);
  });

  it('checks optional date bounds accurately', () => {
    assert.equal(isDateInGrantRange(baseGrant, '2026-11-14'), true);
    const bounded: EditGrantWindow = { ...baseGrant, date_from: '2026-11-10', date_to: '2026-11-20' };
    assert.equal(isDateInGrantRange(bounded, '2026-11-09'), false);
    assert.equal(isDateInGrantRange(bounded, '2026-11-10'), true);
    assert.equal(isDateInGrantRange(bounded, '2026-11-20'), true);
    assert.equal(isDateInGrantRange(bounded, '2026-11-21'), false);
  });

  it('allows manager direct edit only when window is live and date is covered', () => {
    const midMs = Date.parse('2026-11-24T12:00:00.000Z');
    const afterMs = Date.parse('2026-11-24T17:00:00.000Z');
    const bounded: EditGrantWindow = { ...baseGrant, date_from: '2026-11-14', date_to: '2026-11-16' };
    assert.equal(canManagerDirectEditDate(bounded, '2026-11-14', midMs), true);
    assert.equal(canManagerDirectEditDate(bounded, '2026-11-18', midMs), false);
    assert.equal(canManagerDirectEditDate(bounded, '2026-11-14', afterMs), false);
  });

  it('partitions mixed date batches cleanly between direct edit and proposal dates', () => {
    const midMs = Date.parse('2026-11-24T12:00:00.000Z');
    const bounded: EditGrantWindow = { ...baseGrant, date_from: '2026-11-12', date_to: '2026-11-14' };
    const dates = ['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'];

    const directDates = dates.filter((d) => canManagerDirectEditDate(bounded, d, midMs));
    const proposeDates = dates.filter((d) => !canManagerDirectEditDate(bounded, d, midMs));

    assert.deepEqual(directDates, ['2026-11-12', '2026-11-13', '2026-11-14']);
    assert.deepEqual(proposeDates, ['2026-11-11', '2026-11-15']);

    const fromOnly: EditGrantWindow = { ...baseGrant, date_from: '2026-11-13', date_to: null };
    assert.deepEqual(
      dates.filter((d) => canManagerDirectEditDate(fromOnly, d, midMs)),
      ['2026-11-13', '2026-11-14', '2026-11-15'],
    );
  });
});
