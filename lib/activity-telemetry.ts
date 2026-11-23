import type { DailyActivityRow } from '@/lib/activity-types';
import { hydrateWellPulloutDetails } from './well-pullout-types.ts';
import {
  computeTankDowntime,
  evaluateTankWaterQuality,
  hydrateTankCleaningDetails,
} from './tank-cleaning-types.ts';
import { computeLeakVolumeLoss, hydrateLeakLossDetails } from './leak-volume-loss.ts';

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

  if (act.activity_type === 'leak_repair' || act.activity_type === 'leak_detection' || act.activity_type === 'valve_replacement') {
    if (str('pipeSize')) parts.push(`Pipe: ${str('pipeSize')}`);
    if (str('leakType')) parts.push(`Cause: ${str('leakType')}`);
    if (act.activity_type === 'leak_repair') {
      const leakState = hydrateLeakLossDetails(d);
      const lossCalc = computeLeakVolumeLoss(leakState);
      if (lossCalc) {
        parts.push(`Est. Water Loss: ${lossCalc.totalVolumeM3.toFixed(2)} m³ (${lossCalc.durationMinutes} min @ ${lossCalc.pressurePsi} PSI)`);
      }
      if (leakState.faultAttribution === 'third_party') {
        parts.push(
          `Fault: Customer / 3rd-Party${leakState.responsibleParty ? ` (${leakState.responsibleParty})` : ''}`,
        );
      }
    }
    if (Array.isArray(d.usedMaterials) && d.usedMaterials.length > 0) {
      const mats = d.usedMaterials as Array<{ item?: unknown; qty?: unknown; unit?: unknown }>;
      parts.push(
        `Materials: ${mats
          .map((m) => {
            const u = typeof m.unit === 'string' && m.unit.trim() ? ` ${m.unit.trim()}` : '';
            return `${String(m.item ?? '')} (${String(m.qty ?? '')}${u})`;
          })
          .join(', ')}`,
      );
    }
  }

  if ((act.activity_type === 'low_pressure' || act.activity_type === 'no_water_supply') && prim('pressurePsi') !== null) {
    parts.push(`Observed Pressure: ${prim('pressurePsi')} PSI`);
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

  if (act.activity_type === 'well_pull_out') {
    const wp = hydrateWellPulloutDetails(d);
    if (wp.reasonOfPullout.trim()) parts.push(`Reason: ${wp.reasonOfPullout.trim()}`);
    const pulled = [wp.pulledPumpBrand.trim(), wp.pulledPumpModel.trim()].filter(Boolean).join(' ');
    if (pulled) parts.push(`Pulled: ${pulled}`);
    const installedBase = [wp.installPumpBrand.trim(), wp.installPumpModel.trim()].filter(Boolean).join(' ');
    if (installedBase) {
      const statusSuffix = wp.installPumpStatus ? ` (${wp.installPumpStatus})` : '';
      parts.push(`Installed: ${installedBase}${statusSuffix}`);
    } else if (wp.installPumpStatus) {
      parts.push(`Installed: ${wp.installPumpStatus}`);
    }
    if (wp.pumpSettingM.trim()) parts.push(`Setting: ${wp.pumpSettingM.trim()}m`);
    if (wp.swlMeters.trim() || wp.pwlMeters.trim()) {
      parts.push(`SWL/PWL: ${wp.swlMeters.trim() || '—'}m/${wp.pwlMeters.trim() || '—'}m`);
    }
    if (wp.operationDuration.trim()) parts.push(`Duration: ${wp.operationDuration.trim()}`);
  }

  if (act.activity_type === 'tank_cleaning') {
    const tc = hydrateTankCleaningDetails(d);
    const tankDesc = [tc.tankId.trim() || act.site_or_well || '', tc.tankType].filter(Boolean).join(' · ');
    const cap = tc.tankCapacity.trim() ? ` (${tc.tankCapacity.trim()} ${tc.tankCapacityUnit})` : '';
    if (tankDesc || cap) parts.push(`Tank: ${tankDesc || 'Tank'}${cap}`);
    const dt =
      tc.totalDowntime.trim() ||
      computeTankDowntime(tc.dateStarted, tc.timeStarted, tc.dateFinished, tc.timeFinished, act.activity_date);
    if (dt) parts.push(`Downtime: ${dt}`);
    if (tc.chlorinePost.trim()) parts.push(`Post Cl₂: ${tc.chlorinePost.trim()} mg/L`);
    if (tc.turbidityPost.trim()) parts.push(`Turbidity: ${tc.turbidityPost.trim()} NTU`);
    if (tc.phPost.trim()) parts.push(`pH: ${tc.phPost.trim()}`);
    const evalRes = evaluateTankWaterQuality(tc);
    if (evalRes.overall !== 'INCOMPLETE') parts.push(evalRes.overall);
  }

  return parts;
}
