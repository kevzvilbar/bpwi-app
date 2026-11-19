import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRosterCsv,
  DEFAULT_STATION_CODE,
  findOffShift,
  isHolidayArea,
  isOffPartnerArea,
  normalizeLegacyStationCode,
  normalizeShiftForArea,
  resolveAreaSelection,
  resolveShiftSelection,
  type Area,
  type Op,
  type RosterDay,
  type Row,
  type Shift,
  type Standby,
} from '../roster-helpers.ts';

const S_10_7: Shift = {
  id: 's-10-7',
  code: '10-7',
  description: '10 AM – 7 PM',
  duration_hours: 8,
  background_color: '#ea580c',
  text_color: '#ffffff',
  is_off: false,
};

const S_8_4: Shift = {
  id: 's-8-4',
  code: '8-4',
  description: '8 AM – 4 PM',
  duration_hours: 8,
  background_color: '#16a34a',
  text_color: '#ffffff',
  is_off: false,
};

const S_OFF: Shift = {
  id: 's-off',
  code: 'OFF (White)',
  description: 'Day Off / Non-Working',
  duration_hours: 0,
  background_color: '#f8fafc',
  text_color: '#0f172a',
  is_off: true,
};

const A_PL: Area = {
  id: 'a-pl',
  code: 'PL',
  name: 'Plant Operations',
  category: 'station',
  background_color: '#f1f5f9',
  text_color: '#1e293b',
};

const A_AL: Area = {
  id: 'a-al',
  code: 'AL',
  name: 'Annual Leave',
  category: 'leave',
  background_color: '#f1f5f9',
  text_color: '#9f1239',
};

const A_RD: Area = {
  id: 'a-rd',
  code: 'RD',
  name: 'Rest Day',
  category: 'rest',
  background_color: '#f1f5f9',
  text_color: '#1e293b',
};

const A_H: Area = {
  id: 'a-h',
  code: 'H',
  name: 'Holiday',
  category: 'holiday',
  background_color: '#f1f5f9',
  text_color: '#92400e',
};

const shiftBy = new Map<string, Shift>([S_10_7, S_8_4, S_OFF].map((s) => [s.id, s]));
const areaBy = new Map<string, Area>([A_PL, A_AL, A_RD, A_H].map((a) => [a.id, a]));

