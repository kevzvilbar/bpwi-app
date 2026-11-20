import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { DailyActivityRow } from '../activity-types.ts';
import {
  buildRouteCacheKey,
  chunkRouteWaypoints,
  decodeEncodedPolyline,
  extractOperatorStops,
  formatDistanceKm,
  formatDuration,
  haversineMeters,
  isValidCoordinate,
  parseGoogleDurationSeconds,
  parseLatLngPair,
  summarizeTeamFootprints,
} from '../route-footprints.ts';

function makeActivity(overrides: Partial<DailyActivityRow> & { id: string }): DailyActivityRow {
  return {
    organization_id: 'org-1',
    activity_date: '2026-05-10',
    logged_by: 'user-1',
    lead_operator_id: 'op-1',
    crew_operator_ids: [],
    shift_type_id: null,
    area_code_id: 'area-1',
    site_or_well: 'PS-1',
    block_lot: null,
    activity_type: 'pump_monitoring',
    pm_task_id: null,
    status: 'submitted',
    started_at: '2026-05-10T01:00:00Z',
    completed_at: null,
    gps_lat: 10.775,
    gps_lng: 122.543,
    notes: null,
    details: {},
    photo_urls: [],
    photo_storage_paths: [],
    photos_expires_at: null,
    photos_purged_at: null,
    signature_data: null,
    verified_by: null,
    verified_at: null,
    review_note: null,
    created_at: '2026-05-10T01:00:00Z',
    updated_at: '2026-05-10T01:00:00Z',
    ...overrides,
  };
}

describe('coordinate validation & parsing', () => {
  it('accepts valid coordinates and rejects Null Island, NaN, and out-of-range', () => {
    assert.equal(isValidCoordinate(10.775, 122.543), true);
    assert.equal(isValidCoordinate(-33.8688, 151.2093), true);
    assert.equal(isValidCoordinate(0, 0), false);
    assert.equal(isValidCoordinate(91, 122), false);
    assert.equal(isValidCoordinate(10, -181), false);
    assert.equal(isValidCoordinate(NaN, 122), false);
    assert.equal(isValidCoordinate(null, 122), false);
    assert.equal(isValidCoordinate(10, undefined), false);
  });

  it('parses trimmed coordinate strings safely', () => {
    assert.deepEqual(parseLatLngPair(' 10.775 ', ' 122.543 '), { lat: 10.775, lng: 122.543 });
    assert.equal(parseLatLngPair('', '122.543'), null);
    assert.equal(parseLatLngPair('0', '0'), null);
    assert.equal(parseLatLngPair('abc', '122.543'), null);
  });
});

describe('haversineMeters', () => {
  it('returns 0 for identical coordinates', () => {
    assert.equal(haversineMeters({ lat: 10.775, lng: 122.543 }, { lat: 10.775, lng: 122.543 }), 0);
  });

  it('computes realistic distance (~1.11 km per 0.01 deg latitude)', () => {
    const meters = haversineMeters({ lat: 10.77, lng: 122.54 }, { lat: 10.78, lng: 122.54 });
    assert.ok(meters >= 1100 && meters <= 1125, `expected ~1112m, got ${meters}`);
  });
});

describe('extractOperatorStops', () => {
  const activities: DailyActivityRow[] = [
    makeActivity({
      id: 'a-late',
      lead_operator_id: 'op-1',
      started_at: '2026-05-10T05:30:00Z',
      gps_lat: 10.79,
      gps_lng: 122.56,
      activity_type: 'leak_repair',
      site_or_well: 'Main Line',
    }),
    makeActivity({
      id: 'a-early',
      lead_operator_id: 'op-1',
      started_at: '2026-05-10T00:30:00Z',
      gps_lat: 10.77,
      gps_lng: 122.54,
      activity_type: 'pump_monitoring',
      site_or_well: 'PS-1',
    }),
    makeActivity({
      id: 'a-crew',
      lead_operator_id: 'op-2',
      crew_operator_ids: ['op-1'],
      started_at: '2026-05-10T03:00:00Z',
      gps_lat: 10.78,
      gps_lng: 122.55,
      activity_type: 'flushing',
      site_or_well: 'Zone B',
    }),
    makeActivity({
      id: 'a-no-gps',
      lead_operator_id: 'op-1',
      started_at: '2026-05-10T04:00:00Z',
      gps_lat: null,
      gps_lng: null,
      activity_type: 'meter_inst',
    }),
    makeActivity({
      id: 'a-other-day',
      activity_date: '2026-05-09',
      lead_operator_id: 'op-1',
      gps_lat: 10.775,
      gps_lng: 122.543,
    }),
  ];

  it('sorts chronologically, separates unmapped logs, and respects includeCrew=false', () => {
    const res = extractOperatorStops(activities, {
      date: '2026-05-10',
      operatorId: 'op-1',
      includeCrew: false,
    });
    assert.equal(res.mappedCount, 2);
    assert.equal(res.unmappedCount, 1);
    assert.deepEqual(
      res.stops.map((s) => s.id),
      ['a-early', 'a-late'],
    );
    assert.equal(res.stops[0].sequence, 1);
    assert.equal(res.stops[1].sequence, 2);
    assert.equal(res.straightLineLegsMeters.length, 1);
    assert.ok(res.straightLineTotalMeters > 2500);
  });

  it('includes crew activities when includeCrew=true and tags roleInActivity', () => {
    const res = extractOperatorStops(activities, {
      date: '2026-05-10',
      operatorId: 'op-1',
      includeCrew: true,
    });
    assert.equal(res.mappedCount, 3);
    assert.deepEqual(
      res.stops.map((s) => [s.id, s.roleInActivity]),
      [
        ['a-early', 'lead'],
        ['a-crew', 'crew'],
        ['a-late', 'lead'],
      ],
    );
  });

  it('prepends and appends Base HQ round-trip stops only when enabled and mapped stops exist', () => {
    const baseHq = { enabled: true, label: 'Main Plant HQ', lat: 10.76, lng: 122.53 };
    const res = extractOperatorStops(activities, {
      date: '2026-05-10',
      operatorId: 'op-1',
      includeCrew: false,
      baseHq,
    });
    assert.equal(res.stops.length, 4);
    assert.equal(res.stops[0].kind, 'base_start');
    assert.equal(res.stops[3].kind, 'base_end');
    assert.equal(res.stops[3].sequence, 4);
    assert.equal(res.straightLineLegsMeters.length, 3);

    // When operator has 0 mapped stops, Base HQ should not fabricate a 0m ghost route
    const empty = extractOperatorStops(activities, {
      date: '2026-05-10',
      operatorId: 'op-none',
      includeCrew: true,
      baseHq,
    });
    assert.equal(empty.stops.length, 0);
    assert.equal(empty.straightLineTotalMeters, 0);
  });
});

