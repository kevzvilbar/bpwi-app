import type { DailyActivityRow } from '@/lib/activity-types';

export function formatTelemetrySummary(act: DailyActivityRow): string[] {
  const d = act.details ?? {};
  const str = (k: string) => (typeof d[k] === 'string' || typeof d[k] === 'number' ? String(d[k]) : '');
  const prim = (k: string): string | number | null =>
    typeof d[k] === 'string' || typeof d[k] === 'number' ? d[k] : null;
  const parts: string[] = [];

  if (act.activity_type === 'genset_monitoring') {
    const initFuel = prim('gensetInitialFuel');
    const finalFuel = prim('gensetFinalFuel');
    if (initFuel !== null || finalFuel !== null) {
      parts.push(`Fuel: ${initFuel ?? '—'} → ${finalFuel ?? '—'}`);
    }
    const runH = prim('runningHours');
    if (runH !== null) parts.push(`Run: ${runH}h`);
    if (str('gensetCause')) parts.push(`Cause: ${str('gensetCause')}`);
  } else if (act.activity_type === 'pump_monitoring') {
    if (prim('pressurePsi') !== null) parts.push(`${prim('pressurePsi')} PSI`);
    if (prim('flowLps') !== null) parts.push(`${prim('flowLps')} LPS`);
    if (prim('totalizerReading') !== null) parts.push(`Totalizer: ${prim('totalizerReading')} m³`);
    if (prim('chlorineResidual') !== null) parts.push(`Cl₂: ${prim('chlorineResidual')} mg/L`);
  } else if (act.activity_type === 'flushing') {
    if (prim('flushingInitialRead') !== null || prim('flushingFinalRead') !== null) {
      parts.push(`Main Read: ${prim('flushingInitialRead') ?? '—'} → ${prim('flushingFinalRead') ?? '—'}`);
    }
    if (Array.isArray(d.blowOffs) && d.blowOffs.length > 0) {
      parts.push(`${d.blowOffs.length} blow-off point(s)`);
    }
  } else if (act.activity_type === 'meter_test') {
    if (str('accountNumber')) parts.push(`Acct: ${str('accountNumber')}`);
    if (str('accountName')) parts.push(str('accountName'));
    if (prim('avgErr') !== null) {
      parts.push(`Avg Err: ${prim('avgErr')}% (${str('verdict')} · ${str('recommendation')})`);
    }
  } else if (str('accountNumber') || str('accountName')) {
    parts.push(`Acct: ${[str('accountNumber'), str('accountName')].filter(Boolean).join(' · ')}`);
  }

  if (act.activity_type === 'leak_repair' || act.activity_type === 'leak_detection') {
    if (str('pipeSize')) parts.push(`Pipe: ${str('pipeSize')}`);
    if (str('leakType')) parts.push(`Cause: ${str('leakType')}`);
    if (Array.isArray(d.usedMaterials) && d.usedMaterials.length > 0) {
      const mats = d.usedMaterials as Array<{ item?: unknown; qty?: unknown }>;
      parts.push(`Materials: ${mats.map((m) => `${String(m.item ?? '')} (${String(m.qty ?? '')})`).join(', ')}`);
    }
  }

  if (act.activity_type === 'tankering' && Array.isArray(d.haulingCycles)) {
    const cycles = d.haulingCycles as Array<{ volumeM3?: unknown }>;
    const totalVol = cycles.reduce((acc: number, c) => acc + (Number(c.volumeM3) || 0), 0);
    parts.push(`${cycles.length} trip(s) · ${totalVol} m³`);
    if (str('plateNumber')) parts.push(`Plate: ${str('plateNumber')}`);
  }

  if (act.activity_type === 'water_sampling') {
    if (prim('chlorineResidual') !== null) parts.push(`Cl₂: ${prim('chlorineResidual')} mg/L`);
    if (prim('turbidityNtu') !== null) parts.push(`Turb: ${prim('turbidityNtu')} NTU`);
    if (prim('phLevel') !== null) parts.push(`pH: ${prim('phLevel')}`);
  }

  if (act.activity_type === 'backwash') {
    if (str('filterUnit')) parts.push(`Unit: ${str('filterUnit')}`);
    if (prim('backwashDurationMin') !== null) parts.push(`${prim('backwashDurationMin')} mins`);
    if (prim('pressurePsi') !== null) parts.push(`${prim('pressurePsi')} PSI`);
    if (str('waterClarity')) parts.push(`Clarity: ${str('waterClarity')}`);
  }

  if (act.activity_type === 'thermal_scanning') {
    if (str('scannedEquipment')) parts.push(`Equip: ${str('scannedEquipment')}`);
    if (prim('maxTempC') !== null) parts.push(`Max: ${prim('maxTempC')}°C`);
    if (str('hotspotFound')) parts.push(`Hotspot: ${str('hotspotFound')}`);
  }

  if (act.activity_type === 'water_level_monitoring') {
    if (prim('swlMeters') !== null) parts.push(`SWL: ${prim('swlMeters')}m`);
    if (prim('pwlMeters') !== null) parts.push(`PWL: ${prim('pwlMeters')}m`);
    if (prim('drawdownMeters') !== null) parts.push(`Drawdown: ${prim('drawdownMeters')}m`);
  }

  return parts;
}
