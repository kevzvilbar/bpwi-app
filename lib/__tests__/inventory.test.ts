import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInventoryCsv,
  classifyStockStatus,
  computeCountAdjustmentDelta,
  computeInventorySummaries,
  formatInventoryQty,
  isMissingInventoryTableError,
  normalizeInventorySiteKey,
  type ConsumableItemRow,
  type ConsumableMovementRow,
} from '../inventory.ts';

const ITEMS: ConsumableItemRow[] = [
  {
    id: 'item-cl-gran',
    organization_id: 'org-1',
    code: 'CHLORINE_GRAN',
    name: 'Chlorine — Calcium Hypochlorite 70% (Granules)',
    category: 'chlorine',
    unit: 'kg',
    low_stock_threshold: 25,
    is_active: true,
    sort_order: 10,
  },
  {
    id: 'item-gas',
    organization_id: 'org-1',
    code: 'GASOLINE',
    name: 'Gasoline',
    category: 'fuel',
    unit: 'L',
    low_stock_threshold: 20,
    is_active: true,
    sort_order: 30,
  },
  {
    id: 'item-archived',
    organization_id: 'org-1',
    code: null,
    name: 'Old Filter Media',
    category: 'other',
    unit: 'bag',
    low_stock_threshold: 5,
    is_active: false,
    sort_order: 99,
  },
];

describe('consumables inventory helpers', () => {
  it('normalizes site keys, formats quantities, computes count deltas, and classifies stock status', () => {
    assert.equal(normalizeInventorySiteKey('  Well 4   BAR '), 'well 4 bar');
    assert.equal(formatInventoryQty(12.5, 'L'), '12.5 L');
    assert.equal(formatInventoryQty(40, 'kg'), '40 kg');
    assert.equal(formatInventoryQty(3.125, 'L'), '3.13 L');

    assert.equal(computeCountAdjustmentDelta(45.5, 42.25), -3.25);
    assert.equal(computeCountAdjustmentDelta(10, 15.125), 5.125);

    assert.equal(classifyStockStatus(0, 20), 'out');
    assert.equal(classifyStockStatus(-2, 20), 'out');
    assert.equal(classifyStockStatus(20, 20), 'low');
    assert.equal(classifyStockStatus(10, 20), 'low');
    assert.equal(classifyStockStatus(21, 20), 'ok');
    assert.equal(classifyStockStatus(5, 0), 'ok');
  });

  it('aggregates balances per well/pump site across auto and manual movements and exports safe CSV', () => {
    const movements: ConsumableMovementRow[] = [
      {
        id: 'm-1',
        organization_id: 'org-1',
        item_id: 'item-cl-gran',
        site_name: 'Well 4 BAR',
        movement_type: 'opening_stock',
        quantity_delta: 50,
        movement_date: '2026-11-20',
        activity_id: null,
        reference_no: null,
        notes: 'Initial count',
        created_by: 'u-1',
        created_at: '2026-11-20T01:00:00Z',
      },
      {
        id: 'm-2',
        organization_id: 'org-1',
        item_id: 'item-cl-gran',
        site_name: '  well 4   bar ',
        movement_type: 'activity_usage',
        quantity_delta: -30,
        movement_date: '2026-11-24',
        activity_id: 'act-1',
        reference_no: null,
        notes: 'Auto from Chlorine Refill log',
        created_by: 'u-2',
        created_at: '2026-11-24T04:00:00Z',
      },
      {
        id: 'm-3',
        organization_id: 'org-1',
        item_id: 'item-gas',
        site_name: 'Pavia Plant',
        movement_type: 'delivery',
        quantity_delta: 40,
        movement_date: '2026-11-21',
        activity_id: null,
        reference_no: 'DR-101',
        notes: null,
        created_by: 'u-1',
        created_at: '2026-11-21T02:00:00Z',
      },
      {
        id: 'm-4',
        organization_id: 'org-1',
        item_id: 'item-gas',
        site_name: 'Pavia Plant',
        movement_type: 'activity_usage',
        quantity_delta: -40,
        movement_date: '2026-11-25',
        activity_id: 'act-2',
        reference_no: null,
        notes: null,
        created_by: 'u-2',
        created_at: '2026-11-25T02:00:00Z',
      },
    ];

    const res = computeInventorySummaries({
      items: ITEMS,
      movements,
      savedSiteNames: ['Well 4 BAR', 'Empty Well 9'],
    });

    assert.equal(res.stats.totalSites, 3);
    assert.equal(res.stats.sitesWithStock, 2);
    assert.equal(res.stats.activeItems, 2);
    assert.equal(res.stats.lowCount, 1);
    assert.equal(res.stats.outCount, 1);

    const well4 = res.sites.find((s) => s.siteName === 'Well 4 BAR');
    assert.ok(well4);
    assert.equal(well4.balances.length, 1);
    assert.equal(well4.balances[0].balance, 20);
    assert.equal(well4.balances[0].status, 'low');
    assert.equal(well4.balances[0].lastMovementDate, '2026-11-24');

    const pavia = res.sites.find((s) => s.siteName === 'Pavia Plant');
    assert.ok(pavia);
    assert.equal(pavia.balances[0].balance, 0);
    assert.equal(pavia.balances[0].status, 'out');

    const csv = buildInventoryCsv(res.sites);
    assert.match(csv, /Well 4 BAR,.*20,kg,25,LOW,2026-11-24/);
    assert.match(csv, /Pavia Plant,Gasoline,Fuel,0,L,20,OUT,2026-11-25/);
  });

  it('detects missing inventory table errors across Postgres and PostgREST error shapes', () => {
    assert.equal(isMissingInventoryTableError({ code: '42P01' }), true);
    assert.equal(isMissingInventoryTableError({ code: 'PGRST205' }), true);
    assert.equal(isMissingInventoryTableError({ message: 'relation "consumable_items" does not exist' }), true);
    assert.equal(isMissingInventoryTableError({ message: 'permission denied' }), false);
    assert.equal(isMissingInventoryTableError(null), false);
  });
});
