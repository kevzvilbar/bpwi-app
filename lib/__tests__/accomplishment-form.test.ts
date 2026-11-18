import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TECHNICAL_COLUMNS,
  PROJECT_COLUMNS,
  mapActivityToFormColumn,
  parseLocationParts,
  formatManilaTime12,
  activityToAccomplishmentEntry,
} from '../accomplishment-form.ts';
import type { DailyActivityRow } from '../activity-types.ts';

describe('BPEMS-F-002 accomplishment form mapping', () => {
  it('defines the exact 7 TECHNICAL and 7 PROJECT columns', () => {
    assert.deepEqual(
      TECHNICAL_COLUMNS.map((c) => c.label),
      ['LEAK REPAIR', 'LEAK DETECTION', 'P&M PULL-OUT', 'TANK CLEANING', 'FLUSHING', 'METER INSTALLATION', 'P&M TESTING'],
    );
    assert.deepEqual(
      PROJECT_COLUMNS.map((c) => c.label),
      ['DISC', 'REC', 'PS MON', 'WQ INSP', 'NW INSP', 'LP INSP', 'METER TEST'],
    );
  });

  it('maps activity types to exact BPEMS-F-002 columns or OTHERS (SPECIFY)', () => {
    assert.deepEqual(mapActivityToFormColumn('flushing'), { column_id: 'flushing', others_specify: '' });
    assert.deepEqual(mapActivityToFormColumn('leak_repair'), { column_id: 'leak_repair', others_specify: '' });
    assert.deepEqual(mapActivityToFormColumn('well_pull_out'), { column_id: 'pm_pull_out', others_specify: '' });
    assert.deepEqual(mapActivityToFormColumn('water_sampling'), { column_id: 'wq_insp', others_specify: '' });
    assert.deepEqual(mapActivityToFormColumn('water_level_monitoring'), { column_id: null, others_specify: 'W.M' });
  });

  it('parses PH, BLK, and LOT from free-text block_lot', () => {
    assert.deepEqual(parseLocationParts('Ph 2 Blk 14 Lot 8'), { ph: '2', blk: '14', lot: '8' });
    assert.deepEqual(parseLocationParts('Block 004 Lot 012'), { ph: '', blk: '004', lot: '012' });
  });

  it('formats ISO timestamps into Manila 12-hour time', () => {
    assert.equal(formatManilaTime12('2026-08-24T07:10:00Z'), '3:10 PM');
  });

  it('converts a DailyActivityRow into an AccomplishmentEntry with readings in remarks', () => {
    const act: DailyActivityRow = {
      id: 'a1',
      organization_id: 'o1',
      activity_date: '2026-08-24',
      logged_by: 'u1',
      lead_operator_id: null,
      crew_operator_ids: [],
      shift_type_id: null,
      area_code_id: null,
      site_or_well: 'Well 5 Sta. Barbara',
      block_lot: 'Ph 1 Blk 2 Lot 3',
      activity_type: 'flushing',
      pm_task_id: null,
      job_order_id: null,
      status: 'submitted',
      started_at: '2026-08-24T08:36:00Z',
      completed_at: '2026-08-24T08:40:00Z',
      gps_lat: null,
      gps_lng: null,
      notes: 'Flowmeter reading before flushing - 099097',
      details: { pressure_psi: 42 },
      photo_urls: [],
      photo_storage_paths: [],
      photos_expires_at: null,
      photos_purged_at: null,
      signature_data: null,
      verified_by: null,
      verified_at: null,
      review_note: null,
      created_at: '2026-08-24T08:40:00Z',
      updated_at: '2026-08-24T08:40:00Z',
    };

    const entry = activityToAccomplishmentEntry(act);
    assert.equal(entry.column_id, 'flushing');
    assert.equal(entry.location_project, 'Well 5 Sta. Barbara');
    assert.equal(entry.location_ph, '1');
    assert.equal(entry.location_blk, '2');
    assert.equal(entry.location_lot, '3');
    assert.equal(entry.time_started, '4:36 PM');
    assert.equal(entry.time_finished, '4:40 PM');
    assert.match(entry.remarks, /PG: 42 PSI/);
    assert.match(entry.remarks, /099097/);
  });
});