describe('roster-helpers off-shift partnering', () => {
  it('exposes DEFAULT_STATION_CODE PL and maps legacy 6 station codes down to PL, FD, WD', () => {
    assert.equal(DEFAULT_STATION_CODE, 'PL');
    assert.equal(normalizeLegacyStationCode('PW'), 'PL');
    assert.equal(normalizeLegacyStationCode(' pw '), 'PL');
    for (const legacyField of ['RM', 'LD', 'MR', 'WM', 'rm']) {
      assert.equal(normalizeLegacyStationCode(legacyField), 'FD');
    }
    for (const keep of ['PL', 'FD', 'WD', 'RD', 'AL', 'VL', 'SL', 'H']) {
      assert.equal(normalizeLegacyStationCode(keep), keep);
    }
  });

  it('identifies holiday and off-partner areas plus the OFF shift', () => {
    assert.equal(isHolidayArea(A_H), true);
    assert.equal(isHolidayArea({ code: 'h', category: 'leave' }), true);
    assert.equal(isHolidayArea(A_PL), false);

    assert.equal(isOffPartnerArea(A_AL), true);
    assert.equal(isOffPartnerArea(A_RD), true);
    assert.equal(isOffPartnerArea(A_H), true);
    assert.equal(isOffPartnerArea(A_PL), false);
    assert.equal(isOffPartnerArea(undefined), false);

    assert.equal(findOffShift([S_10_7, S_8_4, S_OFF])?.id, S_OFF.id);
    assert.equal(
      findOffShift([{ code: 'OFF (White)', is_off: false }, { code: '10-7', is_off: false }])?.code,
      'OFF (White)',
    );
    assert.equal(findOffShift([S_10_7, S_8_4]), undefined);
  });

  it('normalizes shift_type_id to OFF for leave, rest day, and holiday cells', () => {
    assert.equal(normalizeShiftForArea(S_10_7.id, A_AL.id, areaBy, S_OFF), S_OFF.id);
    assert.equal(normalizeShiftForArea(S_8_4.id, A_RD.id, areaBy, S_OFF), S_OFF.id);
    assert.equal(normalizeShiftForArea(null, A_H.id, areaBy, S_OFF), S_OFF.id);
    assert.equal(normalizeShiftForArea(S_10_7.id, A_AL.id, areaBy, undefined), null);
    assert.equal(normalizeShiftForArea(S_10_7.id, A_PL.id, areaBy, S_OFF), S_10_7.id);
    assert.equal(normalizeShiftForArea(S_OFF.id, null, areaBy, S_OFF), S_OFF.id);
  });

  it('auto-switches brush between OFF (White) and last duty shift on area selection', () => {
    // Selecting Leave, Rest Day, or Holiday auto-partners with OFF (White)
    assert.deepEqual(
      resolveAreaSelection(A_AL.id, S_10_7.id, S_10_7.id, shiftBy, areaBy, S_OFF),
      { shiftId: S_OFF.id, areaId: A_AL.id },
    );
    assert.deepEqual(
      resolveAreaSelection(A_RD.id, S_8_4.id, S_8_4.id, shiftBy, areaBy, S_OFF),
      { shiftId: S_OFF.id, areaId: A_RD.id },
    );
    assert.deepEqual(
      resolveAreaSelection(A_H.id, S_10_7.id, S_10_7.id, shiftBy, areaBy, S_OFF),
      { shiftId: S_OFF.id, areaId: A_H.id },
    );

    // Selecting a station area after OFF restores the last duty shift
    assert.deepEqual(
      resolveAreaSelection(A_PL.id, S_OFF.id, S_8_4.id, shiftBy, areaBy, S_OFF),
      { shiftId: S_8_4.id, areaId: A_PL.id },
    );

    // Selecting PL (default) -> null keeps OFF (White) so plain OFF cells can still be painted
    assert.deepEqual(
      resolveAreaSelection(null, S_OFF.id, S_8_4.id, shiftBy, areaBy, S_OFF),
      { shiftId: S_OFF.id, areaId: null },
    );
  });

  it('clears incompatible area when selecting duty vs OFF shifts', () => {
    // Duty shift clears Leave / Rest Day / Holiday area
    assert.deepEqual(resolveShiftSelection(S_10_7.id, A_AL.id, shiftBy, areaBy), {
      shiftId: S_10_7.id,
      areaId: null,
    });
    assert.deepEqual(resolveShiftSelection(S_8_4.id, A_RD.id, shiftBy, areaBy), {
      shiftId: S_8_4.id,
      areaId: null,
    });
    assert.deepEqual(resolveShiftSelection(S_10_7.id, A_H.id, shiftBy, areaBy), {
      shiftId: S_10_7.id,
      areaId: null,
    });

    // OFF (White) clears station area, but preserves Leave / Rest Day / Holiday area
    assert.deepEqual(resolveShiftSelection(S_OFF.id, A_PL.id, shiftBy, areaBy), {
      shiftId: S_OFF.id,
      areaId: null,
    });
    assert.deepEqual(resolveShiftSelection(S_OFF.id, A_AL.id, shiftBy, areaBy), {
      shiftId: S_OFF.id,
      areaId: A_AL.id,
    });
  });

  it('treats leave, rest day, and holiday as non-duty with OFF shift in buildRosterCsv even on legacy rows', () => {
    const ops: Op[] = [{ id: 'op-1', full_name: 'Operator One', position: 'Operator' }];
    const days: RosterDay[] = [
      { date: '2026-11-01', dayNum: 1, dow: 0, dowLabel: 'Sun', isWeekend: true },
      { date: '2026-11-02', dayNum: 2, dow: 1, dowLabel: 'Mon', isWeekend: false },
      { date: '2026-11-03', dayNum: 3, dow: 2, dowLabel: 'Tue', isWeekend: false },
      { date: '2026-11-04', dayNum: 4, dow: 3, dowLabel: 'Wed', isWeekend: false },
    ];
    const cell = new Map<string, Row>([
      ['op-1:2026-11-01', { operator_id: 'op-1', schedule_date: '2026-11-01', shift_type_id: S_10_7.id, area_code_id: null }],
      // Legacy dirty row: AL paired with a duty shift instead of OFF
      ['op-1:2026-11-02', { operator_id: 'op-1', schedule_date: '2026-11-02', shift_type_id: S_10_7.id, area_code_id: A_AL.id }],
      ['op-1:2026-11-03', { operator_id: 'op-1', schedule_date: '2026-11-03', shift_type_id: null, area_code_id: A_RD.id }],
      ['op-1:2026-11-04', { operator_id: 'op-1', schedule_date: '2026-11-04', shift_type_id: S_8_4.id, area_code_id: A_H.id }],
    ]);
    const csv = buildRosterCsv({
      days,
      operators: ops,
      cell,
      shiftBy,
      areaBy,
      standbyMap: new Map<string, Standby>(),
    });
    const rows = csv.split('\n');
    assert.equal(rows.length, 2);
    // Unassigned duty area defaults to PL; AL -> Leaves=1 & Off=1, RD -> Off=2, H -> Off=3, Duty=1, Hours=8
    assert.equal(rows[1], 'Operator One,Operator,10-7 PL,AL,RD,H,1,0,8,3,1');
  });
});
