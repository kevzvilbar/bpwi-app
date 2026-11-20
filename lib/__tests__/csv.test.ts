import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { csvEscape, csvQuote, neutralizeCsvFormula } from '../csv.ts';

describe('CSV formula injection neutralization and escaping', () => {
  it('prefixes dangerous spreadsheet formula starters with a single quote', () => {
    assert.equal(neutralizeCsvFormula('=SUM(A1:A10)'), "'=SUM(A1:A10)");
    assert.equal(neutralizeCsvFormula('+1+1'), "'+1+1");
    assert.equal(neutralizeCsvFormula('-2+3'), "'-2+3");
    assert.equal(neutralizeCsvFormula('@cmd|calc'), "'@cmd|calc");
    assert.equal(neutralizeCsvFormula('\t=1+1'), "'\t=1+1");
    assert.equal(neutralizeCsvFormula('\r=1+1'), "'\r=1+1");
    assert.equal(neutralizeCsvFormula('  =HYPERLINK("http://evil")'), "'  =HYPERLINK(\"http://evil\")");
  });

  it('leaves normal values, dates, codes, and empty values untouched', () => {
    assert.equal(neutralizeCsvFormula('Operator One'), 'Operator One');
    assert.equal(neutralizeCsvFormula('10-7 PL'), '10-7 PL');
    assert.equal(neutralizeCsvFormula('2026-11-20'), '2026-11-20');
    assert.equal(neutralizeCsvFormula(0), '0');
    assert.equal(neutralizeCsvFormula(null), '');
    assert.equal(neutralizeCsvFormula(undefined), '');
  });

  it('csvEscape quotes only when needed and neutralizes formulas', () => {
    assert.equal(csvEscape('Plain'), 'Plain');
    assert.equal(csvEscape('Doe, Jane'), '"Doe, Jane"');
    assert.equal(csvEscape('=cmd|" /C calc"!A0'), '"\'=cmd|"" /C calc""!A0"');
    assert.equal(csvEscape('+SUM(A1)'), "'+SUM(A1)");
    assert.equal(csvEscape('Line 1\nLine 2'), '"Line 1\nLine 2"');
  });

  it('csvQuote always double-quotes, escapes inner quotes, and neutralizes formulas', () => {
    assert.equal(csvQuote('Plain'), '"Plain"');
    assert.equal(csvQuote('=IMPORTXML("http://x","//a")'), '"\'=IMPORTXML(""http://x"",""//a"")"');
    assert.equal(csvQuote(42), '"42"');
    assert.equal(csvQuote(null), '""');
  });
});
