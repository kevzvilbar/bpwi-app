'use client';

import { useEffect } from 'react';
import { installDialogA11y } from '@/lib/dialogA11y';

/** Mount once in the root layout. Renders nothing; see lib/dialogA11y.ts. */
export default function DialogA11y() {
  useEffect(() => installDialogA11y(), []);
  return null;
}
