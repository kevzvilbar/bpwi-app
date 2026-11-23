/**
 * Pure location catalog, suggestion filtering, strict saved-location validation,
 * and split-per-location series expansion helpers for PM Planner.
 *
 * Uses zero `@/` imports so Node's native test runner executes it directly.
 */

export interface PmLocationRow {
  id: string;
  name: string;
  sort_order: number;
}

export interface PmAreaWithSubSites {
  id: string;
  code: string;
  name: string | null;
  category: string;
  sub_sites?: string[] | null;
}

export interface PmLocationOption {
  name: string;
  source: 'pm_locations' | 'station_sub_site' | 'both';
  stationCode?: string;
}

export function normalizeLocationKey(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function buildSavedLocationCatalog(
  pmLocations: PmLocationRow[],
  areas: PmAreaWithSubSites[],
): PmLocationOption[] {
  const byKey = new Map<string, PmLocationOption>();

  for (const row of pmLocations) {
    const cleaned = row.name.trim().replace(/\s+/g, ' ');
    if (!cleaned) continue;
    const key = normalizeLocationKey(cleaned);
    if (!byKey.has(key)) {
      byKey.set(key, { name: cleaned, source: 'pm_locations' });
    }
  }

  for (const area of areas) {
    if (area.category !== 'station') continue;
    for (const sub of area.sub_sites ?? []) {
      const cleaned = sub.trim().replace(/\s+/g, ' ');
      if (!cleaned) continue;
      const key = normalizeLocationKey(cleaned);
      const existing = byKey.get(key);
      if (existing) {
        if (existing.source === 'pm_locations') {
          existing.source = 'both';
        }
        if (!existing.stationCode) {
          existing.stationCode = area.code;
        }
      } else {
        byKey.set(key, {
          name: cleaned,
          source: 'station_sub_site',
          stationCode: area.code,
        });
      }
    }
  }

  return Array.from(byKey.values());
}

export function filterLocationSuggestions(
  catalog: PmLocationOption[],
  query: string,
  selectedLocations: string[],
  limit = 12,
): PmLocationOption[] {
  const selectedKeys = new Set(selectedLocations.map(normalizeLocationKey));
  const available = catalog.filter((opt) => !selectedKeys.has(normalizeLocationKey(opt.name)));
  const q = normalizeLocationKey(query);
  if (!q) return available.slice(0, limit);

  const scored: Array<{ opt: PmLocationOption; tier: number }> = [];
  for (const opt of available) {
    const lowerName = opt.name.toLowerCase();
    const lowerCode = (opt.stationCode ?? '').toLowerCase();
    if (lowerName.startsWith(q)) {
      scored.push({ opt, tier: 0 });
    } else if (lowerName.includes(q)) {
      scored.push({ opt, tier: 1 });
    } else if (lowerCode && lowerCode.startsWith(q)) {
      scored.push({ opt, tier: 2 });
    }
  }

  scored.sort((a, b) => a.tier - b.tier || a.opt.name.localeCompare(b.opt.name));
  return scored.slice(0, limit).map((entry) => entry.opt);
}

export function resolveSavedLocation(
  catalog: PmLocationOption[],
  rawInput: string,
): PmLocationOption | null {
  const key = normalizeLocationKey(rawInput);
  if (!key) return null;
  return catalog.find((opt) => normalizeLocationKey(opt.name) === key) ?? null;
}

export function validateSelectedLocations(
  selectedLocations: string[],
  catalog: PmLocationOption[],
  pendingInput: string,
  legacyExisting: string[] = [],
): { ok: true; locations: string[] } | { ok: false; error: string } {
  const legacyKeys = new Set(legacyExisting.map(normalizeLocationKey));
  const result: string[] = [];
  const seen = new Set<string>();

  for (const raw of selectedLocations) {
    const cleaned = raw.trim().replace(/\s+/g, ' ');
    if (!cleaned) continue;
    const key = normalizeLocationKey(cleaned);
    const saved = resolveSavedLocation(catalog, cleaned);
    if (saved) {
      const savedKey = normalizeLocationKey(saved.name);
      if (!seen.has(savedKey)) {
        seen.add(savedKey);
        result.push(saved.name);
      }
      continue;
    }
    if (legacyKeys.has(key)) {
      if (!seen.has(key)) {
        seen.add(key);
        result.push(cleaned);
      }
      continue;
    }
    return {
      ok: false,
      error: `"${cleaned}" is not a saved area/site. Pick a saved suggestion or add it in Manage list / Settings first.`,
    };
  }

  const pendingCleaned = pendingInput.trim().replace(/\s+/g, ' ');
  if (pendingCleaned) {
    const pendingSaved = resolveSavedLocation(catalog, pendingCleaned);
    if (!pendingSaved) {
      return {
        ok: false,
        error: `"${pendingCleaned}" is not a saved area/site. Pick a saved suggestion or add it in Manage list / Settings first.`,
      };
    }
    const pendingKey = normalizeLocationKey(pendingSaved.name);
    if (!seen.has(pendingKey)) {
      seen.add(pendingKey);
      result.push(pendingSaved.name);
    }
  }

  return { ok: true, locations: result };
}

export function expandPmTaskGroups(locations: string[], splitPerLocation: boolean): string[][] {
  if (splitPerLocation && locations.length > 1) {
    return locations.map((loc) => [loc]);
  }
  return [locations];
}

/**
 * Generates a series prefix WITHOUT hyphens because `PmPlanner.executeRemove`
 * extracts `legacy_key.split('-')[0]` to target a single independent series.
 */
export function buildPmSeriesPrefix(
  timestampBase36: string,
  locIdx: number,
  totalLocGroups: number,
): string {
  return totalLocGroups > 1 ? `S${timestampBase36}L${locIdx}` : `S${timestampBase36}`;
}

export function isMissingPmLocationsTableError(
  err: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  const msg = err.message ?? '';
  return /pm_locations.*does not exist|could not find the table.*pm_locations/i.test(msg);
}
