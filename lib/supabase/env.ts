export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ''
  ).trim();

  const isValidUrl = /^https?:\/\/.+/.test(url) && !url.includes('YOUR-PROJECT');
  const isValidKey = key.length > 0 && !key.endsWith('...');

  return {
    url,
    key,
    isConfigured: isValidUrl && isValidKey,
  };
}
