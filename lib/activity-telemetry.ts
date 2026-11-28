import type { DailyActivityRow } from '@/lib/activity-types';
import { hydrateWellPulloutDetails } from './well-pullout-types.ts';
import {
  computeTankDowntime,
  evaluateTankWaterQuality,
  hydrateTankCleaningDetails,
} from './tank-cleaning-types.ts';
import { describeChlorineRefill } from './chlorine-refill.ts';
import { computeLeakVolumeLoss, hydrateLeakLossDetails } from './leak-volume-loss.ts';
import { formatFlushingMeterStatusLabel, hydrateFlushingSummaryFromDetails } from './flushing-volume.ts';
import { computeTotalDistributedLiters, hydrateFuelActivitiesDetails, isFuelActivityType } from './fuel-activities.ts';
import {
  evaluateGensetHealth,
  formatGensetRunModeShort,
  hasGensetChecklistDetails,
  hydrateGensetMonitoringDetails,
} from './genset-monitoring.ts';

export function formatTelemetrySummary(act: DailyActivityRow): string[] {
  const d = act.details ?? {};
  const str = (k: string) => (typeof d[k] === 'string' || typeof d[k] === 'number' ? String(d[k]) : '');
  const prim = (k: string): string | number | null =>
    typeof d[k] === 'string' || typeof d[k] === 'number' ? d[k] : null;
  const parts: string[] = [];

  if (act.activity_type === 'genset_monitoring') {
    const initFuel = prim('gensetInitialFuel');
    const finalFuel = prim('gensetFinalFuel');
    const runH = prim('runningHours');

    if (!hasGensetChecklistDetails(d)) {
      if (initFuel !== null || finalFuel !== null) {
        parts.push(`Fuel: ${initFuel ?? '—'} → ${finalFuel ?? '—'}`);
      }
      if (runH !== null) parts.push(`Run: ${runH}h`);
      if (str('gensetCause')) parts.push(`Cause: ${str('gensetCause')}`);
    } else {
      const g = hydrateGensetMonitoringDetails(d);
      const health = evaluateGensetHealth(g);
      const durText = g.runMode !== 'skipped_ran_outage' && g.runDurationMin ? ` (${g.runDurationMin}m)` : '';
      parts.push(`${g.unitFuelType} · ${formatGensetRunModeShort(g.runMode)}${durText}`);
      if (initFuel !== null || finalFuel !== null) {
        parts.push(`Fuel: ${initFuel ?? '—'} → ${finalFuel ?? '—'}`);
      }
      if (runH !== null) parts.push(`Hr: ${runH}h`);
      parts.push(`Oil: ${g.oilLevel}`);
      if (g.batteryVoltageV) {
        parts.push(`Bat: ${g.batteryVoltageV}V (${g.batteryStatus})`);
      } else if (g.batteryStatus !== 'Good / Strong Crank') {
        parts.push(`Bat: ${g.batteryStatus}`);
      }
      if (health.findings.length > 0) {
        parts.push(`${health.verdict === 'CRITICAL' ? 'CRITICAL' : 'Attention'}: ${health.findings.join(', ')}`);
      } else {
        parts.push('Standby: Ready');
      }
    }
  } else if (act.activity_type === 'pump_monitoring') {
    if (prim('pressurePsi') !== null) parts.push(`${prim('pressurePsi')} PSI`);
    if (prim('flowLps') !== null) parts.push(`${prim('flowLps')} LPS`);
    if (prim('totalizerReading') !== null) parts.push(`Totalizer: ${prim('totalizerReading')} m³`);
    if (prim('chlorineResidual') !== null) parts.push(`Cl₂: ${prim('chlorineResidual')} mg/L`);
  } else if (act.activity_type === 'flushing') {
    const flushSummary = hydrateFlushingSummaryFromDetails(d);
    if (flushSummary.meterStatus !== 'metered') {
      parts.push(`Meter: ${formatFlushingMeterStatusLabel(flushSummary.meterStatus)}`);
      if (flushSummary.totalVolumeM3 !== null) {
        parts.push(
          `Est. Flushing Vol: ${flushSummary.totalVolumeM3.toFixed(2)} m³ (${flushSummary.computedPointCount} pt${flushSummary.computedPointCount === 1 ? '' : 's'})`,
        );
      }
    } else if (prim('flushingInitialRead') !== null || prim('flushingFinalRead') !== null) {
      parts.push(`Main Read: ${prim('flushingInitialRead') ?? '—'} → ${prim('flushingFinalRead') ?? '—'}`);
    } else if (flushSummary.basis === 'blowoff_meters' && flushSummary.totalVolumeM3 !== null) {
      parts.push(`Flushed Vol: ${flushSummary.totalVolumeM3.toFixed(2)} m³`);
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

  if (act.activity_type === 'chlorine_refill') {
    parts.push(...describeChlorineRefill(d).map((row) => `${row.label}: ${row.value}`));
  }

  if (act.activity_type === 'water_sampling') {
    if (prim('chlorineResidual') !== null) parts.push(`Cl₂: ${prim('chlorineResidual')} mg/L`);
    if (prim('turbidityNtu') !== null) parts.push(`Turb: ${prim('turbidityNtu')} NTU`);
    if (prim('phLevel') !== null) parts.push(`pH: ${prim('phLevel')}`);
  }

  if (act.activity_type === 'backwash') {
    if (str('filterUnit')) parts.push(`Unit: ${str('filterUnit')}`);
    if (prim('backwashDurationMin') !== null) parts.push(`${prim('backwashDurationMin')} mins`);
    const pIn = prim('backwashPressureInPsi');
    const pOut = prim('backwashPressureOutPsi');
    if (pIn !== null && pOut !== null) {
      parts.push(`Pressure (Start): ${pIn} in / ${pOut} out PSI`);
    } else if (pIn !== null) {
      parts.push(`Pressure In (Start): ${pIn} PSI`);
    } else if (pOut !== null) {
      parts.push(`Pressure Out (Start): ${pOut} PSI`);
    } else if (prim('pressurePsi') !== null) {
      parts.push(`${prim('pressurePsi')} PSI`);
    }
    if (str('waterClarity')) parts.push(`Clarity: ${str('waterClarity')}`);
    const turbStart = prim('productTurbidityStartNtu');
    const turbEnd = prim('productTurbidityEndNtu');
    if (turbStart !== null && turbEnd !== null) {
      parts.push(`Product Turb: ${turbStart} → ${turbEnd} NTU`);
    } else if (turbStart !== null) {
      parts.push(`Product Turb (Start): ${turbStart} NTU`);
    } else if (turbEnd !== null) {
      parts.push(`Product Turb (End): ${turbEnd} NTU`);
    }
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

  if (isFuelActivityType(act.activity_type)) {
    const f = hydrateFuelActivitiesDetails(d);
    if (act.activity_type === 'vehicle_fueling') {
      const veh = [str('vehicleType'), str('plateNumber') ? `(${str('plateNumber')})` : ''].filter(Boolean).join(' ');
      if (veh) parts.push(veh);
      if (f.litersAmount) parts.push(`+${f.litersAmount} L ${f.fuelType}`);
      if (f.odometerKm) parts.push(`Odometer: ${f.odometerKm} km`);
      if (f.supplierStation || f.receiptNumber) {
        parts.push([f.supplierStation, f.receiptNumber ? `OR #${f.receiptNumber}` : ''].filter(Boolean).join(' · '));
      }
      if (f.totalCostPhp) parts.push(`Php ${f.totalCostPhp}`);
    } else if (act.activity_type === 'genset_fuel_purchase') {
      if (f.litersAmount) parts.push(`+${f.litersAmount} L ${f.fuelType}`);
      if (f.containerDescription) parts.push(`Containers: ${f.containerDescription}`);
      if (f.supplierStation || f.receiptNumber) {
        parts.push([f.supplierStation, f.receiptNumber ? `OR #${f.receiptNumber}` : ''].filter(Boolean).join(' · '));
      }
      if (f.totalCostPhp) parts.push(`Php ${f.totalCostPhp}`);
    } else if (act.activity_type === 'genset_fuel_distribution') {
      const validDrops = f.fuelDistributions.filter((s) => s.destinationSite.trim() || s.liters.trim());
      const { totalLiters, validStopCount } = computeTotalDistributedLiters(validDrops);
      if (totalLiters > 0) {
        parts.push(`Total Distributed: ${totalLiters} L ${f.fuelType} (${validStopCount} site(s))`);
      }
      if (validDrops.length > 0) {
        parts.push(validDrops.map((s) => `${s.destinationSite || 'Site'}: ${s.liters || '—'}L`).join(', '));
      }
      const veh = [str('vehicleType'), str('plateNumber') ? `(${str('plateNumber')})` : ''].filter(Boolean).join(' ');
      if (veh) parts.push(`Transport: ${veh}`);
    } else if (act.activity_type === 'genset_fuel_refill') {
      if (f.litersAmount) parts.push(`Refilled: +${f.litersAmount} L ${f.fuelType}`);
      if (f.fuelBefore || f.fuelAfter) parts.push(`Level: ${f.fuelBefore || '—'} → ${f.fuelAfter || '—'}`);
      if (f.fuelSource) parts.push(`Source: ${f.fuelSource}`);
      if (f.hourMeterReading) parts.push(`Hour Meter: ${f.hourMeterReading}h`);
    }
  }

  return parts;
}
