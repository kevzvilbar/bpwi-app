import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDocumentTitle } from '../nav-title.ts';

describe('getDocumentTitle', () => {
  it('returns route-specific browser tab titles for sub-routes', () => {
    assert.equal(getDocumentTitle('/pm', 'BP Waterworks, Inc.', 'Ops'), 'PM Plan · BP Waterworks, Inc.');
    assert.equal(getDocumentTitle('/activities', 'BPWI', 'Ops'), 'Activities · BPWI');
    assert.equal(getDocumentTitle('/mobile', 'BPWI', 'Ops'), 'Tasks · BPWI');
    assert.equal(getDocumentTitle('/requests/123', 'BPWI', 'Ops'), 'Change Requests · BPWI');
  });

  it('falls back to orgName and appTitle on the root roster and unknown routes', () => {
    assert.equal(getDocumentTitle('/', 'BP Waterworks, Inc.', 'Plant Operations Schedule'), 'BP Waterworks, Inc. · Plant Operations Schedule');
    assert.equal(getDocumentTitle('/unknown', '', ''), 'BP Waterworks, Inc. · Operations & Plant Schedule');
  });
});
