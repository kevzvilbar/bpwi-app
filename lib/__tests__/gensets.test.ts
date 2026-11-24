import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canAssignGensetToLocation,
  findActiveGensetAtLocation,
  formatGensetTag,
  resolveTaskAssetForLocations,
  type GensetRow,
} from '../gensets.ts';

const SAMPLE_GENSETS: GensetRow[] = [
  {
    id: 'g1',
    control_no: 'GS-01',
    brand_model: 'Cummins C110D5',
    kva_rating: '100 kVA',
    fuel_type: 'Diesel',
    status: 'active',
    current_location: 'Well 1 BAR',
    notes: null,
  },
  {
    id: 'g2',
    control_no: 'GS-04',
    brand_model: 'Perkins 60kVA',
    kva_rating: '60 kVA',
    fuel_type: 'Diesel',
    status: 'active',
    current_location: 'Well 4 BAR',
    notes: null,
  },
  {
    id: 'g3',
    control_no: 'GS-09',
    brand_model: 'Backup Unit',
    kva_rating: null,
    fuel_type: 'Diesel',
    status: 'standby_yard',
    current_location: 'Well 4 BAR',
    notes: 'Pulled for service',
  },
];

describe('gensets helpers', () => {
  it('finds only active gensets by normalized location name', () => {
    assert.equal(findActiveGensetAtLocation(SAMPLE_GENSETS, '  well 4 bar ')?.control_no, 'GS-04');
    assert.equal(findActiveGensetAtLocation(SAMPLE_GENSETS, 'Well 6 PR2'), null);
    assert.equal(findActiveGensetAtLocation(SAMPLE_GENSETS, 'Well 4 BAR', 'g2'), null);
  });

  it('blocks assigning an active genset onto an already-occupied site', () => {
    const blocked = canAssignGensetToLocation(SAMPLE_GENSETS, 'well 1 bar', 'active', 'g2');
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.equal(blocked.occupiedBy.control_no, 'GS-01');
      assert.match(blocked.error, /already has active genset GS-01/);
    }

    assert.equal(canAssignGensetToLocation(SAMPLE_GENSETS, 'Well 6 PR2', 'active', 'g2').ok, true);
    assert.equal(canAssignGensetToLocation(SAMPLE_GENSETS, 'Well 1 BAR', 'standby_yard', 'g2').ok, true);
    assert.equal(canAssignGensetToLocation(SAMPLE_GENSETS, 'Well 1 BAR', 'active', 'g1').ok, true);
  });

  it('auto-tags GENSET PM tasks per site with Control # while respecting manual override', () => {
    assert.equal(formatGensetTag(SAMPLE_GENSETS[0]), 'GS-01 (100 kVA)');
    assert.equal(formatGensetTag(SAMPLE_GENSETS[2]), 'GS-09');

    assert.equal(
      resolveTaskAssetForLocations('GENSET', ['Well 1 BAR'], SAMPLE_GENSETS, ''),
      'GS-01 (100 kVA)',
    );
    assert.equal(
      resolveTaskAssetForLocations('GENSET', ['Well 1 BAR', 'Well 4 BAR'], SAMPLE_GENSETS, ''),
      'GS-01 (100 kVA), GS-04 (60 kVA)',
    );
    assert.equal(
      resolveTaskAssetForLocations('GENSET', ['Well 6 PR2'], SAMPLE_GENSETS, ''),
      null,
    );
    assert.equal(
      resolveTaskAssetForLocations('GENSET', ['Well 1 BAR'], SAMPLE_GENSETS, 'Custom Override'),
      'Custom Override',
    );
    assert.equal(
      resolveTaskAssetForLocations('FLUSH', ['Well 1 BAR'], SAMPLE_GENSETS, ''),
      null,
    );
  });
});
