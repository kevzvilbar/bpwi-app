import { NextResponse } from 'next/server';

const MAX_REPORT_BYTES = 16 * 1024;
const REPORT_WINDOW_MS = 60_000;
const MAX_REPORTS_PER_IP = 30;
const MAX_TRACKED_IPS = 500;

const ipBuckets = new Map<string, { windowStart: number; count: number }>();

function getClientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

function isRateLimited(ip: string, now: number): boolean {
  if (ipBuckets.size >= MAX_TRACKED_IPS && !ipBuckets.has(ip)) {
    for (const [k, entry] of ipBuckets) {
      if (now - entry.windowStart >= REPORT_WINDOW_MS) {
        ipBuckets.delete(k);
      }
    }
    if (ipBuckets.size >= MAX_TRACKED_IPS) {
      const oldestKey = ipBuckets.keys().next().value;
      if (oldestKey !== undefined) ipBuckets.delete(oldestKey);
    }
  }
  const existing = ipBuckets.get(ip);
  if (!existing || now - existing.windowStart >= REPORT_WINDOW_MS) {
    ipBuckets.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  if (existing.count >= MAX_REPORTS_PER_IP) {
    return true;
  }
  existing.count += 1;
  return false;
}

function stripQuery(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.split('?')[0].split('#')[0].slice(0, 300);
}

/**
 * Receives browser `report-uri` CSP violation reports, checks origin host + per-IP throttling,
 * and logs sanitized directive diagnostics without query strings or PII.
 */
export async function POST(req: Request) {
  if (isRateLimited(getClientIp(req), Date.now())) {
    return new NextResponse(null, { status: 204 });
  }

  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_REPORT_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  let rawText = '';
  try {
    rawText = await req.text();
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  if (Buffer.byteLength(rawText, 'utf8') > MAX_REPORT_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return new NextResponse(null, { status: 400 });
  }

  const rec = parsed as Record<string, unknown>;
  const report =
    rec['csp-report'] && typeof rec['csp-report'] === 'object' && !Array.isArray(rec['csp-report'])
      ? (rec['csp-report'] as Record<string, unknown>)
      : rec;

  const docUri = stripQuery(report['document-uri']);
  if (docUri) {
    try {
      const docHost = new URL(docUri).host.toLowerCase();
      const reqHost = (
        req.headers.get('x-forwarded-host') ||
        req.headers.get('host') ||
        new URL(req.url).host
      ).toLowerCase();
      if (reqHost && docHost !== reqHost) {
        return new NextResponse(null, { status: 204 });
      }
    } catch {
      return new NextResponse(null, { status: 204 });
    }
  }

  console.warn('[csp-violation]', {
    documentUri: docUri,
    violatedDirective:
      typeof report['violated-directive'] === 'string'
        ? report['violated-directive'].slice(0, 120)
        : undefined,
    blockedUri: stripQuery(report['blocked-uri']),
    disposition: typeof report.disposition === 'string' ? report.disposition.slice(0, 32) : undefined,
  });

  return new NextResponse(null, { status: 204 });
}
