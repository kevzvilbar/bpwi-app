import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InventoryManager from '@/components/InventoryManager';
import type { ConsumableItemRow, ConsumableMovementRow } from '@/lib/inventory';

type QueryResult<T = unknown> = Promise<{ data: T; error: { message: string } | null }>;

const movementInsertPayloads: Array<Array<Record<string, unknown>>> = [];
const itemInsertPayloads: Array<Record<string, unknown>> = [];

const rangeMock = vi.fn<() => QueryResult<Record<string, unknown>[]> & { count?: number }>();
const movementSelectMock = vi.fn(() => ({
  order: () => ({ order: () => ({ range: rangeMock }) }),
}));
const movementInsertSelectMock = vi.fn<() => QueryResult<Record<string, unknown>[]>>();
const movementInsertMock = vi.fn((payload: Array<Record<string, unknown>>) => {
  movementInsertPayloads.push(payload);
  return { select: movementInsertSelectMock };
});

const itemSingleMock = vi.fn<() => QueryResult<Record<string, unknown>>>();
const itemInsertMock = vi.fn((payload: Record<string, unknown>) => {
  itemInsertPayloads.push(payload);
  return { select: () => ({ single: itemSingleMock }) };
});

vi.mock('@/lib/supabase/client', () => ({
  supabaseBrowser: () => ({
    from: (table: string) => {
      if (table === 'consumable_movements') {
        return { select: movementSelectMock, insert: movementInsertMock };
      }
      if (table === 'consumable_items') {
        return {
          insert: itemInsertMock,
          update: () => ({ eq: () => ({ select: () => ({ single: itemSingleMock }) }) }),
        };
      }
      throw new Error(`Unexpected table mock: ${table}`);
    },
  }),
}));

