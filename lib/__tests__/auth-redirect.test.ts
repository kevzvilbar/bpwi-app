import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyOAuthError, getOAuthErrorMessage, sanitizeNextPath } from '../auth-redirect.ts';

describe('auth redirect & OAuth error helpers', () => {
  it('sanitizes relative redirect paths and blocks open redirects', () => {
    assert.equal(sanitizeNextPath('/'), '/');
    assert.equal(sanitizeNextPath('/activities?tab=feed'), '/activities?tab=feed');
    assert.equal(sanitizeNextPath('https://evil.example/phish'), '/');
    assert.equal(sanitizeNextPath('//evil.example/phish'), '/');
    assert.equal(sanitizeNextPath('/\\evil.example'), '/');
    assert.equal(sanitizeNextPath('/ok\nSet-Cookie: bad=1'), '/');
    assert.equal(sanitizeNextPath(null), '/');
  });

  it('classifies OAuth errors into safe login reason codes', () => {
    assert.equal(classifyOAuthError('access_denied', 'User denied permissions'), 'cancelled');
    assert.equal(classifyOAuthError(null, 'User cancelled login'), 'cancelled');
    assert.equal(classifyOAuthError(null, 'Sign-up restricted to approved email domains'), 'domain_restricted');
    assert.equal(classifyOAuthError(null, 'Unsupported provider: provider is not enabled'), 'provider_disabled');
    assert.equal(classifyOAuthError('server_error', 'Unexpected upstream error'), 'oauth_failed');
  });

  it('returns clear user-facing messages for every OAuth reason', () => {
    assert.match(getOAuthErrorMessage('cancelled'), /Social sign-in was cancelled/i);
    assert.match(getOAuthErrorMessage('domain_restricted'), /approved organization email domains/i);
    assert.match(getOAuthErrorMessage('provider_disabled', 'google'), /Google sign-in is not yet enabled/i);
    assert.match(getOAuthErrorMessage('provider_disabled', 'facebook'), /Facebook sign-in is not yet enabled/i);
    assert.match(getOAuthErrorMessage('unknown'), /could not be completed/i);
  });
});
