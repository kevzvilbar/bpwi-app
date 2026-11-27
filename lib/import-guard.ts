/** Checks whether legacy JSON imports are enabled (always allowed outside production; requires opt-in in production). */
export function isLegacyImportEnabled(env: {
  nodeEnv?: string;
  enableLegacyImport?: string;
}): boolean {
  if (env.nodeEnv !== 'production') return true;
  return env.enableLegacyImport?.trim().toLowerCase() === 'true';
}

/** Parses `/api/import` query flags (`?dryRun=true` preview, `?overwrite=true` overwrite existing rows). */
export function parseImportOptions(url: string): { dryRun: boolean; overwrite: boolean } {
  try {
    const { searchParams } = new URL(url, 'http://localhost');
    return {
      dryRun: searchParams.get('dryRun') === 'true',
      overwrite: searchParams.get('overwrite') === 'true',
    };
  } catch {
    return { dryRun: false, overwrite: false };
  }
}
