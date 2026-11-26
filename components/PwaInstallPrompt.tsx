'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  detectInstallPlatform,
  INSTALL_DISMISS_STORAGE_KEY,
  INSTALL_DISMISS_TTL_MS,
  OPEN_INSTALL_EVENT,
  shouldShowInstallBanner,
  type InstallPlatform,
} from '@/lib/pwa-install';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function readStandaloneFlag(): boolean {
  if (typeof window === 'undefined') return false;
  const mediaMatch = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return mediaMatch || iosStandalone;
}

function readDismissedUntil(): number | null {
  try {
    const raw = localStorage.getItem(INSTALL_DISMISS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export default function PwaInstallPrompt() {
  const [platform, setPlatform] = useState<InstallPlatform>('desktop');
  const [isStandalone, setIsStandalone] = useState(true);
  const [dismissedUntilMs, setDismissedUntilMs] = useState<number | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const triggerInstall = useCallback(async (promptEvent: BeforeInstallPromptEvent | null) => {
    if (promptEvent) {
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        setDeferredPrompt(null);
        if (choice.outcome === 'accepted') {
          setIsStandalone(true);
          setGuideOpen(false);
        }
        return;
      } catch {
        /* fall back to manual instructions */
      }
    }
    setGuideOpen(true);
  }, []);

  useEffect(() => {
    const standalone = readStandaloneFlag();
    setIsStandalone(standalone);
    setPlatform(detectInstallPlatform(navigator.userAgent, standalone));
    setDismissedUntilMs(readDismissedUntil());

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setIsStandalone(true);
      setDeferredPrompt(null);
      setGuideOpen(false);
      setPlatform('installed');
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  useEffect(() => {
    const onManualOpen = () => {
      void triggerInstall(deferredPrompt);
    };
    window.addEventListener(OPEN_INSTALL_EVENT, onManualOpen);
    return () => window.removeEventListener(OPEN_INSTALL_EVENT, onManualOpen);
  }, [deferredPrompt, triggerInstall]);

  const showBanner = shouldShowInstallBanner({
    isStandalone,
    dismissedUntilMs,
    nowMs: Date.now(),
    hasDeferredPrompt: deferredPrompt !== null,
    platform,
  });

  function dismissBanner() {
    const until = Date.now() + INSTALL_DISMISS_TTL_MS;
    setDismissedUntilMs(until);
    try {
      localStorage.setItem(INSTALL_DISMISS_STORAGE_KEY, String(until));
    } catch {
      /* ignore storage errors */
    }
  }

  return (
    <>
      {showBanner && (
        <div
          role="region"
          aria-label="Install app"
          className="no-print"
          style={{
            background: 'var(--info-bg)',
            color: 'var(--info-fg)',
            borderBottom: '1px solid var(--info-border)',
            padding: '7px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
            fontSize: 12.5,
          }}
        >
          <span>
            <strong>Install BPWI Ops</strong> on your phone for one-tap home screen access &amp; offline field logging.
          </span>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void triggerInstall(deferredPrompt)}
            >
              {deferredPrompt ? 'Install App' : 'How to Install'}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={dismissBanner}
            >
              Later
            </button>
          </div>
        </div>
      )}

      {guideOpen && (
        <div className="modal-overlay no-print" role="dialog" aria-modal="true" aria-labelledby="pwa-install-guide-title" onClick={() => setGuideOpen(false)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, display: 'grid', gap: 12 }}>
            <h2 id="pwa-install-guide-title" style={{ margin: 0, fontSize: 17 }}>
              Install BPWI Ops on your phone
            </h2>
            {platform === 'ios' ? (
              <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                <li>
                  Open this site in <strong>Safari</strong> and tap the <strong>Share</strong> icon (square with upward arrow) at the bottom or top toolbar.
                </li>
                <li>
                  Scroll down and tap <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.
                </li>
              </ol>
            ) : (
              <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                <li>
                  Open your browser menu (<strong>⋮</strong> in Chrome/Edge on Android, or the install icon in desktop Chrome/Edge address bar).
                </li>
                <li>
                  Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                </li>
              </ol>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-primary" onClick={() => setGuideOpen(false)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
