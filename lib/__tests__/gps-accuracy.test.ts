import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeWeightedGpsFix,
  extractGpsMetadata,
  filterSpatialOutliers,
  formatGpsBadgeLabel,
  formatTaggedGpsPosition,
  GPS_INTERNAL_DETAIL_KEYS,
  isAcceptableGpsSample,
  type GpsSample,
} from '../gps-accuracy.ts';

describe('high-accuracy GPS filtering & weighted averaging', () => {
  it('accepts <=10m valid samples and rejects coarse >10m or invalid samples', () => {
    assert.equal(isAcceptableGpsSample({ lat: 10.7202, lng: 122.5621, accuracy: 3, timestamp: 1 }), true);
    assert.equal(isAcceptableGpsSample({ lat: 10.7202, lng: 122.5621, accuracy: 10, timestamp: 1 }), true);
    assert.equal(isAcceptableGpsSample({ lat: 10.7202, lng: 122.5621, accuracy: 10.1, timestamp: 1 }), false);
    assert.equal(isAcceptableGpsSample({ lat: 10.7202, lng: 122.5621, accuracy: 45, timestamp: 1 }), false);
    assert.equal(isAcceptableGpsSample({ lat: 0, lng: 0, accuracy: 3, timestamp: 1 }), false);
    assert.equal(isAcceptableGpsSample({ lat: 10.7202, lng: 122.5621, accuracy: 0, timestamp: 1 }), false);
  });

  it('drops spatial multipath outliers (>15m from cluster median)', () => {
    const samples: GpsSample[] = [
      { lat: 10.7202, lng: 122.5621, accuracy: 6, timestamp: 1 },
      { lat: 10.72022, lng: 122.56211, accuracy: 5, timestamp: 2 },
      { lat: 10.72021, lng: 122.56212, accuracy: 4, timestamp: 3 },
      { lat: 10.7206, lng: 122.5621, accuracy: 9, timestamp: 4 }, // ~44m away
    ];
    const kept = filterSpatialOutliers(samples);
    assert.equal(kept.length, 3);
    assert.equal(kept.some((s) => s.lat === 10.7206), false);

    assert.equal(filterSpatialOutliers(samples.slice(0, 2)).length, 2);
  });

  it('computes 1/accuracy^2 weighted coordinates and rejects coarse-only sets', () => {
    const coarseOnly: GpsSample[] = [
      { lat: 10.7202, lng: 122.5621, accuracy: 18, timestamp: 1 },
      { lat: 10.72025, lng: 122.56215, accuracy: 25, timestamp: 2 },
    ];
    assert.equal(computeWeightedGpsFix(coarseOnly), null);

    const mixed: GpsSample[] = [
      { lat: 10.72, lng: 122.562, accuracy: 9, timestamp: 1 },
      { lat: 10.7201, lng: 122.5621, accuracy: 3, timestamp: 2 },
      { lat: 10.7201, lng: 122.5621, accuracy: 18, timestamp: 3 }, // coarse ignored
    ];
    const fix = computeWeightedGpsFix(mixed);
    assert.ok(fix);
    assert.equal(fix.sampleCount, 2);
    assert.equal(fix.source, 'gps');
    assert.ok(fix.accuracy <= 10);
    // 3m sample has 9x the weight of 9m sample, so weighted lat sits much closer to 10.7201
    assert.ok(fix.lat > 10.72008);
  });

  it('extracts and formats gps metadata badges accurately', () => {
    assert.deepEqual(extractGpsMetadata(null), { gpsAccuracyM: null, gpsSource: null });
    assert.equal(formatGpsBadgeLabel({}), null);
    assert.equal(formatGpsBadgeLabel({ gpsSource: 'gps', gpsAccuracyM: 3.4 }), 'GPS ±3.4m');
    assert.equal(formatGpsBadgeLabel({ gpsSource: 'map_pin', gpsAccuracyM: null }), 'Map Pin');
  });

  it('formats tagged GPS position and internal detail keys for printable reports', () => {
    assert.equal(formatTaggedGpsPosition(null, null, {}), null);
    assert.equal(formatTaggedGpsPosition(0, 0, { gpsSource: 'gps' }), null);

    const mapPin = formatTaggedGpsPosition(10.72025, 122.56215, { gpsSource: 'map_pin' });
    assert.deepEqual(mapPin, {
      coords: '10.720250, 122.562150',
      sourceLabel: 'Map Pin',
      fullText: '10.720250, 122.562150 (Map Pin)',
      mapUrl: 'https://www.google.com/maps?q=10.720250,122.562150',
    });

    const gpsPrecise = formatTaggedGpsPosition(10.72025, 122.56215, { gpsSource: 'gps', gpsAccuracyM: 3.2 });
    assert.equal(gpsPrecise?.sourceLabel, 'GPS (±3.2m)');
    assert.equal(gpsPrecise?.fullText, '10.720250, 122.562150 (GPS (±3.2m))');

    const bareGps = formatTaggedGpsPosition(10.72025, 122.56215, null);
    assert.equal(bareGps?.sourceLabel, 'GPS');

    assert.equal(GPS_INTERNAL_DETAIL_KEYS.has('gpsSource'), true);
    assert.equal(GPS_INTERNAL_DETAIL_KEYS.has('gpsAccuracyM'), true);
  });
});