const ITEMS: ConsumableItemRow[] = [
  {
    id: 'item-cl',
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
];

const MOVEMENTS: ConsumableMovementRow[] = [
  {
    id: 'mv-1',
    organization_id: 'org-1',
    item_id: 'item-cl',
    site_name: 'Well 4 BAR',
    movement_type: 'opening_stock',
    quantity_delta: 40,
    movement_date: '2026-11-20',
    activity_id: null,
    reference_no: null,
    notes: 'Initial stock',
    created_by: 'u-mgr',
    created_at: '2026-11-20T00:00:00Z',
  },
  {
    id: 'mv-2',
    organization_id: 'org-1',
    item_id: 'item-gas',
    site_name: 'Well 4 BAR',
    movement_type: 'delivery',
    quantity_delta: 15,
    movement_date: '2026-11-21',
    activity_id: null,
    reference_no: 'DR-201',
    notes: 'Gasoline delivery',
    created_by: 'u-mgr',
    created_at: '2026-11-21T00:00:00Z',
  },
];

describe('InventoryManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    movementInsertPayloads.length = 0;
    itemInsertPayloads.length = 0;

    movementInsertSelectMock.mockImplementation(async () => {
      const latest = movementInsertPayloads[movementInsertPayloads.length - 1] ?? [];
      return {
        data: latest.map((row, idx) => ({
          id: `mv-new-${movementInsertPayloads.length}-${idx}`,
          activity_id: null,
          created_at: '2026-11-26T08:00:00Z',
          ...row,
        })),
        error: null,
      };
    });

    rangeMock.mockResolvedValue({ data: [], error: null });

    itemSingleMock.mockImplementation(async () => {
      const latest = itemInsertPayloads[itemInsertPayloads.length - 1] ?? {};
      return {
        data: {
          id: `item-new-${itemInsertPayloads.length}`,
          code: null,
          is_active: true,
          sort_order: 200,
          created_at: '2026-11-26T08:00:00Z',
          updated_at: '2026-11-26T08:00:00Z',
          ...latest,
        },
        error: null,
      };
    });
  });

  it('shows read-only per-site stock balances for operators without management buttons', () => {
    render(
      <InventoryManager
        orgId="org-1"
        userId="u-op"
        today="2026-11-26"
        canManage={false}
        inventoryTableReady={true}
        initialItems={ITEMS}
        initialMovements={MOVEMENTS}
        savedSiteNames={['Well 4 BAR']}
        userNameById={{ 'u-mgr': 'Kevin Vilbar' }}
      />,
    );

    expect(screen.getByText('Well 4 BAR')).toBeInTheDocument();
    expect(screen.getByText('40 kg')).toBeInTheDocument();
    expect(screen.getByText('15 L')).toBeInTheDocument();
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Record Stock' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add Consumable' })).not.toBeInTheDocument();
  });

  it('lets managers record a count correction delta and add a new consumable item', async () => {
    const user = userEvent.setup();
    render(
      <InventoryManager
        orgId="org-1"
        userId="u-mgr"
        today="2026-11-26"
        canManage={true}
        inventoryTableReady={true}
        initialItems={ITEMS}
        initialMovements={MOVEMENTS}
        savedSiteNames={['Well 4 BAR']}
        userNameById={{ 'u-mgr': 'Kevin Vilbar' }}
      />,
    );

    // Click inline Count button for Well 4 BAR Chlorine (currently 40 kg -> count 32.5 kg => -7.5 kg)
    const countButtons = screen.getAllByRole('button', { name: 'Count' });
    await user.click(countButtons[0]);

    const dialog = screen.getByRole('dialog', { name: 'Record stock movement' });
    expect(within(dialog).getByText('40 kg')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Physical Count'), '32.5');
    expect(within(dialog).getByText('-7.5 kg')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save Movement' }));

    await waitFor(() => {
      expect(movementInsertMock).toHaveBeenCalledTimes(1);
    });
    expect(movementInsertPayloads[0][0]).toEqual(
      expect.objectContaining({
        organization_id: 'org-1',
        item_id: 'item-cl',
        site_name: 'Well 4 BAR',
        movement_type: 'adjustment',
        quantity_delta: -7.5,
      }),
    );
    expect(screen.getByText('32.5 kg')).toBeInTheDocument();

    // Add a new custom consumable item ("Engine Oil 15W-40")
    await user.click(screen.getByRole('button', { name: '+ Add Consumable' }));
    const itemDialog = screen.getByRole('dialog', { name: 'Add consumable item' });
    await user.type(within(itemDialog).getByLabelText('Item Name'), 'Engine Oil 15W-40');
    await user.selectOptions(within(itemDialog).getByLabelText('Category'), 'lubricant');
    const unitInput = within(itemDialog).getByLabelText('Unit');
    await user.clear(unitInput);
    await user.type(unitInput, 'L');
    await user.click(within(itemDialog).getByRole('button', { name: 'Add Consumable' }));

    await waitFor(() => {
      expect(itemInsertMock).toHaveBeenCalledTimes(1);
    });
    expect(itemInsertPayloads[0]).toEqual(
      expect.objectContaining({
        organization_id: 'org-1',
        name: 'Engine Oil 15W-40',
        category: 'lubricant',
        unit: 'L',
      }),
    );
    expect(screen.getByRole('tab', { name: /Catalog \(3\)/i })).toBeInTheDocument();
  });

  it('uses DB-aggregated balances when supplied and paginates the movement ledger', async () => {
    const user = userEvent.setup();
    rangeMock.mockResolvedValueOnce({
      data: [
        {
          id: 'mv-3',
          organization_id: 'org-1',
          item_id: 'item-gas',
          site_name: 'Well 4 BAR',
          movement_type: 'manual_usage',
          quantity_delta: -5,
          movement_date: '2026-11-19',
          activity_id: null,
          reference_no: null,
          notes: 'Older generator run',
          created_by: 'u-mgr',
          created_at: '2026-11-19T00:00:00Z',
        },
      ],
      error: null,
      count: 3,
    } as never);

    render(
      <InventoryManager
        orgId="org-1"
        userId="u-op"
        today="2026-11-26"
        canManage={false}
        inventoryTableReady={true}
        initialItems={ITEMS}
        initialBalances={[
          {
            site_key: 'well 4 bar',
            site_name: 'Well 4 BAR',
            item_id: 'item-cl',
            balance: 77,
            movement_count: 5,
            last_movement_date: '2026-11-26',
          },
        ]}
        initialMovements={MOVEMENTS}
        initialTotalMovements={3}
        ledgerPageSize={2}
        savedSiteNames={['Well 4 BAR']}
        userNameById={{ 'u-mgr': 'Kevin Vilbar' }}
      />,
    );

    expect(screen.getByText('77 kg')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Movement Ledger \(3\)/i }));
    expect(screen.getByText('Showing 2 of 3 movements')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Load more movements' }));
    await waitFor(() => {
      expect(screen.getAllByText('Older generator run').length).toBeGreaterThan(0);
    });
  });
});
