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
  status?: string;
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
    for (let i = 0; i < raw.operators.length; i += 1) {
      const op = raw.operators[i];
      if (!isPlainObject(op) || !isNonEmptyString(op.id) || !isNonEmptyString(op.name)) {
        return { ok: false, error: `operators[${i}] must have non-empty string id and name` };
      }
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
    for (const [key, shift] of Object.entries(raw.shifts)) {
      if (!isPlainObject(shift) || !isNonEmptyString(shift.id) || !isNonEmptyString(shift.label)) {
        return { ok: false, error: `shifts["${key}"] must have non-empty string id and label` };
      }
      if (
        !isOptionalNullableString(shift.name) ||
        !isOptionalNullableString(shift.bg) ||
        !isOptionalNullableString(shift.text) ||
        (shift.hours !== undefined && shift.hours !== null && (typeof shift.hours !== 'number' || !Number.isFinite(shift.hours))) ||
        (shift.isOff !== undefined && typeof shift.isOff !== 'boolean')
      ) {
        return { ok: false, error: `shifts["${key}"] has invalid field types` };
      }
    }
  }

  if (raw.areaLeaves !== undefined) {
    if (!Array.isArray(raw.areaLeaves)) {
      return { ok: false, error: 'areaLeaves must be an array' };
    }
    for (let i = 0; i < raw.areaLeaves.length; i += 1) {
      const area = raw.areaLeaves[i];
      if (!isPlainObject(area) || !isNonEmptyString(area.code)) {
        return { ok: false, error: `areaLeaves[${i}] must have a non-empty string code` };
      }
      if (
        !isOptionalNullableString(area.name) ||
        !isOptionalNullableString(area.bg) ||
        !isOptionalNullableString(area.text) ||
        (area.isLeave !== undefined && typeof area.isLeave !== 'boolean')
      ) {
        return { ok: false, error: `areaLeaves[${i}] has invalid field types` };
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
        if (!DATE_KEY_RE.test(dateKey)) {
          return { ok: false, error: `schedule["${legacyOp}"]["${dateKey}"] must use YYYY-MM-DD date keys` };
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
        !isOptionalString(ov.color)
      ) {
        return { ok: false, error: `pmTypeOverrides["${code}"] has invalid field types` };
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
        !isOptionalString(ct.color)
      ) {
        return { ok: false, error: `pmCustomTypes[${i}] has invalid field types` };
      }
    }
  }

  if (raw.pmTasks !== undefined) {
    if (!Array.isArray(raw.pmTasks)) {
      return { ok: false, error: 'pmTasks must be an array' };
    }
    for (let i = 0; i < raw.pmTasks.length; i += 1) {
      const task = raw.pmTasks[i];
      if (!isPlainObject(task) || !isNonEmptyString(task.id) || !isNonEmptyString(task.type)) {
        return { ok: false, error: `pmTasks[${i}] must have non-empty string id and type` };
      }
      if (typeof task.date !== 'string' || !DATE_KEY_RE.test(task.date)) {
        return { ok: false, error: `pmTasks[${i}].date must use YYYY-MM-DD format` };
      }
      if (
        !isOptionalStringArray(task.sites) ||
        !isOptionalStringArray(task.assignees) ||
        !isOptionalNullableString(task.site) ||
        !isOptionalNullableString(task.asset) ||
        !isOptionalNullableString(task.status) ||
        !isOptionalNullableString(task.doneOn) ||
        !isOptionalNullableString(task.notes)
      ) {
        return { ok: false, error: `pmTasks[${i}] has invalid field types` };
      }
    }
  }

  return { ok: true, data: raw as LegacyImportPayload };
}
