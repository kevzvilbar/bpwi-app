import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getMapStyleOptions, getPublicTileAdminNotice, hasCustomSatelliteTiles, isValidTileUrlTemplate, resolveMapTileConfig } from '../map-tiles.ts';

describe('isValidTileUrlTemplate', () => {
  it('accepts https, localhost http, and relative URL templates with {z}/{x}/{y}', () => {
    assert.equal(isValidTileUrlTemplate('https://tiles.example.com/{z}/{x}/{y}.png'), true);
    assert.equal(isValidTileUrlTemplate('http://localhost:8080/styles/basic/{z}/{x}/{y}.png'), true);
    assert.equal(isValidTileUrlTemplate('/api/tiles/{z}/{x}/{y}.png'), true);
  });

  it('rejects empty, non-https remote URLs, and templates missing coordinates', () => {
    assert.equal(isValidTileUrlTemplate(undefined), false);
    assert.equal(isValidTileUrlTemplate(''), false);
    assert.equal(isValidTileUrlTemplate('http://insecure.example.com/{z}/{x}/{y}.png'), false);
    assert.equal(isValidTileUrlTemplate('https://tiles.example.com/{z}/{x}.png'), false);
  });
});

describe('resolveMapTileConfig', () => {
  it('returns custom provider URLs & attributions when valid env overrides are supplied', () => {
    const street = resolveMapTileConfig('street', {
      streetUrl: 'https://maps.bpwi.internal/street/{z}/{x}/{y}.png',
      streetAttribution: '&copy; BPWI Maps',
    });
    assert.equal(street.url, 'https://maps.bpwi.internal/street/{z}/{x}/{y}.png');
    assert.equal(street.attribution, '&copy; BPWI Maps');
    assert.equal(street.isPublicDefault, false);

    const sat = resolveMapTileConfig('satellite', {
      satelliteUrl: 'https://maps.bpwi.internal/sat/{z}/{x}/{y}.jpg',
      satelliteAttribution: '&copy; Commercial Imagery',
    });
    assert.equal(sat.url, 'https://maps.bpwi.internal/sat/{z}/{x}/{y}.jpg');
    assert.equal(sat.attribution, '&copy; Commercial Imagery');
    assert.equal(sat.isPublicDefault, false);
  });

  it('uses OpenFreeMap vector tiles with no rate-limit banner across street, clean, and unset satellite styles', () => {
    const street = resolveMapTileConfig('street', { streetUrl: 'invalid-url' });
    assert.equal(street.kind, 'vector-style');
    assert.ok(street.url.includes('tiles.openfreemap.org/styles/liberty'));
    assert.equal(street.isPublicDefault, false);

    const clean = resolveMapTileConfig('clean', {});
    assert.equal(clean.kind, 'vector-style');
    assert.ok(clean.url.includes('tiles.openfreemap.org/styles/positron'));
    assert.equal(clean.isPublicDefault, false);

    const sat = resolveMapTileConfig('satellite', {});
    assert.equal(sat.kind, 'vector-style');
    assert.ok(sat.url.includes('tiles.openfreemap.org/styles/bright'));
    assert.equal(sat.isPublicDefault, false);
  });
});

describe('getPublicTileAdminNotice & style options', () => {
  it('returns null across all default OpenFreeMap presets and custom providers, and exposes satellite only when configured', () => {
    const customStreet = resolveMapTileConfig('street', {
      streetUrl: 'https://maps.bpwi.internal/street/{z}/{x}/{y}.png',
    });
    assert.equal(getPublicTileAdminNotice('street', customStreet), null);

    const customSat = resolveMapTileConfig('satellite', {
      satelliteUrl: 'https://maps.bpwi.internal/sat/{z}/{x}/{y}.jpg',
    });
    assert.equal(getPublicTileAdminNotice('satellite', customSat), null);

    assert.equal(getPublicTileAdminNotice('street', resolveMapTileConfig('street', {})), null);
    assert.equal(getPublicTileAdminNotice('clean', resolveMapTileConfig('clean', {})), null);
    assert.equal(getPublicTileAdminNotice('satellite', resolveMapTileConfig('satellite', {})), null);

    assert.equal(hasCustomSatelliteTiles({}), false);
    assert.deepEqual(getMapStyleOptions({}), [
      { id: 'street', label: 'Street' },
      { id: 'clean', label: 'Clean' },
    ]);
    assert.equal(
      hasCustomSatelliteTiles({ satelliteUrl: 'https://maps.bpwi.internal/sat/{z}/{x}/{y}.jpg' }),
      true,
    );
    assert.deepEqual(
      getMapStyleOptions({ satelliteUrl: 'https://maps.bpwi.internal/sat/{z}/{x}/{y}.jpg' }),
      [
        { id: 'street', label: 'Street' },
        { id: 'clean', label: 'Clean' },
        { id: 'satellite', label: 'Satellite' },
      ],
    );
  });
});
