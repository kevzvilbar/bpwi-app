import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dataUrlToBlob } from '../image-compress.ts';

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