describe('summarizeTeamFootprints', () => {
  it('ranks operators by mapped GPS stops descending then total logs', () => {
    const acts = [
      makeActivity({ id: '1', lead_operator_id: 'op-b', gps_lat: 10.77, gps_lng: 122.54 }),
      makeActivity({ id: '2', lead_operator_id: 'op-b', gps_lat: 10.78, gps_lng: 122.55 }),
      makeActivity({ id: '3', lead_operator_id: 'op-a', gps_lat: null, gps_lng: null }),
    ];
    const summary = summarizeTeamFootprints(
      acts,
      [
        { id: 'op-a', full_name: 'Ana Cruz', position: 'Operator' },
        { id: 'op-b', full_name: 'Ben Santos', position: 'Lead' },
        { id: 'op-c', full_name: 'Carl Reyes', position: 'Operator' },
      ],
      { date: '2026-05-10', includeCrew: true },
    );
    assert.deepEqual(
      summary.map((r) => [r.operatorId, r.mappedCount, r.unmappedCount]),
      [
        ['op-b', 2, 0],
        ['op-a', 0, 1],
        ['op-c', 0, 0],
      ],
    );
  });
});

describe('chunkRouteWaypoints', () => {
  it('returns empty for <2 stops and single chunk for <=27 stops', () => {
    assert.deepEqual(chunkRouteWaypoints([{ lat: 10, lng: 122 }]), []);
    const pts = Array.from({ length: 5 }, (_, i) => ({ lat: 10 + i * 0.01, lng: 122 }));
    const chunks = chunkRouteWaypoints(pts, 25);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].length, 5);
  });

  it('overlaps boundary points so total legs across chunks equals stops - 1', () => {
    const pts = Array.from({ length: 10 }, (_, i) => ({ lat: 10 + i * 0.01, lng: 122 }));
    const chunks = chunkRouteWaypoints(pts, 2); // max 4 stops (3 legs) per chunk
    assert.equal(chunks.length, 3);
    assert.deepEqual(chunks[0][chunks[0].length - 1], chunks[1][0]);
    assert.deepEqual(chunks[1][chunks[1].length - 1], chunks[2][0]);
    const totalLegs = chunks.reduce((sum, c) => sum + (c.length - 1), 0);
    assert.equal(totalLegs, pts.length - 1);
  });
});

describe('polyline decoding, duration parsing & formatting', () => {
  it('decodes the canonical Google Polyline example accurately', () => {
    const pts = decodeEncodedPolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    assert.equal(pts.length, 3);
    assert.ok(Math.abs(pts[0].lat - 38.5) < 1e-5);
    assert.ok(Math.abs(pts[0].lng - -120.2) < 1e-5);
    assert.ok(Math.abs(pts[1].lat - 40.7) < 1e-5);
    assert.ok(Math.abs(pts[1].lng - -120.95) < 1e-5);
    assert.ok(Math.abs(pts[2].lat - 43.252) < 1e-5);
    assert.ok(Math.abs(pts[2].lng - -126.453) < 1e-5);
  });

  it('parses Google duration strings and formats distance/duration', () => {
    assert.equal(parseGoogleDurationSeconds('1245s'), 1245);
    assert.equal(parseGoogleDurationSeconds('92.6s'), 93);
    assert.equal(parseGoogleDurationSeconds('invalid'), 0);
    assert.equal(formatDistanceKm(450), '450 m');
    assert.equal(formatDistanceKm(12345), '12.35 km');
    assert.equal(formatDistanceKm(0), '0.00 km');
    assert.equal(formatDuration(20), '< 1 min');
    assert.equal(formatDuration(1500), '25 min');
    assert.equal(formatDuration(4500), '1h 15m');
    assert.equal(formatDuration(3600), '1h');
  });

  it('builds deterministic cache keys', () => {
    const k1 = buildRouteCacheKey(
      [
        { lat: 10.7751234, lng: 122.5439876 },
        { lat: 10.7851234, lng: 122.5539876 },
      ],
      'DRIVE',
    );
    const k2 = buildRouteCacheKey(
      [
        { lat: 10.7751249, lng: 122.5439861 },
        { lat: 10.7851241, lng: 122.5539881 },
      ],
      'DRIVE',
    );
    assert.equal(k1, k2);
  });
});
