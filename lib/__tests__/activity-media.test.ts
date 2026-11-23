import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActivityPhotoUrl,
  extractActivityStoragePath,
  getActivityPhotoContentType,
  isStoragePathOwnedByOrg,
  isValidActivityStoragePath,
  resolveActivityPhotoUrl,
} from '../activity-media.ts';

describe('activity-media helpers', () => {
  const validPath = '11111111-1111-4111-8111-111111111111/2026-11-19/1795092000000-ab12cd.webp';

  it('validates canonical org/date/filename storage paths and rejects traversal', () => {
    assert.equal(isValidActivityStoragePath(validPath), true);
    assert.equal(isValidActivityStoragePath('22222222-2222-4222-8222-222222222222/2026-11-19/photo_1.JPG'), true);
    assert.equal(isValidActivityStoragePath('../secret/2026-11-19/file.webp'), false);
    assert.equal(
      isValidActivityStoragePath('11111111-1111-4111-8111-111111111111/../other/file.webp'),
      false,
    );
    assert.equal(
      isValidActivityStoragePath('11111111-1111-4111-8111-111111111111/2026-11-19/file.svg'),
      false,
    );
  });

  it('extracts storage paths from proxy URLs, legacy Supabase URLs, and raw paths', () => {
    const proxyUrl = buildActivityPhotoUrl(validPath);
    assert.equal(proxyUrl, `/api/activities/photo?path=${encodeURIComponent(validPath)}`);
    assert.equal(extractActivityStoragePath(proxyUrl), validPath);

    const legacyPublic = `https://example.supabase.co/storage/v1/object/public/activity-media/${validPath}`;
    assert.equal(extractActivityStoragePath(legacyPublic), validPath);

    const legacySigned = `https://example.supabase.co/storage/v1/object/sign/activity-media/${validPath}?token=abc`;
    assert.equal(extractActivityStoragePath(legacySigned), validPath);

    assert.equal(extractActivityStoragePath(validPath), validPath);
    assert.equal(extractActivityStoragePath('data:image/jpeg;base64,AAAA'), null);
    assert.equal(
      extractActivityStoragePath(
        'https://example.supabase.co/storage/v1/object/public/activity-media/../../etc/passwd',
      ),
      null,
    );
  });

  it('resolves legacy URLs, explicit storage paths, and data URIs safely', () => {
    assert.equal(resolveActivityPhotoUrl('data:image/png;base64,ABC', validPath), 'data:image/png;base64,ABC');
    assert.equal(
      resolveActivityPhotoUrl('https://stale.example/wrong.jpg', validPath),
      `/api/activities/photo?path=${encodeURIComponent(validPath)}`,
    );
    assert.equal(
      resolveActivityPhotoUrl(`https://example.supabase.co/storage/v1/object/public/activity-media/${validPath}`),
      `/api/activities/photo?path=${encodeURIComponent(validPath)}`,
    );
  });

  it('maps extensions to safe image content types', () => {
    assert.equal(getActivityPhotoContentType('a/b/c.webp'), 'image/webp');
    assert.equal(getActivityPhotoContentType('a/b/c.png'), 'image/png');
    assert.equal(getActivityPhotoContentType('a/b/c.jpg'), 'image/jpeg');
  });

  it('enforces organization prefix ownership on storage paths', () => {
    const orgA = '11111111-1111-4111-8111-111111111111';
    const orgB = '22222222-2222-4222-8222-222222222222';
    assert.equal(isStoragePathOwnedByOrg(validPath, orgA), true);
    assert.equal(isStoragePathOwnedByOrg(validPath, orgA.toUpperCase()), true);
    assert.equal(isStoragePathOwnedByOrg(validPath, orgB), false);
    assert.equal(isStoragePathOwnedByOrg('../evil/2026-11-19/file.webp', orgA), false);
    assert.equal(isStoragePathOwnedByOrg(validPath, ''), false);
  });
});
