import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isLegacyImportEnabled, parseImportOptions } from '../import-guard.ts';

describe('import-guard helpers', () => {
  it('disables /api/import in production unless ENABLE_LEGACY_IMPORT=true', () => {
    assert.equal(isLegacyImportEnabled({ nodeEnv: 'production' }), false);
    assert.equal(
      isLegacyImportEnabled({ nodeEnv: 'production', enableLegacyImport: 'false' }),
      false,
    );
    assert.equal(
      isLegacyImportEnabled({ nodeEnv: 'production', enableLegacyImport: ' TRUE ' }),
      true,
    );
    assert.equal(isLegacyImportEnabled({ nodeEnv: 'development' }), true);
    assert.equal(isLegacyImportEnabled({ nodeEnv: 'test' }), true);
  });

  it('defaults import options to live skip-existing and parses dryRun / overwrite flags', () => {
    assert.deepEqual(parseImportOptions('https://app.test/api/import'), {
      dryRun: false,
      overwrite: false,
    });
    assert.deepEqual(parseImportOptions('https://app.test/api/import?dryRun=true'), {
      dryRun: true,
      overwrite: false,
    });
    assert.deepEqual(parseImportOptions('https://app.test/api/import?overwrite=true'), {
      dryRun: false,
      overwrite: true,
    });
    assert.deepEqual(parseImportOptions('https://app.test/api/import?dryRun=true&overwrite=true'), {
      dryRun: true,
      overwrite: true,
    });
  });
});
