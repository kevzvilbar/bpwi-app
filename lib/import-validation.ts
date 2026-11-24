export interface LegacyOperator {
  id: string;
  name: string;
  role?: string | null;
  phone?: string | null;
  defaultStation?: string | null;
}

export interface LegacyShift {
  id: string;
  label: string;
  name?: string | null;
  hours?: number | null;
  isOff?: boolean;
  bg?: string | null;
  text?: string | null;
}

export interface LegacyArea {
  code: string;
  name?: string | null;
  isLeave?: boolean;
  bg?: string | null;
  text?: string | null;
}

export interface LegacyScheduleCell {
  shift?: string;
  text?: string | null;
  onCall?: string | null;
}

export interface LegacyPmCustomType {
  id?: string;
  label?: string;
  short?: string;
  color?: string;
}

export interface LegacyPmTypeOverride {
  label?: string;
  short?: string;
  color?: string;
}

export interface LegacyPmTask {
  id: string;
  type: string;
  sites?: string[];
  site?: string | null;
  asset?: string | null;
  assignees?: string[];
  date: string;
  status?: string | null;
  doneOn?: string | null;
  notes?: string | null;
}

export interface LegacyImportPayload {
  operators?: LegacyOperator[];
  shifts?: Record<string, LegacyShift>;
  areaLeaves?: LegacyArea[];
  schedule?: Record<string, Record<string, LegacyScheduleCell>>;
  pmTypeOverrides?: Record<string, LegacyPmTypeOverride>;
  pmCustomTypes?: LegacyPmCustomType[];
  pmTasks?: LegacyPmTask[];
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const NAMED_COLOR_RE = /^[a-zA-Z]{3,20}$/;
const ALLOWED_PM_STATUSES = new Set(['planned', 'done', 'postponed']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isOptionalNullableString(v: unknown): boolean {
  return v === undefined || v === null || typeof v === 'string';
}

function isOptionalString(v: unknown): boolean {
  return v === undefined || typeof v === 'string';
}

function isOptionalStringArray(v: unknown): boolean {
  return v === undefined || (Array.isArray(v) && v.every((item) => typeof item === 'string'));
}

function isValidCalendarDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_KEY_RE.test(v)) return false;
  const [y, m, day] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day;
}

function isValidColorToken(raw: string): boolean {
  const trimmed = raw.trim();
  return HEX_COLOR_RE.test(trimmed) || NAMED_COLOR_RE.test(trimmed);
}

function isOptionalNullableHexColor(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true;
  return typeof v === 'string' && isValidColorToken(v);
}

function isOptionalHexColor(v: unknown): boolean {
  if (v === undefined || v === '') return true;
  return typeof v === 'string' && isValidColorToken(v);
}

