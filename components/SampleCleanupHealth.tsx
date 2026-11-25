'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { describeSampleCleanupHealth, type SampleCleanupHealth as Health } from '@/lib/sample-logs';
import { AlertBanner } from '@/components/ui/AlertBanner';

/**
 * Admin-only. Warns when 24h sample logs are not being deleted (pg_cron or the cron secret is missing),
 * so expired samples can never pile up silently. Renders nothing while healthy or on any lookup error.
 */
export default function SampleCleanupHealth() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error } = await supabaseBrowser().rpc('sample_cleanup_health');
        if (!active || error) return;
        setMessage(describeSampleCleanupHealth(data as Health | null));
      } catch {
        /* migration 035 not applied yet, or offline: stay silent */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!message) return null;
  return (
    <AlertBanner tone="warn" onDismiss={() => setMessage(null)}>
      <b>Sample cleanup needs attention.</b> {message}
    </AlertBanner>
  );
}
