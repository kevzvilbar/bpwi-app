import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dataUrlToBlob, uploadBlobPhoto } from '../image-compress.ts';

describe('dataUrlToBlob', () => {
  it('decodes a base64 image data URL into a Blob with exact MIME type and bytes without using fetch', async () => {
    const payloadText = 'PNG_TEST_BYTES';
    const base64 = Buffer.from(payloadText, 'utf8').toString('base64');
    const blob = dataUrlToBlob(`data:image/png;base64,${base64}`);

    assert.equal(blob.type, 'image/png');
    assert.equal(blob.size, payloadText.length);
    const decoded = Buffer.from(await blob.arrayBuffer()).toString('utf8');
    assert.equal(decoded, payloadText);
  });

  it('throws on invalid or non-base64 data URLs', () => {
    assert.throws(() => dataUrlToBlob('https://example.com/a.png'), /Invalid image data URL/);
    assert.throws(() => dataUrlToBlob('data:image/png,raw-not-base64'), /Invalid image data URL/);
  });
});

describe('uploadBlobPhoto', () => {
  it('uploads native Blobs idempotently and treats 409 already-exists responses as synced', async () => {
    const uploadedPaths: string[] = [];
    let attempt = 0;
    const fakeSb = {
      storage: {
        from: () => ({
          upload: async (path: string) => {
            attempt += 1;
            uploadedPaths.push(path);
            if (attempt === 2) {
              return { error: { statusCode: '409', message: 'The resource already exists' } };
            }
            return { error: null };
          },
        }),
      },
    } as never;

    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });
    const first = await uploadBlobPhoto(fakeSb, 'org-1', blob, { fileStem: 'q1-1', sample: true, requireStorage: true });
    assert.match(first.storagePath!, /^org-1\/\d{4}-\d{2}-\d{2}\/sample-q1-1\.webp$/);
    assert.equal(first.url, `/api/activities/photo?path=${encodeURIComponent(first.storagePath!)}`);

    const retry = await uploadBlobPhoto(fakeSb, 'org-1', blob, { fileStem: 'q1-1', sample: true, requireStorage: true });
    assert.equal(retry.storagePath, first.storagePath);
    assert.equal(uploadedPaths.length, 2);
  });
});
