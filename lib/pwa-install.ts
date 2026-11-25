export type InstallPlatform = 'installed' | 'ios' | 'android' | 'desktop';

export const INSTALL_DISMISS_STORAGE_KEY = 'bpwi-pwa-install-dismissed-until';
export const INSTALL_DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const OPEN_INSTALL_EVENT = 'bpwi-open-install';

export function detectInstallPlatform(userAgent: string, isStandalone: boolean): InstallPlatform {
  if (isStandalone) return 'installed';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios';
  if (/android/i.test(userAgent)) return 'android';
  return 'desktop';
}

export function shouldShowInstallBanner(opts: {
  isStandalone: boolean;
  dismissedUntilMs: number | null;
  nowMs: number;
  hasDeferredPrompt: boolean;
  platform: InstallPlatform;
}): boolean {
  if (opts.isStandalone || opts.platform === 'installed') return false;
  if (opts.dismissedUntilMs !== null && Number.isFinite(opts.dismissedUntilMs) && opts.dismissedUntilMs > opts.nowMs) {
    return false;
  }
  return opts.hasDeferredPrompt || opts.platform === 'ios';
}
