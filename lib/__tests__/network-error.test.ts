import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isNetworkErrorMessage } from '../error-utils.ts';

describe('isNetworkErrorMessage', () => {
  it('recognises Chrome, Firefox and Safari network failures', () => {
    for (const message of [
      'TypeError: Failed to fetch',
      'TypeError: NetworkError when attempting to fetch resource.',
      'TypeError: Load failed',
      'TypeError: The network connection was lost.',
    ]) {
      assert.equal(isNetworkErrorMessage(message), true, message);
    }
  });

  it('does not treat server or storage rejections as network failures', () => {
    for (const message of ['Photo upload failed', 'new row violates row-level security policy', 'Save failed']) {
      assert.equal(isNetworkErrorMessage(message), false, message);
    }
  });
});
