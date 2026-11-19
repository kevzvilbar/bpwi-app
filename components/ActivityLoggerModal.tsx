'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_LABELS,
  ACTIVITY_TYPES,
  computeMeterTestResult,
  parse12DigitAccount,
  resolveActivityTypeFromPm,
  type ActivityCategory,
  type DailyActivityRow,
} from '@/lib/activity-types';
import { getErrorMessage } from '@/lib/error-utils';
import { resolveActivityPhotoUrl } from '@/lib/activity-media';
import { compressImageFile, uploadActivityPhoto } from '@/lib/image-compress';

export type LoggerOperator = {
  id: string;
  full_name: string;
  position: string | null;
  default_station?: string | null;
};

export type LoggerArea = {
  id: string;
  code: string;
  name: string | null;
  category: string;
  sub_sites?: string[];
};

export type LoggerShift = {
  id: string;
  code: string;
  description?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  is_off?: boolean;
};

export type LoggerAssignment = {
  operator_id: string;
  shift_type_id: string | null;
  area_code_id: string | null;
};

export type LinkedPmTask = {
  id: string;
  title: string;
  activity_type: string;
  locations?: string[];
  asset?: string | null;
  assigned_operator_ids?: string[];
};

export type LinkedJobOrder = {
  id: string;
  jo_number: string;
  title: string;
  activity_type?: string | null;
  area_code_id?: string | null;
  site_or_well?: string | null;
  block_lot?: string | null;
  account_number?: string | null;
  account_name?: string | null;
  assigned_operator_ids?: string[];
};

