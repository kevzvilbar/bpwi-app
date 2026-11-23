import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidTileUrlTemplate, resolveMapTileConfig } from '../map-tiles.ts';

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

  it('safely falls back to default tiles when overrides are unset or malformed', () => {
    const street = resolveMapTileConfig('street', { streetUrl: 'invalid-url' });
    assert.ok(street.url.includes('openstreetmap.org'));
    assert.equal(street.isPublicDefault, true);

    const sat = resolveMapTileConfig('satellite', {});
    assert.ok(sat.url.includes('arcgisonline.com'));
    assert.equal(sat.isPublicDefault, true);
  });
});
