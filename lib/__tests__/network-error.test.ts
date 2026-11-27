import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifySyncError, isNetworkErrorMessage } from '../error-utils.ts';

describe('isNetworkErrorMessage', () => {
  it('recognises Chrome, Firefox, Safari and timeout network failures', () => {
    for (const message of [
      'TypeError: Failed to fetch',
      'TypeError: NetworkError when attempting to fetch resource.',
      'TypeError: Load failed',
      'TypeError: The network connection was lost.',
      'Request timed out — check your connection',
      'AbortError: The operation was aborted.',
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

describe('classifySyncError', () => {
  it('distinguishes conflicts, expired sessions, network issues, and other errors', () => {
    assert.equal(classifySyncError('Conflict: this record was updated by someone else'), 'conflict');
    assert.equal(classifySyncError('JWT expired'), 'auth');
    assert.equal(classifySyncError('Unauthorized (401)'), 'auth');
    assert.equal(classifySyncError('Request timed out — check your connection'), 'network');
    assert.equal(classifySyncError('new row violates row-level security policy'), 'other');
  });
});