export function validateImportPayload(
  raw: unknown,
): { ok: true; data: LegacyImportPayload } | { ok: false; error: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'Import payload must be a JSON object' };
  }

  if (raw.operators !== undefined) {
    if (!Array.isArray(raw.operators)) {
      return { ok: false, error: 'operators must be an array' };
    }
    const seenOpIds = new Set<string>();
    for (let i = 0; i < raw.operators.length; i += 1) {
      const op = raw.operators[i];
      if (!isPlainObject(op) || !isNonEmptyString(op.id) || !isNonEmptyString(op.name)) {
        return { ok: false, error: `operators[${i}] must have non-empty string id and name` };
      }
      const key = op.id.trim();
      if (seenOpIds.has(key)) {
        return { ok: false, error: `Duplicate operator id "${key}" in operators[${i}]` };
      }
      seenOpIds.add(key);
      if (
        !isOptionalNullableString(op.role) ||
        !isOptionalNullableString(op.phone) ||
        !isOptionalNullableString(op.defaultStation)
      ) {
        return { ok: false, error: `operators[${i}] has invalid optional field types` };
      }
    }
  }

  if (raw.shifts !== undefined) {
    if (!isPlainObject(raw.shifts)) {
      return { ok: false, error: 'shifts must be an object map' };
    }
    const seenShiftIds = new Set<string>();
    for (const [key, shift] of Object.entries(raw.shifts)) {
      const allowEmptyWhiteLabel = isPlainObject(shift) && shift.id === 'white' && typeof shift.label === 'string';
      if (
        !isPlainObject(shift) ||
        !isNonEmptyString(shift.id) ||
        (!isNonEmptyString(shift.label) && !allowEmptyWhiteLabel)
      ) {
        return { ok: false, error: `shifts["${key}"] must have non-empty string id and label` };
      }
      const sid = shift.id.trim();
      if (seenShiftIds.has(sid)) {
        return { ok: false, error: `Duplicate shift id "${sid}" in shifts["${key}"]` };
      }
      seenShiftIds.add(sid);
      if (
        !isOptionalNullableString(shift.name) ||
        !isOptionalNullableHexColor(shift.bg) ||
        !isOptionalNullableHexColor(shift.text) ||
        (shift.hours !== undefined && shift.hours !== null && (typeof shift.hours !== 'number' || !Number.isFinite(shift.hours))) ||
        (shift.isOff !== undefined && typeof shift.isOff !== 'boolean')
      ) {
        return { ok: false, error: `shifts["${key}"] has invalid field values` };
      }
    }
  }

  if (raw.areaLeaves !== undefined) {
    if (!Array.isArray(raw.areaLeaves)) {
      return { ok: false, error: 'areaLeaves must be an array' };
    }
    const seenAreaCodes = new Set<string>();
    for (let i = 0; i < raw.areaLeaves.length; i += 1) {
      const area = raw.areaLeaves[i];
      if (!isPlainObject(area) || !isNonEmptyString(area.code)) {
        return { ok: false, error: `areaLeaves[${i}] must have a non-empty string code` };
      }
      const codeKey = area.code.trim().toUpperCase();
      if (seenAreaCodes.has(codeKey)) {
        return { ok: false, error: `Duplicate area/leave code "${codeKey}" in areaLeaves[${i}]` };
      }
      seenAreaCodes.add(codeKey);
      if (
        !isOptionalNullableString(area.name) ||
        !isOptionalNullableHexColor(area.bg) ||
        !isOptionalNullableHexColor(area.text) ||
        (area.isLeave !== undefined && typeof area.isLeave !== 'boolean')
      ) {
        return { ok: false, error: `areaLeaves[${i}] has invalid field values` };
      }
    }
  }

  if (raw.schedule !== undefined) {
    if (!isPlainObject(raw.schedule)) {
      return { ok: false, error: 'schedule must be an object map' };
    }
    for (const [legacyOp, days] of Object.entries(raw.schedule)) {
      if (!isPlainObject(days)) {
        return { ok: false, error: `schedule["${legacyOp}"] must be an object of dates` };
      }
      for (const [dateKey, cell] of Object.entries(days)) {
        if (!isValidCalendarDate(dateKey)) {
          return { ok: false, error: `schedule["${legacyOp}"]["${dateKey}"] must use valid YYYY-MM-DD calendar dates` };
        }
        if (
          !isPlainObject(cell) ||
          !isOptionalString(cell.shift) ||
          !isOptionalNullableString(cell.text) ||
          !isOptionalNullableString(cell.onCall)
        ) {
          return { ok: false, error: `schedule["${legacyOp}"]["${dateKey}"] has invalid cell values` };
        }
      }
    }
  }

  if (raw.pmTypeOverrides !== undefined) {
    if (!isPlainObject(raw.pmTypeOverrides)) {
      return { ok: false, error: 'pmTypeOverrides must be an object map' };
    }
    for (const [code, ov] of Object.entries(raw.pmTypeOverrides)) {
      if (
        !isPlainObject(ov) ||
        !isOptionalString(ov.label) ||
        !isOptionalString(ov.short) ||
        !isOptionalHexColor(ov.color)
      ) {
        return { ok: false, error: `pmTypeOverrides["${code}"] has invalid field values` };
      }
    }
  }

  if (raw.pmCustomTypes !== undefined) {
    if (!Array.isArray(raw.pmCustomTypes)) {
      return { ok: false, error: 'pmCustomTypes must be an array' };
    }
    for (let i = 0; i < raw.pmCustomTypes.length; i += 1) {
      const ct = raw.pmCustomTypes[i];
      if (
        !isPlainObject(ct) ||
        !isOptionalString(ct.id) ||
        !isOptionalString(ct.label) ||
        !isOptionalString(ct.short) ||
        !isOptionalHexColor(ct.color)
      ) {
        return { ok: false, error: `pmCustomTypes[${i}] has invalid field values` };
      }
    }
  }

  if (raw.pmTasks !== undefined) {
    if (!Array.isArray(raw.pmTasks)) {
      return { ok: false, error: 'pmTasks must be an array' };
    }
    const seenTaskIds = new Set<string>();
    for (let i = 0; i < raw.pmTasks.length; i += 1) {
      const task = raw.pmTasks[i];
      if (!isPlainObject(task) || !isNonEmptyString(task.id) || !isNonEmptyString(task.type)) {
        return { ok: false, error: `pmTasks[${i}] must have non-empty string id and type` };
      }
      const tid = task.id.trim();
      if (seenTaskIds.has(tid)) {
        return { ok: false, error: `Duplicate pmTasks id "${tid}" in pmTasks[${i}]` };
      }
      seenTaskIds.add(tid);
      if (!isValidCalendarDate(task.date)) {
        return { ok: false, error: `pmTasks[${i}].date must use a valid YYYY-MM-DD calendar date` };
      }
      if (
        task.status !== undefined &&
        task.status !== null &&
        task.status !== '' &&
        (typeof task.status !== 'string' || !ALLOWED_PM_STATUSES.has(task.status))
      ) {
        return { ok: false, error: `pmTasks[${i}].status must be planned, done, or postponed` };
      }
      if (
        !isOptionalStringArray(task.sites) ||
        !isOptionalStringArray(task.assignees) ||
        !isOptionalNullableString(task.site) ||
        !isOptionalNullableString(task.asset) ||
        !isOptionalNullableString(task.doneOn) ||
        !isOptionalNullableString(task.notes)
      ) {
        return { ok: false, error: `pmTasks[${i}] has invalid field types` };
      }
    }
  }

  return { ok: true, data: raw as LegacyImportPayload };
}
