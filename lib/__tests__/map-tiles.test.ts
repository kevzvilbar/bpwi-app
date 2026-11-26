import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPublicTileAdminNotice, isValidTileUrlTemplate, resolveMapTileConfig } from '../map-tiles.ts';

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

  it('uses OpenFreeMap vector tiles with no rate-limit banner by default for street and Esri fallback for satellite', () => {
    const street = resolveMapTileConfig('street', { streetUrl: 'invalid-url' });
    assert.equal(street.kind, 'vector-style');
    assert.ok(street.url.includes('tiles.openfreemap.org'));
    assert.equal(street.isPublicDefault, false);

    const sat = resolveMapTileConfig('satellite', {});
    assert.equal(sat.kind, 'raster-xyz');
    assert.ok(sat.url.includes('arcgisonline.com'));
    assert.equal(sat.isPublicDefault, true);
  });
});

describe('getPublicTileAdminNotice', () => {
  it('returns null for OpenFreeMap street default and custom providers, and returns notice for public satellite fallback', () => {
    const customStreet = resolveMapTileConfig('street', {
      streetUrl: 'https://maps.bpwi.internal/street/{z}/{x}/{y}.png',
    });
    assert.equal(getPublicTileAdminNotice('street', customStreet), null);

    const customSat = resolveMapTileConfig('satellite', {
      satelliteUrl: 'https://maps.bpwi.internal/sat/{z}/{x}/{y}.jpg',
    });
    assert.equal(getPublicTileAdminNotice('satellite', customSat), null);

    const defaultStreet = resolveMapTileConfig('street', {});
    assert.equal(getPublicTileAdminNotice('street', defaultStreet), null);

    const publicSat = resolveMapTileConfig('satellite', {});
    const satNotice = getPublicTileAdminNotice('satellite', publicSat);
    assert.ok(satNotice && satNotice.includes('NEXT_PUBLIC_MAP_SATELLITE_TILE_URL'));
  });
});
