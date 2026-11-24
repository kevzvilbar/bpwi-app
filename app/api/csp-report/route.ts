import { NextResponse } from 'next/server';

const MAX_REPORT_BYTES = 16 * 1024;

function stripQuery(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.split('?')[0].split('#')[0].slice(0, 300);
}

/**
 * Receives browser CSP violation reports (`application/csp-report` or `application/json`)
 * and logs sanitized directive diagnostics without query strings or PII.
 */
export async function POST(req: Request) {
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

  console.warn('[csp-violation]', {
    documentUri: stripQuery(report['document-uri'] ?? report.documentURL),
    violatedDirective:
      typeof (report['violated-directive'] ?? report.effectiveDirective) === 'string'
        ? String(report['violated-directive'] ?? report.effectiveDirective).slice(0, 120)
        : undefined,
    blockedUri: stripQuery(report['blocked-uri'] ?? report.blockedURL),
    disposition: typeof report.disposition === 'string' ? report.disposition.slice(0, 32) : undefined,
  });

  return new NextResponse(null, { status: 204 });
}
