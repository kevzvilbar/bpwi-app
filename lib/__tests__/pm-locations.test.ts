import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPmSeriesPrefix,
  buildSavedLocationCatalog,
  expandPmTaskGroups,
  filterLocationSuggestions,
  isMissingPmLocationsTableError,
  resolveSavedLocation,
  validateSelectedLocations,
  type PmAreaWithSubSites,
  type PmLocationRow,
} from '../pm-locations.ts';

const SAMPLE_LOCS: PmLocationRow[] = [
  { id: 'l1', name: 'Pavia Plant', sort_order: 0 },
  { id: 'l2', name: 'Wakeboard Plant', sort_order: 1 },
  { id: 'l3', name: 'LEG Tank 1', sort_order: 2 },
];

const SAMPLE_AREAS: PmAreaWithSubSites[] = [
  { id: 'a1', code: 'PL', name: 'Plant Operations', category: 'station', sub_sites: ['Pavia Plant', 'Well 1 BAR'] },
  { id: 'a2', code: 'FD', name: 'Field Operations', category: 'station', sub_sites: ['DHP Phase 1', 'BAR Phase 2'] },
  { id: 'a3', code: 'RD', name: 'Rest Day', category: 'rest', sub_sites: ['Should Be Ignored'] },
];

describe('buildSavedLocationCatalog & suggestion filtering', () => {
  it('merges pm_locations and station sub_sites with case-insensitive deduplication and ignores non-station codes', () => {
    const catalog = buildSavedLocationCatalog(SAMPLE_LOCS, SAMPLE_AREAS);
    assert.deepEqual(
      catalog.map((c) => c.name),
      ['Pavia Plant', 'Wakeboard Plant', 'LEG Tank 1', 'Well 1 BAR', 'DHP Phase 1', 'BAR Phase 2'],
    );
    const pavia = catalog.find((c) => c.name === 'Pavia Plant');
    assert.equal(pavia?.source, 'both');
    assert.equal(pavia?.stationCode, 'PL');
    const well1 = catalog.find((c) => c.name === 'Well 1 BAR');
    assert.equal(well1?.source, 'station_sub_site');
    assert.equal(well1?.stationCode, 'PL');
  });

  it('filters out already selected items and ranks prefix matches before substring matches', () => {
    const catalog = buildSavedLocationCatalog(SAMPLE_LOCS, SAMPLE_AREAS);
    const filtered = filterLocationSuggestions(catalog, 'wa', ['LEG Tank 1'], 10);
    assert.deepEqual(
      filtered.map((f) => f.name),
      ['Wakeboard Plant'],
    );

    const barMatches = filterLocationSuggestions(catalog, 'bar', [], 10);
    assert.deepEqual(
      barMatches.map((f) => f.name),
      ['BAR Phase 2', 'Well 1 BAR'],
    );

    const allLimited = filterLocationSuggestions(catalog, '', ['Pavia Plant', 'Wakeboard Plant'], 2);
    assert.equal(allLimited.length, 2);
    assert.ok(!allLimited.some((x) => x.name === 'Pavia Plant'));
  });
});

describe('strict saved-location validation', () => {
  const catalog = buildSavedLocationCatalog(SAMPLE_LOCS, SAMPLE_AREAS);

  it('allows blank locations when nothing is typed or selected', () => {
    assert.deepEqual(validateSelectedLocations([], catalog, ''), { ok: true, locations: [] });
  });

  it('canonicalizes saved locations and accepts exact saved pending text', () => {
    assert.ok(resolveSavedLocation(catalog, 'pavia plant'));
    const res = validateSelectedLocations(['dhp phase 1'], catalog, 'leg tank 1');
    assert.deepEqual(res, { ok: true, locations: ['DHP Phase 1', 'LEG Tank 1'] });
  });

  it('strictly rejects unsaved pending input or unsaved entries', () => {
    const unsavedPending = validateSelectedLocations(['Pavia Plant'], catalog, 'Unknown New Site');
    assert.equal(unsavedPending.ok, false);
    if (!unsavedPending.ok) {
      assert.match(unsavedPending.error, /not a saved area\/site/i);
    }

    const unsavedChip = validateSelectedLocations(['Invented Site'], catalog, '');
    assert.equal(unsavedChip.ok, false);
  });

  it('permits pre-existing legacy locations on edit while still blocking newly added unsaved names', () => {
    const keepLegacy = validateSelectedLocations(['Old Legacy Well'], catalog, '', ['Old Legacy Well']);
    assert.deepEqual(keepLegacy, { ok: true, locations: ['Old Legacy Well'] });

    const blockExtra = validateSelectedLocations(['Old Legacy Well'], catalog, 'Brand New Fake Site', ['Old Legacy Well']);
    assert.equal(blockExtra.ok, false);
  });
});

describe('one task per location expansion & independent series prefixes', () => {
  it('splits into one group per location only when enabled and 2+ locations exist', () => {
    assert.deepEqual(expandPmTaskGroups(['Pavia Plant', 'LEG Tank 1'], true), [['Pavia Plant'], ['LEG Tank 1']]);
    assert.deepEqual(expandPmTaskGroups(['Pavia Plant', 'LEG Tank 1'], false), [['Pavia Plant', 'LEG Tank 1']]);
    assert.deepEqual(expandPmTaskGroups(['Pavia Plant'], true), [['Pavia Plant']]);
    assert.deepEqual(expandPmTaskGroups([], true), [[]]);
  });

  it('produces hyphen-free series prefixes so split("-")[0] cleanly isolates each location series', () => {
    const p0 = buildPmSeriesPrefix('abc123', 0, 2);
    const p1 = buildPmSeriesPrefix('abc123', 1, 2);
    assert.equal(p0.includes('-'), false);
    assert.equal(p1.includes('-'), false);
    assert.notEqual(p0, p1);
    assert.equal(`${p0}-0`.split('-')[0], p0);
    assert.equal(`${p1}-0`.split('-')[0], p1);
    assert.equal(buildPmSeriesPrefix('abc123', 0, 1), 'Sabc123');
  });

  it('detects missing pm_locations relation errors safely', () => {
    assert.equal(isMissingPmLocationsTableError({ code: '42P01', message: 'relation "pm_locations" does not exist' }), true);
    assert.equal(isMissingPmLocationsTableError({ code: 'PGRST205', message: 'Could not find the table public.pm_locations' }), true);
    assert.equal(isMissingPmLocationsTableError({ code: '23505', message: 'duplicate key' }), false);
  });
});
