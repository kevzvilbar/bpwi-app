/**
 * Keyboard/focus behaviour for every `.modal-overlay[role="dialog"]` in the app.
 *
 * The dialogs are rendered inline by their owning components, so rather than edit each one this
 * module watches the DOM and, for the top-most open dialog:
 *  - moves focus into it when it opens and returns focus to the trigger when it closes,
 *  - keeps Tab / Shift+Tab inside it,
 *  - closes it on Escape by clicking the overlay, which runs the component's own close handler
 *    (and therefore its "busy" guards).
 *
 * The slide-out nav drawer has its own focus handling and uses `.drawer-overlay`, so it is not touched.
 */

const DIALOG_SELECTOR = '.modal-overlay[role="dialog"]';
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function topDialog(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(DIALOG_SELECTOR);
  return all.length ? all[all.length - 1] : null;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden',
  );
}

export function installDialogA11y(): () => void {
  const open = new Map<HTMLElement, HTMLElement | null>();
  let queued = false;

  const focusInto = (dialog: HTMLElement) => {
    requestAnimationFrame(() => {
      if (!dialog.isConnected || dialog.contains(document.activeElement)) return;
      const sheet = dialog.querySelector<HTMLElement>('.modal-sheet') ?? dialog;
      const first = focusables(sheet)[0];
      if (first) {
        first.focus();
      } else {
        if (!sheet.hasAttribute('tabindex')) sheet.setAttribute('tabindex', '-1');
        sheet.focus();
      }
    });
  };

  const sync = () => {
    queued = false;
    const current = new Set(document.querySelectorAll<HTMLElement>(DIALOG_SELECTOR));
    current.forEach((dialog) => {
      if (!open.has(dialog)) {
        const active = document.activeElement;
        open.set(dialog, active instanceof HTMLElement && active !== document.body ? active : null);
        focusInto(dialog);
      }
    });
    open.forEach((returnTo, dialog) => {
      if (!current.has(dialog)) {
        open.delete(dialog);
        // Only restore focus when nothing else has claimed it (e.g. another dialog just opened).
        const stillOrphaned = !document.activeElement || document.activeElement === document.body;
        if (returnTo && returnTo.isConnected && stillOrphaned) returnTo.focus();
      }
    });
  };

  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const dialog = topDialog();
    if (!dialog) return;

    if (e.key === 'Escape') {
      if (e.defaultPrevented) return;
      e.preventDefault();
      dialog.click(); // runs the overlay's own onClick close handler
      return;
    }

    if (e.key !== 'Tab') return;
    const items = focusables(dialog);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!dialog.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('keydown', onKeyDown);
  schedule();

  return () => {
    observer.disconnect();
    document.removeEventListener('keydown', onKeyDown);
    open.clear();
  };
}