function currentManilaHHMM() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const h = parts.find((p) => p.type === 'hour')?.value ?? '08';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h === '24' ? '00' : h}:${m}`;
}

function toManilaTimestampIso(ymd: string, hhmm: string): string | null {
  if (!ymd || !hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  try {
    return new Date(`${ymd}T${hhmm}:00+08:00`).toISOString();
  } catch {
    return null;
  }
}

export default function ActivityLoggerModal(p: {
  open: boolean;
  onClose: () => void;
  onSaved: (activity: DailyActivityRow, opts?: { offline?: boolean }) => void;
  orgId: string;
  userId: string;
  operatorId: string | null;
  date: string;
  operators: LoggerOperator[];
  areas: LoggerArea[];
  shifts: LoggerShift[];
  assignments: LoggerAssignment[];
  initialActivityType?: string;
  initialLeadOperatorId?: string | null;
  linkedPmTask?: LinkedPmTask | null;
  pmActivityTypes?: Array<{ code: string; label: string; short_label?: string }>;
  linkedJobOrder?: LinkedJobOrder | null;
  editingActivity?: DailyActivityRow | null;
  onQueuedOffline?: (payload: Record<string, unknown>) => Promise<void> | void;
}) {
  const stationAreas = useMemo(() => {
    const onlyStations = p.areas.filter((a) => a.category === 'station');
    return onlyStations.length > 0
      ? onlyStations
      : p.areas.filter((a) => a.category !== 'leave' && a.category !== 'rest' && a.category !== 'holiday');
  }, [p.areas]);

  const shiftBy = useMemo(() => new Map(p.shifts.map((s) => [s.id, s])), [p.shifts]);
  const asgByOp = useMemo(() => new Map(p.assignments.map((a) => [a.operator_id, a])), [p.assignments]);
  const stationIdSet = useMemo(() => new Set(stationAreas.map((a) => a.id)), [stationAreas]);

  const [activityType, setActivityType] = useState<string>('pump_monitoring');
  const [leadOpId, setLeadOpId] = useState<string>('');
  const [crewOpIds, setCrewOpIds] = useState<string[]>([]);
  const [showAllOps, setShowAllOps] = useState(false);
  const [shiftTypeId, setShiftTypeId] = useState<string>('');
  const [areaCodeId, setAreaCodeId] = useState<string>('');
  const [areaTouched, setAreaTouched] = useState(false);
  const [siteOrWell, setSiteOrWell] = useState<string>('');
  const [blockLot, setBlockLot] = useState<string>('');
  const [startedHHMM, setStartedHHMM] = useState<string>('');
  const [completedHHMM, setCompletedHHMM] = useState<string>(currentManilaHHMM());
  const [notes, setNotes] = useState<string>('');

  // GPS state
  const [gpsLat, setGpsLat] = useState<number | null>(null);
  const [gpsLng, setGpsLng] = useState<number | null>(null);
  const [gpsStatus, setGpsStatus] = useState<string>('');

  // Photos state
  const [photos, setPhotos] = useState<Array<{ url: string; storagePath: string | null; preview: string }>>([]);
  const [savedBytesTotal, setSavedBytesTotal] = useState(0);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Dynamic Details State
  // 1. Genset
  const [gensetInitialFuel, setGensetInitialFuel] = useState('');
  const [gensetFinalFuel, setGensetFinalFuel] = useState('');
  const [runningHours, setRunningHours] = useState('');
  const [gensetCause, setGensetCause] = useState<'Routine' | 'Power Outage' | 'PMS'>('Routine');

  // 2. Pump Monitoring
  const [pressurePsi, setPressurePsi] = useState('');
  const [flowLps, setFlowLps] = useState('');
  const [totalizerReading, setTotalizerReading] = useState('');
  const [chlorineResidual, setChlorineResidual] = useState('');

  // 3. Flushing
  const [flushingInitialRead, setFlushingInitialRead] = useState('');
  const [flushingFinalRead, setFlushingFinalRead] = useState('');
  const [blowOffs, setBlowOffs] = useState<Array<{ name: string; initialRead: string; finalRead: string }>>([
    { name: 'Blow-off 1', initialRead: '', finalRead: '' },
  ]);

  // 4. Customer & Metering (common + meter test)
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [meterBrand, setMeterBrand] = useState('');
  const [meterSerialNumber, setMeterSerialNumber] = useState('');
  const [meterSize, setMeterSize] = useState('1/2"');
  const [meterNature, setMeterNature] = useState<'Old' | 'New'>('Old');
  const [testNature, setTestNature] = useState<'Re-testing' | 'Initial'>('Re-testing');
  const [refVolumeM3, setRefVolumeM3] = useState('0.01');
  const [initialReading, setInitialReading] = useState('');
  const [reading1, setReading1] = useState('');
  const [reading2, setReading2] = useState('');
  const [reading3, setReading3] = useState('');
  const [witnessedBy, setWitnessedBy] = useState('');

  // Replacement / check fields
  const [oldMeterBrand, setOldMeterBrand] = useState('');
  const [oldMeterSerial, setOldMeterSerial] = useState('');
  const [oldMeterReading, setOldMeterReading] = useState('');
  const [newMeterBrand, setNewMeterBrand] = useState('');
  const [newMeterSerial, setNewMeterSerial] = useState('');
  const [newMeterReading, setNewMeterReading] = useState('');
  const [isMeterRunning, setIsMeterRunning] = useState<'Yes' | 'No'>('Yes');
  const [needsDeclogging, setNeedsDeclogging] = useState<'No' | 'Yes'>('No');

  // 5. Leak Repair / Detection
  const [pipeSize, setPipeSize] = useState('');
  const [leakType, setLeakType] = useState('');
  const [usedMaterials, setUsedMaterials] = useState<Array<{ item: string; qty: string }>>([]);

  // 6. Water Hauling
  const [vehicleType, setVehicleType] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [haulingCycles, setHaulingCycles] = useState<
    Array<{ sourceLocation: string; deliveryLocation: string; volumeM3: string; loadingTime: string; injectionTime: string }>
  >([{ sourceLocation: '', deliveryLocation: '', volumeM3: '', loadingTime: '', injectionTime: '' }]);

  // 7. Water Sampling
  const [turbidityNtu, setTurbidityNtu] = useState('');
  const [phLevel, setPhLevel] = useState('');
  const [samplePoint, setSamplePoint] = useState('');

  // 8. Backwash / Thermal Scanning / Water Level Monitoring
  const [filterUnit, setFilterUnit] = useState('');
  const [backwashDurationMin, setBackwashDurationMin] = useState('');
  const [waterClarity, setWaterClarity] = useState<'Clear' | 'Slightly Turbid' | 'Turbid'>('Clear');
  const [scannedEquipment, setScannedEquipment] = useState('');
  const [maxTempC, setMaxTempC] = useState('');
  const [hotspotFound, setHotspotFound] = useState<'No' | 'Yes'>('No');
  const [swlMeters, setSwlMeters] = useState('');
  const [pwlMeters, setPwlMeters] = useState('');

  // Signature pad ref for meter_test
  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sigDrawingRef = useRef(false);
  const [hasSignature, setHasSignature] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const lastParsedRef = useRef('');

  // Initialize defaults whenever modal opens
  useEffect(() => {
    if (!p.open) return;
    setErrMsg('');
    setGpsLat(null);
    setGpsLng(null);
    setGpsStatus('');
    setPhotos([]);
    setSavedBytesTotal(0);
    setHasSignature(false);
    setAreaTouched(false);
    setStartedHHMM('');
    setCompletedHHMM(currentManilaHHMM());
    setNotes('');
    lastParsedRef.current = '';

    // Reset all activity-specific telemetry fields so previous submissions never bleed over
    setGensetInitialFuel('');
    setGensetFinalFuel('');
    setRunningHours('');
    setGensetCause('Routine');
    setPressurePsi('');
    setFlowLps('');
    setTotalizerReading('');
    setChlorineResidual('');
    setFlushingInitialRead('');
    setFlushingFinalRead('');
    setBlowOffs([{ name: 'Blow-off 1', initialRead: '', finalRead: '' }]);
    setMeterBrand('');
    setMeterSerialNumber('');
    setMeterSize('1/2"');
    setMeterNature('Old');
    setTestNature('Re-testing');
    setRefVolumeM3('0.01');
    setInitialReading('');
    setReading1('');
    setReading2('');
    setReading3('');
    setWitnessedBy('');
    setOldMeterBrand('');
    setOldMeterSerial('');
    setOldMeterReading('');
    setNewMeterBrand('');
    setNewMeterSerial('');
    setNewMeterReading('');
    setIsMeterRunning('Yes');
    setNeedsDeclogging('No');
    setPipeSize('');
    setLeakType('');
    setUsedMaterials([]);
    setVehicleType('');
    setPlateNumber('');
    setDriverName('');
    setHaulingCycles([{ sourceLocation: '', deliveryLocation: '', volumeM3: '', loadingTime: '', injectionTime: '' }]);
    setTurbidityNtu('');
    setPhLevel('');
    setSamplePoint('');
    setFilterUnit('');
    setBackwashDurationMin('');
    setWaterClarity('Clear');
    setScannedEquipment('');
    setMaxTempC('');
    setHotspotFound('No');
    setSwlMeters('');
    setPwlMeters('');

    if (p.editingActivity) {
      const ea = p.editingActivity;
      const d = (ea.details ?? {}) as Record<string, unknown>;
      setActivityType(ea.activity_type);
      setLeadOpId(ea.lead_operator_id ?? '');
      setCrewOpIds(ea.crew_operator_ids ?? []);
      setShiftTypeId(ea.shift_type_id ?? '');
      setAreaCodeId(ea.area_code_id ?? '');
      setAreaTouched(true);
      setSiteOrWell(ea.site_or_well ?? '');
      setBlockLot(ea.block_lot ?? '');
      setNotes(ea.notes ?? '');
      setGpsLat(ea.gps_lat);
      setGpsLng(ea.gps_lng);
      setPhotos(
        (ea.photo_urls ?? []).map((u, idx) => {
          const sp = ea.photo_storage_paths?.[idx] ?? null;
          const resolved = resolveActivityPhotoUrl(u, sp);
          return {
            url: resolved,
            storagePath: sp,
            preview: resolved,
          };
        }),
      );
      const toHHMM = (iso: string | null) => {
        if (!iso) return '';
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
        const hh = parts.find((x) => x.type === 'hour')?.value ?? '';
        const mm = parts.find((x) => x.type === 'minute')?.value ?? '';
        return hh && mm ? `${hh === '24' ? '00' : hh}:${mm}` : '';
      };
      setStartedHHMM(toHHMM(ea.started_at));
      setCompletedHHMM(toHHMM(ea.completed_at) || currentManilaHHMM());

      if (d.gensetInitialFuel != null) setGensetInitialFuel(String(d.gensetInitialFuel));
      if (d.gensetFinalFuel != null) setGensetFinalFuel(String(d.gensetFinalFuel));
      if (d.runningHours != null) setRunningHours(String(d.runningHours));
      if (d.gensetCause === 'Routine' || d.gensetCause === 'Power Outage' || d.gensetCause === 'PMS') {
        setGensetCause(d.gensetCause);
      }
      if (d.pressurePsi != null) setPressurePsi(String(d.pressurePsi));
      if (d.flowLps != null) setFlowLps(String(d.flowLps));
      if (d.totalizerReading != null) setTotalizerReading(String(d.totalizerReading));
      if (d.chlorineResidual != null) setChlorineResidual(String(d.chlorineResidual));
      if (d.flushingInitialRead != null) setFlushingInitialRead(String(d.flushingInitialRead));
      if (d.flushingFinalRead != null) setFlushingFinalRead(String(d.flushingFinalRead));
      if (Array.isArray(d.blowOffs) && d.blowOffs.length > 0) {
        setBlowOffs(
          d.blowOffs
            .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
            .map((b) => ({
              name: typeof b.name === 'string' ? b.name : '',
              initialRead: b.initialRead != null ? String(b.initialRead) : '',
              finalRead: b.finalRead != null ? String(b.finalRead) : '',
            })),
        );
      }
      if (d.accountNumber) setAccountNumber(String(d.accountNumber));
      if (d.accountName) setAccountName(String(d.accountName));
      if (d.meterBrand) setMeterBrand(String(d.meterBrand));
      if (d.meterSerialNumber) setMeterSerialNumber(String(d.meterSerialNumber));
      if (d.meterSize) setMeterSize(String(d.meterSize));
      if (d.meterNature === 'Old' || d.meterNature === 'New') setMeterNature(d.meterNature);
      if (d.testNature === 'Re-testing' || d.testNature === 'Initial') setTestNature(d.testNature);
      if (d.refVolumeM3 != null) setRefVolumeM3(String(d.refVolumeM3));
      if (d.initialReading != null) setInitialReading(String(d.initialReading));
      if (d.reading1 != null) setReading1(String(d.reading1));
      if (d.reading2 != null) setReading2(String(d.reading2));
      if (d.reading3 != null) setReading3(String(d.reading3));
      if (d.witnessedBy) setWitnessedBy(String(d.witnessedBy));
      if (d.oldMeterSerial) setOldMeterSerial(String(d.oldMeterSerial));
      if (d.oldMeterReading != null) setOldMeterReading(String(d.oldMeterReading));
      if (d.newMeterSerial) setNewMeterSerial(String(d.newMeterSerial));
      if (d.newMeterReading != null) setNewMeterReading(String(d.newMeterReading));
      if (d.isMeterRunning === 'Yes' || d.isMeterRunning === 'No') setIsMeterRunning(d.isMeterRunning);
      if (d.needsDeclogging === 'No' || d.needsDeclogging === 'Yes') setNeedsDeclogging(d.needsDeclogging);
      if (d.pipeSize) setPipeSize(String(d.pipeSize));
      if (d.leakType) setLeakType(String(d.leakType));
      if (Array.isArray(d.usedMaterials)) {
        setUsedMaterials(
          d.usedMaterials
            .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
            .map((m) => ({ item: String(m.item ?? ''), qty: String(m.qty ?? '1') })),
        );
      }
      if (d.vehicleType) setVehicleType(String(d.vehicleType));
      if (d.plateNumber) setPlateNumber(String(d.plateNumber));
      if (d.driverName) setDriverName(String(d.driverName));
      if (Array.isArray(d.haulingCycles) && d.haulingCycles.length > 0) {
        setHaulingCycles(
          d.haulingCycles
            .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
            .map((c) => ({
              sourceLocation: typeof c.sourceLocation === 'string' ? c.sourceLocation : '',
              deliveryLocation: typeof c.deliveryLocation === 'string' ? c.deliveryLocation : '',
              volumeM3: c.volumeM3 != null ? String(c.volumeM3) : '',
              loadingTime: typeof c.loadingTime === 'string' ? c.loadingTime : '',
              injectionTime: typeof c.injectionTime === 'string' ? c.injectionTime : '',
            })),
        );
      }
      if (d.turbidityNtu != null) setTurbidityNtu(String(d.turbidityNtu));
      if (d.phLevel != null) setPhLevel(String(d.phLevel));
      if (d.samplePoint) setSamplePoint(String(d.samplePoint));
      if (d.filterUnit) setFilterUnit(String(d.filterUnit));
      if (d.backwashDurationMin != null) setBackwashDurationMin(String(d.backwashDurationMin));
      if (d.waterClarity === 'Clear' || d.waterClarity === 'Slightly Turbid' || d.waterClarity === 'Turbid') {
        setWaterClarity(d.waterClarity);
      }
      if (d.scannedEquipment) setScannedEquipment(String(d.scannedEquipment));
      if (d.maxTempC != null) setMaxTempC(String(d.maxTempC));
      if (d.hotspotFound === 'No' || d.hotspotFound === 'Yes') setHotspotFound(d.hotspotFound);
      if (d.swlMeters != null) setSwlMeters(String(d.swlMeters));
      if (d.pwlMeters != null) setPwlMeters(String(d.pwlMeters));
      return;
    }

    // Determine initial activity type (reconciles preset codes, custom PM types, and title keywords)
    const pmMapped = p.linkedPmTask
      ? resolveActivityTypeFromPm(p.linkedPmTask, p.pmActivityTypes)
      : undefined;
    const initAct =
      p.linkedJobOrder?.activity_type ||
      pmMapped ||
      p.initialActivityType ||
      'pump_monitoring';
    setActivityType(ACTIVITY_TYPES.some((a) => a.id === initAct) ? initAct : 'pump_monitoring');

    // Lead operator
    const defaultLead =
      p.initialLeadOperatorId ??
      p.linkedJobOrder?.assigned_operator_ids?.[0] ??
      p.linkedPmTask?.assigned_operator_ids?.[0] ??
      p.operatorId ??
      '';
    setLeadOpId(defaultLead);

    // Pre-populate crew from linked PM or JO (excluding lead)
    const linkedCrew =
      p.linkedJobOrder?.assigned_operator_ids ??
      p.linkedPmTask?.assigned_operator_ids ??
      [];
    setCrewOpIds(linkedCrew.filter((id) => id && id !== defaultLead));

    // Area & Shift from linked JO, PM location match, or Roster assignment
    const asg = defaultLead ? asgByOp.get(defaultLead) : undefined;
    setShiftTypeId(asg?.shift_type_id ?? '');
    const pmLocText = (p.linkedPmTask?.locations ?? []).join(' ').toLowerCase();
    const pmMatchedArea = pmLocText
      ? stationAreas.find(
          (a) =>
            pmLocText.includes(a.code.toLowerCase()) ||
            (a.name && pmLocText.includes(a.name.toLowerCase())),
        )
      : undefined;

    if (p.linkedJobOrder?.area_code_id) {
      setAreaCodeId(p.linkedJobOrder.area_code_id);
      setAreaTouched(true);
    } else if (pmMatchedArea) {
      setAreaCodeId(pmMatchedArea.id);
      setAreaTouched(true);
    } else if (asg?.area_code_id && stationIdSet.has(asg.area_code_id)) {
      setAreaCodeId(asg.area_code_id);
    } else {
      setAreaCodeId(stationAreas[0]?.id ?? '');
    }

    // Site / BlockLot / Account fields
    setSiteOrWell(
      p.linkedJobOrder?.site_or_well ??
        (p.linkedPmTask
          ? [p.linkedPmTask.locations?.join(', '), p.linkedPmTask.asset].filter(Boolean).join(' · ')
          : ''),
    );
    setBlockLot(p.linkedJobOrder?.block_lot ?? '');
    setAccountNumber(p.linkedJobOrder?.account_number ?? '');
    setAccountName(p.linkedJobOrder?.account_name ?? '');

    // Clear signature canvas if present
    setTimeout(() => {
      const cv = sigCanvasRef.current;
      if (cv) {
        const ctx = cv.getContext('2d');
        ctx?.clearRect(0, 0, cv.width, cv.height);
      }
    }, 50);
  }, [p.open]);

  // Sync shift & area when Lead Operator changes
  useEffect(() => {
    if (!p.open || !leadOpId) return;
    const asg = asgByOp.get(leadOpId);
    if (asg?.shift_type_id) setShiftTypeId(asg.shift_type_id);
    if (!areaTouched && asg?.area_code_id && stationIdSet.has(asg.area_code_id)) {
      setAreaCodeId(asg.area_code_id);
    }
    setCrewOpIds((prev) => prev.filter((id) => id !== leadOpId));
  }, [leadOpId, p.open, asgByOp, stationIdSet, areaTouched]);

  // 12-digit utility account auto-parser
  useEffect(() => {
    const parsed = parse12DigitAccount(accountNumber);
    if (!parsed) return;
    const clean = accountNumber.replace(/[\s-]+/g, '').trim();
    if (clean === lastParsedRef.current) return;
    lastParsedRef.current = clean;

    setBlockLot((prev) => (prev ? prev : parsed.blockLotFormatted));
    setSiteOrWell((prev) => (prev ? prev : `Phase ${parsed.phaseCode}`));
    if (!areaTouched) {
      const matchedArea = stationAreas.find(
        (a) =>
          a.code.toUpperCase() === parsed.projectCode.toUpperCase() ||
          (a.name ?? '').toUpperCase().includes(parsed.projectCode.toUpperCase()),
      );
      if (matchedArea) setAreaCodeId(matchedArea.id);
    }
  }, [accountNumber, areaTouched, stationAreas]);

  // Operators on duty today for 1-tap crew tagging
  const { sameShiftOps, otherOps } = useMemo(() => {
    const same: LoggerOperator[] = [];
    const others: LoggerOperator[] = [];
    for (const op of p.operators) {
      if (op.id === leadOpId) continue;
      const asg = asgByOp.get(op.id);
      const s = asg?.shift_type_id ? shiftBy.get(asg.shift_type_id) : undefined;
      const onDuty = Boolean(s && !s.is_off);
      const sameAreaOrShift =
        onDuty &&
        ((areaCodeId && asg?.area_code_id === areaCodeId) ||
          (shiftTypeId && asg?.shift_type_id === shiftTypeId) ||
          !areaCodeId);
      if (sameAreaOrShift) same.push(op);
      else others.push(op);
    }
    return { sameShiftOps: same, otherOps: others };
  }, [p.operators, leadOpId, asgByOp, shiftBy, areaCodeId, shiftTypeId]);

  const meterCalc = useMemo(() => {
    const toNum = (v: string) => (v.trim() === '' ? null : Number(v));
    const refV = Number(refVolumeM3) || 0.01;
    return computeMeterTestResult(toNum(initialReading), toNum(reading1), toNum(reading2), toNum(reading3), refV);
  }, [initialReading, reading1, reading2, reading3, refVolumeM3]);

  if (!p.open) return null;

  function toggleCrew(id: string) {
    setCrewOpIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleCaptureGps() {
    if (!navigator.geolocation) {
      setGpsStatus('Geolocation not supported in this browser.');
      return;
    }
    setGpsStatus('Acquiring GPS fix…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLat(Number(pos.coords.latitude.toFixed(6)));
        setGpsLng(Number(pos.coords.longitude.toFixed(6)));
        setGpsStatus(`±${Math.round(pos.coords.accuracy)}m`);
      },
      (err) => {
        setGpsStatus(`GPS unavailable: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadingPhoto(true);
    setErrMsg('');
    const sb = supabaseBrowser();
    let totalSaved = 0;
    const added: Array<{ url: string; storagePath: string | null; preview: string }> = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        if (navigator.onLine) {
          const res = await uploadActivityPhoto(sb, p.orgId, file);
          added.push({ url: res.url, storagePath: res.storagePath, preview: res.url });
          totalSaved += res.savedBytes;
        } else {
          const compact = await compressImageFile(file, 480, 0.65);
          added.push({ url: compact.dataUrl, storagePath: null, preview: compact.dataUrl });
          totalSaved += compact.savedBytes;
        }
      } catch (err: unknown) {
        setErrMsg(`Photo processing error: ${getErrorMessage(err, 'unknown')}`);
      }
    }

    if (added.length > 0) {
      setPhotos((prev) => [...prev, ...added]);
    }
    if (totalSaved > 0) {
      setSavedBytesTotal((prev) => prev + totalSaved);
    }
    setUploadingPhoto(false);
    e.target.value = '';
  }

  function getCanvasCoords(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = sigCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function buildDetails(): Record<string, unknown> {
    if (activityType === 'genset_monitoring') {
      return {
        gensetInitialFuel: gensetInitialFuel ? Number(gensetInitialFuel) : null,
        gensetFinalFuel: gensetFinalFuel ? Number(gensetFinalFuel) : null,
        runningHours: runningHours ? Number(runningHours) : null,
        gensetCause,
      };
    }
    if (activityType === 'pump_monitoring') {
      return {
        pressurePsi: pressurePsi ? Number(pressurePsi) : null,
        flowLps: flowLps ? Number(flowLps) : null,
        totalizerReading: totalizerReading ? Number(totalizerReading) : null,
        chlorineResidual: chlorineResidual ? Number(chlorineResidual) : null,
      };
    }
    if (activityType === 'flushing') {
      return {
        flushingInitialRead: flushingInitialRead ? Number(flushingInitialRead) : null,
        flushingFinalRead: flushingFinalRead ? Number(flushingFinalRead) : null,
        blowOffs: blowOffs.map((b) => ({
          name: b.name,
          initialRead: b.initialRead ? Number(b.initialRead) : null,
          finalRead: b.finalRead ? Number(b.finalRead) : null,
        })),
      };
    }
    if (activityType === 'meter_test') {
      return {
        accountNumber: accountNumber.trim() || null,
        accountName: accountName.trim() || null,
        meterBrand: meterBrand.trim() || null,
        meterSerialNumber: meterSerialNumber.trim() || null,
        meterSize: meterSize.trim() || null,
        meterNature,
        testNature,
        refVolumeM3: Number(refVolumeM3) || 0.01,
        initialReading: initialReading !== '' ? Number(initialReading) : null,
        reading1: reading1 !== '' ? Number(reading1) : null,
        reading2: reading2 !== '' ? Number(reading2) : null,
        reading3: reading3 !== '' ? Number(reading3) : null,
        ...meterCalc,
        witnessedBy: witnessedBy.trim() || null,
      };
    }
    if (
      activityType === 'meter_inst' ||
      activityType === 'meter_replacement' ||
      activityType === 'meter_check_indiv' ||
      activityType === 'meter_check_bulk' ||
      activityType === 'reconnection'
    ) {
      return {
        accountNumber: accountNumber.trim() || null,
        accountName: accountName.trim() || null,
        isMeterRunning,
        needsDeclogging,
        oldMeterBrand: oldMeterBrand.trim() || null,
        oldMeterSerial: oldMeterSerial.trim() || null,
        oldMeterReading: oldMeterReading !== '' ? Number(oldMeterReading) : null,
        newMeterBrand: newMeterBrand.trim() || null,
        newMeterSerial: newMeterSerial.trim() || null,
        newMeterReading: newMeterReading !== '' ? Number(newMeterReading) : null,
      };
    }
    if (activityType === 'leak_repair' || activityType === 'leak_detection') {
      return {
        pipeSize: pipeSize.trim() || null,
        leakType: leakType.trim() || null,
        usedMaterials: usedMaterials.filter((m) => m.item.trim() !== ''),
      };
    }
    if (activityType === 'tankering') {
      return {
        vehicleType: vehicleType.trim() || null,
        plateNumber: plateNumber.trim() || null,
        driverName: driverName.trim() || null,
        haulingCycles: haulingCycles.filter((c) => c.sourceLocation.trim() || c.deliveryLocation.trim() || c.volumeM3.trim()),
      };
    }
    if (activityType === 'water_sampling') {
      return {
        chlorineResidual: chlorineResidual !== '' ? Number(chlorineResidual) : null,
        turbidityNtu: turbidityNtu !== '' ? Number(turbidityNtu) : null,
        phLevel: phLevel !== '' ? Number(phLevel) : null,
        samplePoint: samplePoint.trim() || null,
      };
    }
    if (activityType === 'backwash') {
      return {
        filterUnit: filterUnit.trim() || null,
        backwashDurationMin: backwashDurationMin !== '' ? Number(backwashDurationMin) : null,
        pressurePsi: pressurePsi !== '' ? Number(pressurePsi) : null,
        waterClarity,
      };
    }
    if (activityType === 'thermal_scanning') {
      return {
        scannedEquipment: scannedEquipment.trim() || null,
        maxTempC: maxTempC !== '' ? Number(maxTempC) : null,
        hotspotFound,
      };
    }
    if (activityType === 'water_level_monitoring') {
      const swl = swlMeters !== '' ? Number(swlMeters) : null;
      const pwl = pwlMeters !== '' ? Number(pwlMeters) : null;
      return {
        swlMeters: swl,
        pwlMeters: pwl,
        drawdownMeters: swl !== null && pwl !== null ? Math.round((pwl - swl) * 100) / 100 : null,
      };
    }
    return {};
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrMsg('');
    if (!activityType) {
      setErrMsg('Please select an activity type.');
      return;
    }

    setSubmitting(true);
    const sigData =
      activityType === 'meter_test' && hasSignature && sigCanvasRef.current
        ? sigCanvasRef.current.toDataURL('image/png')
        : null;

    const expiresIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    type ActivitySubmitPayload = Omit<
      DailyActivityRow,
      'id' | 'verified_by' | 'verified_at' | 'review_note' | 'photos_purged_at' | 'created_at' | 'updated_at'
    >;
    const payload: ActivitySubmitPayload = {
      organization_id: p.orgId,
      activity_date: p.date,
      logged_by: p.userId,
      lead_operator_id: leadOpId || null,
      crew_operator_ids: crewOpIds.filter((id) => id && id !== leadOpId),
      shift_type_id: shiftTypeId || null,
      area_code_id: areaCodeId || null,
      site_or_well: siteOrWell.trim() || null,
      block_lot: blockLot.trim() || null,
      activity_type: activityType,
      pm_task_id: p.linkedPmTask?.id ?? null,
      status: 'submitted',
      started_at: toManilaTimestampIso(p.date, startedHHMM),
      completed_at: toManilaTimestampIso(p.date, completedHHMM) ?? new Date().toISOString(),
      gps_lat: gpsLat,
      gps_lng: gpsLng,
      notes: notes.trim() || null,
      details: buildDetails(),
      photo_urls: photos.map((ph) => ph.url),
      photo_storage_paths: photos.map((ph) => ph.storagePath).filter((sp): sp is string => Boolean(sp)),
      photos_expires_at: photos.length > 0 ? expiresIso : null,
      signature_data: sigData,
      ...(p.linkedJobOrder?.id ? { job_order_id: p.linkedJobOrder.id } : {}),
    };

    const buildOfflineActivityRow = (): DailyActivityRow => ({
      id: `offline-${Date.now()}`,
      ...payload,
      verified_by: null,
      verified_at: null,
      review_note: null,
      photos_purged_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (!navigator.onLine && p.onQueuedOffline) {
      await p.onQueuedOffline(payload);
      setSubmitting(false);
      p.onSaved(buildOfflineActivityRow(), { offline: true });
      p.onClose();
      return;
    }

    try {
      const sb = supabaseBrowser();
      if (p.editingActivity?.id) {
        const updatePayload: Partial<ActivitySubmitPayload> = {
          lead_operator_id: payload.lead_operator_id,
          crew_operator_ids: payload.crew_operator_ids,
          shift_type_id: payload.shift_type_id,
          area_code_id: payload.area_code_id,
          site_or_well: payload.site_or_well,
          block_lot: payload.block_lot,
          activity_type: payload.activity_type,
          started_at: payload.started_at,
          completed_at: payload.completed_at,
          gps_lat: payload.gps_lat,
          gps_lng: payload.gps_lng,
          notes: payload.notes,
          details: payload.details,
          photo_urls: payload.photo_urls,
          photo_storage_paths: payload.photo_storage_paths,
          photos_expires_at: payload.photos_expires_at,
          signature_data: sigData ?? p.editingActivity.signature_data ?? null,
          status: p.editingActivity.status === 'flagged' ? 'submitted' : p.editingActivity.status,
        };
        const { data, error } = await sb
          .from('daily_activities')
          .update(updatePayload)
          .eq('id', p.editingActivity.id)
          .select('*')
          .single();
        if (error) throw error;
        setSubmitting(false);
        p.onSaved(data as DailyActivityRow);
        p.onClose();
        return;
      }

      const { data, error } = await sb.from('daily_activities').insert(payload).select('*').single();
      if (error) throw error;

      if (p.linkedPmTask?.id) {
        await sb
          .from('pm_tasks')
          .update({
            status: 'done',
            completed_at: p.date,
            remarks: notes.trim() || `Logged via field activity (${activityType})`,
          })
          .eq('id', p.linkedPmTask.id);
      }

      if (p.linkedJobOrder?.id) {
        await sb
          .from('job_orders')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('id', p.linkedJobOrder.id);
      }

      setSubmitting(false);
      p.onSaved(data as DailyActivityRow);
      p.onClose();
    } catch (err: unknown) {
      // Fall back to offline queue if network failure and callback available
      const message = getErrorMessage(err, 'Save failed');
      const looksOffline = !navigator.onLine || /fetch|network|failed to load/i.test(message);
      if (looksOffline && p.onQueuedOffline) {
        await p.onQueuedOffline(payload);
        setSubmitting(false);
        p.onSaved(buildOfflineActivityRow(), { offline: true });
        p.onClose();
        return;
      }
      setSubmitting(false);
      setErrMsg(message);
    }
  }

  const isMeterActivity =
    activityType === 'meter_inst' ||
    activityType === 'meter_replacement' ||
    activityType === 'meter_check_indiv' ||
    activityType === 'meter_check_bulk' ||
    activityType === 'reconnection';

  return (
    <div
      className="modal-overlay no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby="activity-logger-title"
      onClick={() => !submitting && p.onClose()}
    >
      <form
        className="modal-sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{ maxWidth: 640, display: 'grid', gap: 12 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div>
            <h2 id="activity-logger-title" style={{ margin: 0, fontSize: 17 }}>
              {p.editingActivity
                ? 'Edit Field Activity'
                : p.linkedPmTask
                  ? `Log & Complete PM: ${p.linkedPmTask.title}`
                  : p.linkedJobOrder
                    ? `Fulfill Job Order: ${p.linkedJobOrder.jo_number}`
                    : 'Log Daily Field Activity'}
            </h2>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Date: <b>{p.date}</b> (Manila) · Auto-linked to Roster Shift &amp; Area
            </div>
          </div>
          <button type="button" className="btn" onClick={p.onClose} disabled={submitting} aria-label="Close">
            ✕
          </button>
        </div>

        {/* Core Fields */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600 }}>
            Activity Type *
            <select
              className="input"
              value={activityType}
              onChange={(e) => setActivityType(e.target.value)}
              required
            >
              {ACTIVITY_CATEGORIES.map((cat: ActivityCategory) => (
                <optgroup key={cat} label={ACTIVITY_CATEGORY_LABELS[cat]}>
                  {ACTIVITY_TYPES.filter((a) => a.category === cat).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {p.linkedPmTask && (
              <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--accent)' }}>
                Auto-matched from PM: &ldquo;{p.linkedPmTask.title}&rdquo;
              </span>
            )}
          </label>

          <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600 }}>
            Station / Area (from Setup)
            <select
              className="input"
              value={areaCodeId}
              onChange={(e) => {
                setAreaTouched(true);
                setAreaCodeId(e.target.value);
              }}
            >
              <option value="">— Select Area / Station —</option>
              {stationAreas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code}
                  {a.name ? ` · ${a.name}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600 }}>
            Well / Pump / Site (optional)
            <input
              className="input"
              list="station-sub-sites-list"
              placeholder="e.g. Well 2, Booster 1, Mainline"
              value={siteOrWell}
              onChange={(e) => setSiteOrWell(e.target.value)}
            />
            {(() => {
              const selArea = stationAreas.find((a) => a.id === areaCodeId);
              const subs = selArea?.sub_sites ?? [];
              if (subs.length === 0) return null;
              return (
                <>
                  <datalist id="station-sub-sites-list">
                    {subs.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                    {subs.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSiteOrWell(s)}
                        style={{
                          padding: '2px 7px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                          border: siteOrWell === s ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                          background: siteOrWell === s ? 'var(--primary)' : 'var(--surface-muted)',
                          color: siteOrWell === s ? 'var(--primary-fg)' : 'var(--text-secondary)',
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </>
              );
            })()}
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600 }}>
            Block &amp; Lot / Location Detail
            <input
              className="input"
              placeholder="e.g. Block 004 Lot 012"
              value={blockLot}
              onChange={(e) => setBlockLot(e.target.value)}
            />
          </label>
        </div>

        {/* Lead & Crew Tagging */}
        <div
          className="card"
          style={{
            padding: 10,
            background: 'var(--surface-muted)',
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600 }}>
              Lead Operator
              <select
                className="input"
                value={leadOpId}
                onChange={(e) => setLeadOpId(e.target.value)}
              >
                <option value="">— Unspecified —</option>
                {p.operators.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.full_name}
                    {o.id === p.operatorId ? ' (Me)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600 }}>
              Shift (Roster-Linked)
              <select
                className="input"
                value={shiftTypeId}
                onChange={(e) => setShiftTypeId(e.target.value)}
              >
                <option value="">— None —</option>
                {p.shifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code}
                    {s.description ? ` · ${s.description}` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                Tag Co-Operators / Crew ({crewOpIds.length} tagged — all receive credit)
              </span>
              {otherOps.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllOps((v) => !v)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--accent)',
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {showAllOps ? 'Hide off-shift ops' : `+ Show all (${otherOps.length} more)`}
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {sameShiftOps.map((op) => {
                const selected = crewOpIds.includes(op.id);
                return (
                  <button
                    key={op.id}
                    type="button"
                    onClick={() => toggleCrew(op.id)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 999,
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: selected ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                      background: selected ? 'var(--primary)' : 'var(--surface)',
                      color: selected ? 'var(--primary-fg)' : 'var(--text)',
                    }}
                  >
                    {selected ? '✓ ' : '+ '}
                    {op.full_name}
                  </button>
                );
              })}
              {showAllOps &&
                otherOps.map((op) => {
                  const selected = crewOpIds.includes(op.id);
                  return (
                    <button
                      key={op.id}
                      type="button"
                      onClick={() => toggleCrew(op.id)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 999,
                        fontSize: 11.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                        border: selected ? '1.5px solid var(--primary)' : '1px dashed var(--border)',
                        background: selected ? 'var(--primary)' : 'var(--surface)',
                        color: selected ? 'var(--primary-fg)' : 'var(--text-secondary)',
                      }}
                    >
                      {selected ? '✓ ' : '+ '}
                      {op.full_name}
                    </button>
                  );
                })}
              {sameShiftOps.length === 0 && !showAllOps && otherOps.length === 0 && (
                <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>No other active operators available.</span>
              )}
            </div>
          </div>
        </div>

        {/* Dynamic Specialized Fields based on activityType */}
        {activityType === 'genset_monitoring' && (
          <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: '#f59e0b' }}>
            <strong style={{ fontSize: 12.5, color: '#b45309' }}>Genset Monitoring Telemetry</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Initial Fuel (L / %)
                <input className="input" type="number" step="0.1" value={gensetInitialFuel} onChange={(e) => setGensetInitialFuel(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Final Fuel (L / %)
                <input className="input" type="number" step="0.1" value={gensetFinalFuel} onChange={(e) => setGensetFinalFuel(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Running Hours
                <input className="input" type="number" step="0.1" value={runningHours} onChange={(e) => setRunningHours(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Run Cause
                <select className="input" value={gensetCause} onChange={(e) => setGensetCause(e.target.value as 'Routine' | 'Power Outage' | 'PMS')}>
                  <option value="Routine">Routine Test</option>
                  <option value="Power Outage">Power Outage</option>
                  <option value="PMS">PMS</option>
                </select>
              </label>
            </div>
          </div>
        )}

        {activityType === 'pump_monitoring' && (
          <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: '#0284c7' }}>
            <strong style={{ fontSize: 12.5, color: '#0369a1' }}>Pump House Readings</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Pressure (PSI)
                <input className="input" type="number" step="0.1" value={pressurePsi} onChange={(e) => setPressurePsi(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Flow (LPS)
                <input className="input" type="number" step="0.1" value={flowLps} onChange={(e) => setFlowLps(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Totalizer (m³)
                <input className="input" type="number" step="0.01" value={totalizerReading} onChange={(e) => setTotalizerReading(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Chlorine Res. (mg/L)
                <input className="input" type="number" step="0.01" value={chlorineResidual} onChange={(e) => setChlorineResidual(e.target.value)} />
              </label>
            </div>
          </div>
        )}

        {activityType === 'flushing' && (
          <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: '#2563eb' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 12.5, color: '#1d4ed8' }}>Line Flushing &amp; Blow-Off Readings</strong>
              <button
                type="button"
                className="btn"
                style={{ minHeight: 28, padding: '2px 8px', fontSize: 11.5 }}
                onClick={() =>
                  setBlowOffs((prev) => [...prev, { name: `Blow-off ${prev.length + 1}`, initialRead: '', finalRead: '' }])
                }
              >
                + Add Point
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Main Meter Initial (m³)
                <input className="input" type="number" step="0.01" value={flushingInitialRead} onChange={(e) => setFlushingInitialRead(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Main Meter Final (m³)
                <input className="input" type="number" step="0.01" value={flushingFinalRead} onChange={(e) => setFlushingFinalRead(e.target.value)} />
              </label>
            </div>
            {blowOffs.map((bo, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr auto', gap: 6, alignItems: 'end' }}>
                <input
                  className="input"
                  placeholder="Point name"
                  value={bo.name}
                  onChange={(e) =>
                    setBlowOffs((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
                  }
                />
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  placeholder="Initial"
                  value={bo.initialRead}
                  onChange={(e) =>
                    setBlowOffs((prev) => prev.map((x, i) => (i === idx ? { ...x, initialRead: e.target.value } : x)))
                  }
                />
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  placeholder="Final"
                  value={bo.finalRead}
                  onChange={(e) =>
                    setBlowOffs((prev) => prev.map((x, i) => (i === idx ? { ...x, finalRead: e.target.value } : x)))
                  }
                />
                {blowOffs.length > 1 && (
                  <button
                    type="button"
                    className="btn"
                    style={{ minHeight: 38, padding: '0 8px', color: 'var(--danger)' }}
                    onClick={() => setBlowOffs((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {activityType === 'meter_test' && (
          <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: '#9333ea' }}>
            <strong style={{ fontSize: 12.5, color: '#7e22ce' }}>Volumetric Meter Calibration Test</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Account # (12-char auto-parse)
                <input className="input" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="e.g. 001002003004" />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Account Name
                <input className="input" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Meter Brand
                <input className="input" value={meterBrand} onChange={(e) => setMeterBrand(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Serial #
                <input className="input" value={meterSerialNumber} onChange={(e) => setMeterSerialNumber(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Size
                <input className="input" value={meterSize} onChange={(e) => setMeterSize(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Ref. Vol (m³)
                <input className="input" type="number" step="0.001" value={refVolumeM3} onChange={(e) => setRefVolumeM3(e.target.value)} />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
              <label style={{ display: 'grid', gap: 2, fontSize: 11.5 }}>
                Initial
                <input className="input" type="number" step="0.0001" value={initialReading} onChange={(e) => setInitialReading(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 2, fontSize: 11.5 }}>
                Trial 1
                <input className="input" type="number" step="0.0001" value={reading1} onChange={(e) => setReading1(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 2, fontSize: 11.5 }}>
                Trial 2
                <input className="input" type="number" step="0.0001" value={reading2} onChange={(e) => setReading2(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 2, fontSize: 11.5 }}>
                Trial 3
                <input className="input" type="number" step="0.0001" value={reading3} onChange={(e) => setReading3(e.target.value)} />
              </label>
            </div>
            {meterCalc.avgErr !== null && (
              <div
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: meterCalc.verdict === 'Passed' ? '#dcfce7' : '#fee2e2',
                  color: meterCalc.verdict === 'Passed' ? '#166534' : '#991b1b',
                  fontSize: 12.5,
                  fontWeight: 700,
                  display: 'flex',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <span>Avg Error: {meterCalc.avgErr}% ({meterCalc.verdict})</span>
                <span>Recommendation: {meterCalc.recommendation}</span>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Witnessed By
                <input className="input" value={witnessedBy} onChange={(e) => setWitnessedBy(e.target.value)} placeholder="Customer / rep name" />
              </label>
              <div style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Witness Signature</span>
                  <button
                    type="button"
                    style={{ background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: 11, cursor: 'pointer', padding: 0 }}
                    onClick={() => {
                      const cv = sigCanvasRef.current;
                      if (cv) cv.getContext('2d')?.clearRect(0, 0, cv.width, cv.height);
                      setHasSignature(false);
                    }}
                  >
                    Clear
                  </button>
                </div>
                <canvas
                  ref={sigCanvasRef}
                  width={260}
                  height={76}
                  style={{
                    width: '100%',
                    height: 76,
                    background: '#ffffff',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    touchAction: 'none',
                  }}
                  onPointerDown={(e) => {
                    const cv = sigCanvasRef.current;
                    const ctx = cv?.getContext('2d');
                    if (!cv || !ctx) return;
                    sigDrawingRef.current = true;
                    const pt = getCanvasCoords(e);
                    ctx.strokeStyle = '#0f172a';
                    ctx.lineWidth = 2;
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    ctx.moveTo(pt.x, pt.y);
                    setHasSignature(true);
                  }}
                  onPointerMove={(e) => {
                    if (!sigDrawingRef.current) return;
                    const ctx = sigCanvasRef.current?.getContext('2d');
                    if (!ctx) return;
                    const pt = getCanvasCoords(e);
                    ctx.lineTo(pt.x, pt.y);
                    ctx.stroke();
                  }}
                  onPointerUp={() => {
                    sigDrawingRef.current = false;
                  }}
                  onPointerLeave={() => {
                    sigDrawingRef.current = false;
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {isMeterActivity && (
          <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: '#16a34a' }}>
            <strong style={{ fontSize: 12.5, color: '#15803d' }}>Customer &amp; Meter Details</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Account # (12-char auto-parse)
                <input className="input" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="e.g. 001002003004" />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Account Name
                <input className="input" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Meter Running?
                <select className="input" value={isMeterRunning} onChange={(e) => setIsMeterRunning(e.target.value as 'Yes' | 'No')}>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Needs Declogging?
                <select className="input" value={needsDeclogging} onChange={(e) => setNeedsDeclogging(e.target.value as 'No' | 'Yes')}>
                  <option value="No">No</option>
                  <option value="Yes">Yes</option>
                </select>
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Old Brand / Serial
                <input className="input" value={oldMeterSerial} onChange={(e) => setOldMeterSerial(e.target.value)} placeholder="Serial #" />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Old Reading
                <input className="input" type="number" step="0.01" value={oldMeterReading} onChange={(e) => setOldMeterReading(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                New Brand / Serial
                <input className="input" value={newMeterSerial} onChange={(e) => setNewMeterSerial(e.target.value)} placeholder="Serial #" />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                New Initial Read
                <input className="input" type="number" step="0.01" value={newMeterReading} onChange={(e) => setNewMeterReading(e.target.value)} />
              </label>
            </div>
          </div>
        )}

        {(activityType === 'leak_repair' || activityType === 'leak_detection') && (
          <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: '#dc2626' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 12.5, color: '#b91c1c' }}>Leak Details &amp; Materials</strong>
              <button
                type="button"
                className="btn"
                style={{ minHeight: 28, padding: '2px 8px', fontSize: 11.5 }}
                onClick={() => setUsedMaterials((prev) => [...prev, { item: '', qty: '1' }])}
              >
                + Material
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Pipe Size / Material
                <input className="input" value={pipeSize} onChange={(e) => setPipeSize(e.target.value)} placeholder='e.g. 2" uPVC' />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Leak Classification / Cause
                <input className="input" value={leakType} onChange={(e) => setLeakType(e.target.value)} placeholder="e.g. Saddle clamp, joint" />
              </label>
            </div>
            {usedMaterials.map((m, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 90px auto', gap: 6 }}>
                <input
                  className="input"
                  placeholder="Material used (e.g. Coupling 2 inch)"
                  value={m.item}
                  onChange={(e) =>
                    setUsedMaterials((prev) => prev.map((x, i) => (i === idx ? { ...x, item: e.target.value } : x)))
                  }
                />
                <input
                  className="input"
                  placeholder="Qty"
                  value={m.qty}
                  onChange={(e) =>
                    setUsedMaterials((prev) => prev.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))
                  }
                />
                <button
                  type="button"
                  className="btn"
                  style={{ minHeight: 38, padding: '0 8px', color: 'var(--danger)' }}
                  onClick={() => setUsedMaterials((prev) => prev.filter((_, i) => i !== idx))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {activityType === 'tankering' && (
          <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: '#7c3aed' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 12.5, color: '#6d28d9' }}>Water Hauling / Tanker Log</strong>
              <button
                type="button"
                className="btn"
                style={{ minHeight: 28, padding: '2px 8px', fontSize: 11.5 }}
                onClick={() =>
                  setHaulingCycles((prev) => [
                    ...prev,
                    { sourceLocation: '', deliveryLocation: '', volumeM3: '', loadingTime: '', injectionTime: '' },
                  ])
                }
              >
                + Trip Cycle
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <input className="input" placeholder="Vehicle Type" value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} />
              <input className="input" placeholder="Plate #" value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} />
              <input className="input" placeholder="Driver Name" value={driverName} onChange={(e) => setDriverName(e.target.value)} />
            </div>
            {haulingCycles.map((c, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: 6 }}>
                <input
                  className="input"
                  placeholder="Source"
                  value={c.sourceLocation}
                  onChange={(e) =>
                    setHaulingCycles((prev) => prev.map((x, i) => (i === idx ? { ...x, sourceLocation: e.target.value } : x)))
                  }
                />
                <input
                  className="input"
                  placeholder="Delivery site"
                  value={c.deliveryLocation}
                  onChange={(e) =>
                    setHaulingCycles((prev) => prev.map((x, i) => (i === idx ? { ...x, deliveryLocation: e.target.value } : x)))
                  }
                />
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  placeholder="m³"
                  value={c.volumeM3}
                  onChange={(e) =>
                    setHaulingCycles((prev) => prev.map((x, i) => (i === idx ? { ...x, volumeM3: e.target.value } : x)))
                  }
                />
              </div>
            ))}
          </div>
        )}

        {activityType === 'water_sampling' && (
          <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: '#0891b2' }}>
            <strong style={{ fontSize: 12.5, color: '#0e7490' }}>Water Quality / Chlorination Readings</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Free Cl₂ (mg/L)
                <input className="input" type="number" step="0.01" value={chlorineResidual} onChange={(e) => setChlorineResidual(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Turbidity (NTU)
                <input className="input" type="number" step="0.01" value={turbidityNtu} onChange={(e) => setTurbidityNtu(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                pH Level
                <input className="input" type="number" step="0.1" value={phLevel} onChange={(e) => setPhLevel(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Sample Point
                <input className="input" value={samplePoint} onChange={(e) => setSamplePoint(e.target.value)} />
              </label>
            </div>
          </div>
        )}

        {activityType === 'backwash' && (
          <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: '#7c3aed' }}>
            <strong style={{ fontSize: 12.5, color: '#6d28d9' }}>MMF / Filter Backwash Telemetry</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Filter / MMF Unit
                <input className="input" placeholder="e.g. MMF-1, Vessel A" value={filterUnit} onChange={(e) => setFilterUnit(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Duration (mins)
                <input className="input" type="number" step="1" value={backwashDurationMin} onChange={(e) => setBackwashDurationMin(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Pressure (PSI)
                <input className="input" type="number" step="0.1" value={pressurePsi} onChange={(e) => setPressurePsi(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Discharge Clarity
                <select className="input" value={waterClarity} onChange={(e) => setWaterClarity(e.target.value as 'Clear' | 'Slightly Turbid' | 'Turbid')}>
                  <option value="Clear">Clear</option>
                  <option value="Slightly Turbid">Slightly Turbid</option>
                  <option value="Turbid">Turbid</option>
                </select>
              </label>
            </div>
          </div>
        )}

        {activityType === 'thermal_scanning' && (
          <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: '#ea580c' }}>
            <strong style={{ fontSize: 12.5, color: '#c2410c' }}>Thermal Scanning Readings</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Panel / Motor Scanned
                <input className="input" placeholder="e.g. MCC Panel, Pump 1" value={scannedEquipment} onChange={(e) => setScannedEquipment(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Max Temp (°C)
                <input className="input" type="number" step="0.1" value={maxTempC} onChange={(e) => setMaxTempC(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Hotspot Detected?
                <select className="input" value={hotspotFound} onChange={(e) => setHotspotFound(e.target.value as 'No' | 'Yes')}>
                  <option value="No">No (Normal)</option>
                  <option value="Yes">Yes (Needs Attention)</option>
                </select>
              </label>
            </div>
          </div>
        )}

        {activityType === 'water_level_monitoring' && (
          <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: '#ca8a04' }}>
            <strong style={{ fontSize: 12.5, color: '#a16207' }}>Well Water Level (SWL &amp; PWL)</strong>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Static Water Level — SWL (m)
                <input className="input" type="number" step="0.01" value={swlMeters} onChange={(e) => setSwlMeters(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Pumping Water Level — PWL (m)
                <input className="input" type="number" step="0.01" value={pwlMeters} onChange={(e) => setPwlMeters(e.target.value)} />
              </label>
            </div>
          </div>
        )}

        {/* Times + Notes */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
            Start Time (optional)
            <input className="input" type="time" value={startedHHMM} onChange={(e) => setStartedHHMM(e.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
            Completion Time
            <input className="input" type="time" value={completedHHMM} onChange={(e) => setCompletedHHMM(e.target.value)} />
          </label>
        </div>

        <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600 }}>
          Field Notes / Observations
          <textarea
            className="input"
            rows={2}
            placeholder="Work performed, pressure/reading summary, follow-ups needed…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ minHeight: 58 }}
          />
        </label>

        {/* GPS & 30-day Expiring Photo Capture */}
        <div style={{ display: 'grid', gap: 8, padding: 10, borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <button type="button" className="btn" onClick={handleCaptureGps} style={{ fontSize: 12 }}>
              {gpsLat !== null ? `📍 ${gpsLat}, ${gpsLng}` : '📍 Attach GPS Location'}
            </button>
            {gpsStatus && <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{gpsStatus}</span>}

            <label className="btn" style={{ fontSize: 12, cursor: uploadingPhoto ? 'wait' : 'pointer' }}>
              {uploadingPhoto ? 'Compressing & Uploading…' : '📷 Add Field Photos'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                disabled={uploadingPhoto}
                onChange={handlePhotoUpload}
                style={{ display: 'none' }}
              />
            </label>
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
            <span>Compressed client-side · Photos auto-expire after 30 days to conserve storage limits.</span>
            {savedBytesTotal > 0 && (
              <span style={{ color: '#16a34a', fontWeight: 700 }}>
                Saved {(savedBytesTotal / 1024).toFixed(0)} KB
              </span>
            )}
          </div>

          {photos.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {photos.map((ph, idx) => (
                <div key={idx} style={{ position: 'relative', width: 68, height: 68 }}>
                  <img
                    src={ph.preview}
                    alt={`Field attachment ${idx + 1}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }}
                  />
                  <button
                    type="button"
                    aria-label="Remove photo"
                    onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                    style={{
                      position: 'absolute',
                      top: -5,
                      right: -5,
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      border: 'none',
                      background: '#dc2626',
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {errMsg && (
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: 'var(--danger)', fontWeight: 600 }}>
            {errMsg}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button type="button" className="btn" onClick={p.onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting || uploadingPhoto}>
            {submitting ? 'Saving Activity…' : p.editingActivity ? 'Save Changes' : p.linkedPmTask ? 'Log Activity & Complete PM' : p.linkedJobOrder ? 'Log Activity & Close JO' : 'Submit Activity Log'}
          </button>
        </div>
      </form>
    </div>
  );
}
