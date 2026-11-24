export type OAuthErrorReason = 'cancelled' | 'domain_restricted' | 'provider_disabled' | 'oauth_failed';

export function sanitizeNextPath(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/';
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return '/';
  }
  return value;
}

export function classifyOAuthError(
  errorCode: string | null | undefined,
  errorDescription: string | null | undefined,
): OAuthErrorReason {
  const code = (errorCode ?? '').trim().toLowerCase();
  const desc = (errorDescription ?? '').trim().toLowerCase();
  if (code === 'access_denied' || /\bcancel(?:led|ed)?\b|\bdenied\b/.test(desc)) {
    return 'cancelled';
  }
  if (desc.includes('approved email domains')) {
    return 'domain_restricted';
  }
  if (desc.includes('provider is not enabled') || desc.includes('unsupported provider')) {
    return 'provider_disabled';
  }
  return 'oauth_failed';
}

function formatOAuthProviderLabel(provider?: string | null): string {
  const normalized = (provider ?? '').trim().toLowerCase();
  if (normalized === 'google') return 'Google';
  if (normalized === 'facebook') return 'Facebook';
  return 'Social';
}

export function getOAuthErrorMessage(reason: string | null | undefined, provider?: string | null): string {
  const label = formatOAuthProviderLabel(provider);
  switch (reason) {
    case 'cancelled':
      return `${label} sign-in was cancelled. You can try again or use your email and password.`;
    case 'domain_restricted':
      return 'Account creation is restricted to approved organization email domains. Make sure your account email is approved or ask an administrator for an invite.';
    case 'provider_disabled':
      return `${label} sign-in is not yet enabled by your administrator in Supabase Auth.`;
    default:
      return `${label} sign-in could not be completed. Please try again or contact your administrator.`;
  }
}
