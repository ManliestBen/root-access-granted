import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  API_BASE,
  setAuthCallbacks,
  fetchWithAuth,
  type ScheduleRule,
  type ScheduleRuleCreate,
  type AppSettings,
} from "./api/client";
import LoginView from "./LoginView";
import AuthImg from "./AuthImg";
import { RadialGauge } from "./RadialGauge";
import "./App.css";

const AUTH_STORAGE_KEY = "gardyn_token";

/** All schedule times are in Central Time (device time on the Pi). */
const CENTRAL_TZ = "America/Chicago";

function formatTimeCentralShort(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    timeZone: CENTRAL_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Format stored "HH:MM" (24h) as 12h for display (e.g. "09:00" -> "9:00 AM"). */
function formatTime12h(hhmm: string | null | undefined): string {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm.trim())) return hhmm ?? "";
  const [h, m] = hhmm.trim().split(":").map(Number);
  const hour = h % 12 || 12;
  const ampm = h < 12 ? "AM" : "PM";
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** Format ISO datetime for "Paused until XX:XX" display (e.g. "2:30 PM"). */
function formatPausedUntil(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    return iso;
  }
}

function isPausedInFuture(pausedUntil: string | null): boolean {
  if (!pausedUntil) return false;
  try {
    return new Date(pausedUntil) > new Date();
  } catch {
    return false;
  }
}

/** Current time in Central as "HH:MM" (24h) for rule comparison. */
function getCurrentCentralHHMM(): string {
  const s = new Date().toLocaleTimeString("en-CA", { timeZone: CENTRAL_TZ, hour12: false });
  return s.slice(0, 5);
}

/** Minutes since midnight for "HH:MM". */
function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.trim().split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** True if current time (Central) is inside [start, end]. Handles overnight (end < start). */
function isTimeInRange(now: string, start: string, end: string | null): boolean {
  if (!end || end === "") return now === start;
  const nowM = hhmmToMinutes(now);
  const startM = hhmmToMinutes(start);
  const endM = hhmmToMinutes(end);
  if (endM > startM) return nowM >= startM && nowM < endM;
  return nowM >= startM || nowM < endM;
}

/** Effective brightness (0–100) that light rules want right now, or null if no active rule. */
function getEffectiveLightBrightnessFromRules(rules: ScheduleRule[]): number | null {
  const now = getCurrentCentralHHMM();
  let maxBrightness: number | null = null;
  for (const r of rules) {
    if (r.type !== "light" || r.enabled === false || r.paused) continue;
    const end = r.end_time ?? null;
    if (isTimeInRange(now, r.start_time, end)) {
      const b = r.brightness_pct ?? 0;
      maxBrightness = maxBrightness == null ? b : Math.max(maxBrightness, b);
    }
  }
  return maxBrightness;
}

type SensorState = {
  distance: number | null;
  humidity: number | null;
  temperature: number | null;
  pcbTemp: number | null;
  lightBrightness: number | null;
  pumpSpeed: number | null;
  pumpStats: { speed?: number; power?: number } | null;
};

function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(AUTH_STORAGE_KEY));

  useEffect(() => {
    setAuthCallbacks(
      () => token,
      () => {
        setToken(null);
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    );
  }, [token]);

  const handleLogin = useCallback((newToken: string) => {
    setToken(newToken);
    localStorage.setItem(AUTH_STORAGE_KEY, newToken);
  }, []);

  const handleLogout = useCallback(() => {
    setToken(null);
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [state, setState] = useState<SensorState>({
    distance: null,
    humidity: null,
    temperature: null,
    pcbTemp: null,
    lightBrightness: null,
    pumpSpeed: null,
    pumpStats: null,
  });
  const [lightBrightnessSlider, setLightBrightnessSlider] = useState(50);
  const [cameraUpperError, setCameraUpperError] = useState<string | null>(null);
  const [cameraLowerError, setCameraLowerError] = useState<string | null>(null);
  const [cameraPhotos, setCameraPhotos] = useState<{ filename: string; url: string }[]>([]);
  const [captureSaveLoading, setCaptureSaveLoading] = useState(false);
  const [photosError, setPhotosError] = useState<string | null>(null);

  const [rules, setRules] = useState<ScheduleRule[]>([]);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [currentTimeCentral, setCurrentTimeCentral] = useState<string>("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState<AppSettings | null>(null);
  const [dashboardSettings, setDashboardSettings] = useState<AppSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [lightOverrideModal, setLightOverrideModal] = useState<{
    open: boolean;
    action: "on" | "off";
    minutes: string;
  }>({ open: false, action: "on", minutes: "60" });
  const [pumpManualModal, setPumpManualModal] = useState<{ open: boolean; minutes: string }>({
    open: false,
    minutes: "5",
  });
  const [lightRulesPausedUntil, setLightRulesPausedUntil] = useState<string | null>(null);
  const [pumpRulesPausedUntil, setPumpRulesPausedUntil] = useState<string | null>(null);
  const [resumeModal, setResumeModal] = useState<{
    open: boolean;
    type: "light" | "pump";
    pausedUntil: string;
  }>({ open: false, type: "light", pausedUntil: "" });
  const pendingResumeActionRef = useRef<(() => void) | null>(null);

  const [scheduleForm, setScheduleForm] = useState<{
    open: boolean;
    editingId: string | null;
    type: "light" | "pump";
    start_time: string;
    end_time: string;
    use_range: boolean;
    brightness_pct: number;
    time: string;
    duration_minutes: number;
    enabled: boolean;
  }>({
    open: false,
    editingId: null,
    type: "light",
    start_time: "06:00",
    end_time: "09:00",
    use_range: true,
    brightness_pct: 70,
    time: "09:30",
    duration_minutes: 5,
    enabled: true,
  });

  const celsiusToF = (c: number) => Math.round((c * 9) / 5 + 32);

  const cameraUpperUrl = `${API_BASE}/camera/upper`;
  const cameraLowerUrl = `${API_BASE}/camera/lower`;

  const [cameraUpperRefreshKey, setCameraUpperRefreshKey] = useState(0);
  const [cameraLowerRefreshKey, setCameraLowerRefreshKey] = useState(0);
  const [cameraUpperBlobUrl, setCameraUpperBlobUrl] = useState<string | null>(null);
  const [cameraLowerBlobUrl, setCameraLowerBlobUrl] = useState<string | null>(null);
  const cameraUpperBlobRef = useRef<string | null>(null);
  const cameraLowerBlobRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) return;
    const url = `${cameraUpperUrl}?t=${cameraUpperRefreshKey}`;
    fetchWithAuth(url)
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        if (cameraUpperBlobRef.current) URL.revokeObjectURL(cameraUpperBlobRef.current);
        cameraUpperBlobRef.current = blobUrl;
        setCameraUpperBlobUrl(blobUrl);
      })
      .catch(() => setCameraUpperBlobUrl(null));
    return () => {
      if (cameraUpperBlobRef.current) {
        URL.revokeObjectURL(cameraUpperBlobRef.current);
        cameraUpperBlobRef.current = null;
      }
      setCameraUpperBlobUrl(null);
    };
  }, [token, cameraUpperUrl, cameraUpperRefreshKey]);

  useEffect(() => {
    if (!token) return;
    const url = `${cameraLowerUrl}?t=${cameraLowerRefreshKey}`;
    fetchWithAuth(url)
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        if (cameraLowerBlobRef.current) URL.revokeObjectURL(cameraLowerBlobRef.current);
        cameraLowerBlobRef.current = blobUrl;
        setCameraLowerBlobUrl(blobUrl);
      })
      .catch(() => setCameraLowerBlobUrl(null));
    return () => {
      if (cameraLowerBlobRef.current) {
        URL.revokeObjectURL(cameraLowerBlobRef.current);
        cameraLowerBlobRef.current = null;
      }
      setCameraLowerBlobUrl(null);
    };
  }, [token, cameraLowerUrl, cameraLowerRefreshKey]);

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const [distance, humidity, temperature, pcbTemp, lightBrightness, pumpSpeed, pumpStats] =
        await Promise.all([
          api.getDistance().then((r) => r.distance).catch(() => null),
          api.getHumidity().then((r) => r.humidity ?? null).catch(() => null),
          api.getTemperature().then((r) => r.temperature ?? null).catch(() => null),
          api.getPcbTemp().then((r) => r.pcb_temp ?? null).catch(() => null),
          api.getLightBrightness().then((r) => r.value ?? null).catch(() => null),
          api.getPumpSpeed().then((r) => r.value ?? null).catch(() => null),
          api.getPumpStats().catch(() => null),
        ]);
      setState({
        distance,
        humidity,
        temperature,
        pcbTemp,
        lightBrightness,
        pumpSpeed,
        pumpStats: pumpStats ?? null,
      });
      if (lightBrightness != null) setLightBrightnessSlider(lightBrightness);
      setLastUpdate(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    api.getSettings().then(setDashboardSettings).catch(() => {});
  }, [token]);

  const handleLightOn = async () => {
    const effectiveBrightness = getEffectiveLightBrightnessFromRules(rules);
    if (effectiveBrightness === 0) {
      setLightOverrideModal({ open: true, action: "on", minutes: "60" });
      return;
    }
    try {
      await api.lightOn();
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Light on failed");
    }
  };

  const handleLightOff = async () => {
    const rulesWantOn = (getEffectiveLightBrightnessFromRules(rules) ?? 0) > 0;
    if (rulesWantOn) {
      setLightOverrideModal({ open: true, action: "off", minutes: "60" });
      return;
    }
    try {
      await api.lightOff();
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Light off failed");
    }
  };

  const confirmLightOverride = async () => {
    const minutes = Math.max(1, Math.min(1440, parseInt(lightOverrideModal.minutes, 10) || 60));
    const action = lightOverrideModal.action;
    setLightOverrideModal((m) => ({ ...m, open: false }));
    try {
      await api.pauseLightRulesForMinutes(minutes);
      await fetchRules();
      if (action === "on") await api.lightOn();
      else await api.lightOff();
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Override failed");
    }
  };

  const cancelLightOverride = () => setLightOverrideModal((m) => ({ ...m, open: false }));

  const runOrShowResumeLight = (action: () => void) => {
    if (isPausedInFuture(lightRulesPausedUntil)) {
      setResumeModal({ open: true, type: "light", pausedUntil: lightRulesPausedUntil ?? "" });
      pendingResumeActionRef.current = action;
    } else {
      action();
    }
  };
  const runOrShowResumePump = (action: () => void) => {
    if (isPausedInFuture(pumpRulesPausedUntil)) {
      setResumeModal({ open: true, type: "pump", pausedUntil: pumpRulesPausedUntil ?? "" });
      pendingResumeActionRef.current = action;
    } else {
      action();
    }
  };
  const confirmResumeModal = async (resume: boolean) => {
    const type = resumeModal.type;
    const runPending = () => {
      const fn = pendingResumeActionRef.current;
      pendingResumeActionRef.current = null;
      fn?.();
    };
    setResumeModal((m) => ({ ...m, open: false }));
    if (resume) {
      try {
        if (type === "light") await api.resumeLightRules();
        else await api.resumePumpRules();
        await fetchRules();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to resume rules");
        return;
      }
    }
    runPending();
  };
  const closeResumeModal = () => {
    setResumeModal((m) => ({ ...m, open: false }));
    pendingResumeActionRef.current = null;
  };

  const handleLightBrightness = async (value: number) => {
    setLightBrightnessSlider(value);
    try {
      await api.setLightBrightness(value);
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Set brightness failed");
    }
  };

  const handlePumpOn = async () => {
    if ((state.pumpSpeed ?? 0) <= 0) {
      setPumpManualModal({ open: true, minutes: "5" });
      return;
    }
    try {
      await api.setPumpSpeed(100);
      await api.pumpOn();
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pump on failed");
    }
  };

  const confirmPumpManual = async () => {
    const minutes = Math.max(1, Math.min(120, parseInt(pumpManualModal.minutes, 10) || 5));
    setPumpManualModal({ open: false, minutes: "5" });
    try {
      await api.pausePumpRulesForMinutes(minutes);
      await api.setManualPumpOffInMinutes(minutes);
      await fetchRules();
      await api.setPumpSpeed(100);
      await api.pumpOn();
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Manual watering failed");
    }
  };

  const cancelPumpManual = () => setPumpManualModal({ open: false, minutes: "5" });

  const handlePumpOff = async () => {
    try {
      await api.pumpOff();
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pump off failed");
    }
  };

  const refreshCameraUpper = () => {
    setCameraUpperError(null);
    setCameraUpperRefreshKey((k) => k + 1);
  };
  const refreshCameraLower = () => {
    setCameraLowerError(null);
    setCameraLowerRefreshKey((k) => k + 1);
  };

  const fetchCameraPhotos = useCallback(async () => {
    setPhotosError(null);
    try {
      const res = await api.getCameraPhotos();
      setCameraPhotos(res.photos ?? []);
    } catch {
      setCameraPhotos([]);
      setPhotosError("Could not load saved photos (set CAMERA_PHOTOS_DIR on the Pi to enable).");
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    fetchCameraPhotos();
  }, [token, fetchCameraPhotos]);

  const fetchRules = useCallback(async () => {
    setRulesError(null);
    setRulesLoading(true);
    try {
      const res = await api.getRules();
      setRules(res.rules ?? []);
      setLightRulesPausedUntil(res.light_rules_paused_until ?? null);
      setPumpRulesPausedUntil(res.pump_rules_paused_until ?? null);
    } catch (e) {
      setRules([]);
      setLightRulesPausedUntil(null);
      setPumpRulesPausedUntil(null);
      const msg = e instanceof Error ? e.message : "";
      const isNetwork = msg === "Failed to fetch" || msg.includes("NetworkError") || msg.includes("load failed");
      setRulesError(
        isNetwork
          ? "Couldn’t reach the device. Make sure you’re on the same network as the Pi and it’s running the latest code."
          : msg || "Couldn’t load rules."
      );
    } finally {
      setRulesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    setRulesLoading(true);
    fetchRules();
  }, [token, fetchRules]);

  useEffect(() => {
    if (!token) return;
    fetchAll();
    const paused = isPausedInFuture(lightRulesPausedUntil) || isPausedInFuture(pumpRulesPausedUntil);
    const intervalMs = paused ? 5_000 : 30_000;
    const t = setInterval(() => {
      fetchAll();
      if (paused) fetchRules();
    }, intervalMs);
    return () => clearInterval(t);
  }, [token, fetchAll, fetchRules, lightRulesPausedUntil, pumpRulesPausedUntil]);

  // Keep "Current time (Central)" in sync for schedule UI (Netlify may be in any TZ)
  useEffect(() => {
    const tick = () => setCurrentTimeCentral(formatTimeCentralShort(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const openNewRule = (type: "light" | "pump") => {
    setScheduleForm({
      open: true,
      editingId: null,
      type,
      start_time: "06:00",
      end_time: "09:00",
      use_range: type === "light",
      brightness_pct: 70,
      time: "09:30",
      duration_minutes: 5,
      enabled: true,
    });
  };

  const openEditRule = (rule: ScheduleRule) => {
    if (rule.type === "light") {
      setScheduleForm({
        open: true,
        editingId: rule.id,
        type: "light",
        start_time: rule.start_time,
        end_time: rule.end_time ?? "",
        use_range: rule.end_time != null && rule.end_time !== "",
        brightness_pct: rule.brightness_pct,
        time: "09:30",
        duration_minutes: 5,
        enabled: rule.enabled ?? true,
      });
    } else {
      setScheduleForm({
        open: true,
        editingId: rule.id,
        type: "pump",
        start_time: "06:00",
        end_time: "",
        use_range: false,
        brightness_pct: 0,
        time: rule.time,
        duration_minutes: rule.duration_minutes,
        enabled: rule.enabled ?? true,
      });
    }
  };

  const closeRuleForm = () => {
    setScheduleForm((f) => ({ ...f, open: false, editingId: null }));
  };

  const openSettingsModal = async () => {
    setSettingsOpen(true);
    setSettingsError(null);
    setSettingsLoading(true);
    try {
      const data = await api.getSettings();
      setSettingsForm(data);
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setSettingsLoading(false);
    }
  };

  const closeSettingsModal = () => {
    setSettingsOpen(false);
    setSettingsForm(null);
    setSettingsError(null);
  };

  const saveSettings = async () => {
    if (!settingsForm) return;
    setSettingsError(null);
    try {
      const updated = await api.updateSettings(settingsForm);
      setDashboardSettings(updated);
      closeSettingsModal();
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : "Failed to save settings");
    }
  };

  const submitRuleForm = async () => {
    setRulesError(null);
    try {
      if (scheduleForm.type === "light") {
        const payload: ScheduleRuleCreate = {
          type: "light",
          start_time: scheduleForm.start_time,
          end_time: scheduleForm.use_range ? scheduleForm.end_time || null : null,
          brightness_pct: scheduleForm.brightness_pct,
          enabled: scheduleForm.enabled,
        };
        if (scheduleForm.editingId) {
          await api.updateRule(scheduleForm.editingId, payload);
        } else {
          await api.createRule(payload);
        }
      } else {
        const payload: ScheduleRuleCreate = {
          type: "pump",
          time: scheduleForm.time,
          duration_minutes: scheduleForm.duration_minutes,
          enabled: scheduleForm.enabled,
        };
        if (scheduleForm.editingId) {
          await api.updateRule(scheduleForm.editingId, payload);
        } else {
          await api.createRule(payload);
        }
      }
      await fetchRules();
      closeRuleForm();
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : "Failed to save rule");
    }
  };

  const deleteRuleById = async (id: string) => {
    setRulesError(null);
    try {
      await api.deleteRule(id);
      await fetchRules();
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : "Failed to delete rule");
    }
  };

  const toggleRulePaused = async (r: ScheduleRule) => {
    setRulesError(null);
    try {
      await api.updateRule(r.id, { paused: !r.paused });
      await fetchRules();
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : "Failed to update rule");
    }
  };

  const handleCaptureAndSave = async (device: 0 | 1) => {
    setCaptureSaveLoading(true);
    setPhotosError(null);
    try {
      await api.captureCamera(device, true);
      await fetchCameraPhotos();
    } catch (e) {
      setPhotosError(e instanceof Error ? e.message : "Capture & save failed");
    } finally {
      setCaptureSaveLoading(false);
    }
  };

  const handleDeletePhoto = async (filename: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPhotosError(null);
    try {
      await api.deleteCameraPhoto(filename);
      await fetchCameraPhotos();
    } catch (err) {
      setPhotosError(err instanceof Error ? err.message : "Failed to delete photo");
    }
  };

  const handleDownloadPhoto = async (url: string, filename: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const blob = await fetchWithAuth(`${API_BASE}${url}`);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setPhotosError(err instanceof Error ? err.message : "Download failed");
    }
  };

  if (!token) {
    return <LoginView onLogin={handleLogin} />;
  }

  if (loading && !lastUpdate) {
    return (
      <div className="app">
        <header className="main-header">
          <div className="header-left" aria-hidden />
          <div className="header-center">
            <img src="/images/logo.png" alt="Root Access Granted" className="header-logo" />
          </div>
          <div className="header-right" aria-hidden />
        </header>
        <p className="loading">Connecting to device…</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="main-header">
        <div className="header-left" aria-hidden />
        <div className="header-center">
          <img src="/images/logo.png" alt="Root Access Granted" className="header-logo" />
        </div>
        <div className="header-right" aria-hidden />
      </header>

      {error && (
        <div className="card error" style={{ marginBottom: "1rem" }}>
          <h3>Error</h3>
          <p className="value">{error}</p>
        </div>
      )}

      <div className="refresh-row">
        <button type="button" onClick={fetchAll}>
          Refresh
        </button>
        <button type="button" onClick={openSettingsModal}>
          Settings
        </button>
        {lastUpdate && (
          <span className="last-update">
            Last update: {formatTimeCentralShort(lastUpdate)} CT
          </span>
        )}
        <button type="button" className="logout-btn refresh-row-logout" onClick={handleLogout}>
          Log out
        </button>
      </div>

      <div className="grid grid-gauges">
        <div className="card card-gauge">
          <h3>Water level</h3>
          <RadialGauge
            value={state.distance}
            min={dashboardSettings?.water_level_max ?? 8.5}
            max={dashboardSettings?.water_level_min ?? 13}
            unit="cm"
            label="Water level"
            invertScale
            lowAlert={dashboardSettings?.water_alert_threshold}
            formatValue={(n) => String(Math.round(n * 10) / 10)}
          />
        </div>

        <div className="card card-gauge">
          <h3>Humidity</h3>
          <RadialGauge
            value={state.humidity}
            min={dashboardSettings?.humidity_min ?? 0}
            max={dashboardSettings?.humidity_max ?? 100}
            unit="%"
            label="Humidity"
            lowAlert={dashboardSettings?.humidity_low_alert_threshold}
            highAlert={dashboardSettings?.humidity_high_alert_threshold}
            formatValue={(n) => String(Math.round(n))}
          />
        </div>

        <div className="card card-gauge">
          <h3>Air temperature</h3>
          <RadialGauge
            value={state.temperature != null ? celsiusToF(state.temperature) : null}
            min={dashboardSettings?.air_temp_min ?? 32}
            max={dashboardSettings?.air_temp_max ?? 100}
            unit="°F"
            label="Air temperature"
            lowAlert={dashboardSettings?.air_temp_low_alert_threshold}
            highAlert={dashboardSettings?.air_temp_high_alert_threshold}
          />
        </div>

        <div className="card card-gauge">
          <h3>PCB temperature</h3>
          <RadialGauge
            value={state.pcbTemp != null ? celsiusToF(state.pcbTemp) : null}
            min={dashboardSettings?.pcb_temp_min ?? 75}
            max={dashboardSettings?.pcb_temp_max ?? 130}
            unit="°F"
            label="PCB temperature"
            highAlert={dashboardSettings?.pcb_temp_alert_threshold}
          />
        </div>

        <div className="controls-row">
          <div className="card">
            <h3>Lights</h3>
            <div className="controls">
              <div className="controls-on-off-buttons">
                <button
                  type="button"
                  className={(state.lightBrightness ?? 0) > 0 ? "btn-on" : "btn-on btn--inactive"}
                  onClick={() => runOrShowResumeLight(handleLightOn)}
                >
                  On
                </button>
                <button
                  type="button"
                  className={(state.lightBrightness ?? 0) > 0 ? "btn-off btn--inactive" : "btn-off"}
                  onClick={() => runOrShowResumeLight(handleLightOff)}
                >
                  Off
                </button>
              </div>
              <div className="slider-row">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={lightBrightnessSlider}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    runOrShowResumeLight(() => handleLightBrightness(v));
                  }}
                />
                <span>{lightBrightnessSlider}%</span>
              </div>
            </div>
          </div>
          <div className="controls-row-mascot">
            <img src="/images/mascot.png" alt="" aria-hidden />
          </div>
          <div className="card">
            <h3>Pump</h3>
            <div className="controls">
              <div className="controls-on-off-buttons">
                <button
                  type="button"
                  className={(state.pumpSpeed ?? 0) > 0 ? "btn-on" : "btn-on btn--inactive"}
                  onClick={() => runOrShowResumePump(handlePumpOn)}
                >
                  On
                </button>
                <button
                  type="button"
                  className={(state.pumpSpeed ?? 0) > 0 ? "btn-off btn--inactive" : "btn-off"}
                  onClick={() => runOrShowResumePump(handlePumpOff)}
                >
                  Off
                </button>
              </div>
              <button
                type="button"
                className="schedule-add-btn"
                style={{ marginTop: "0.5rem" }}
                onClick={() => setPumpManualModal({ open: true, minutes: "5" })}
              >
                Manual water
              </button>
              {state.pumpStats?.power != null && (
                <p className="hint">Power: {state.pumpStats.power} W</p>
              )}
            </div>
          </div>
        </div>

        <div className="card schedule-card" style={{ gridColumn: "1 / -1" }}>
          <h3>Schedule</h3>
          <div className="schedule-clock" style={{ marginBottom: "1rem" }}>
            <time dateTime={new Date().toISOString()} className="schedule-clock-time" aria-live="polite">
              {currentTimeCentral}
            </time>
          </div>
          {rulesError && (
            <div className="schedule-error-box">
              <p className="schedule-error-message">{rulesError}</p>
              <button type="button" className="schedule-retry-btn" onClick={() => fetchRules()}>
                Retry
              </button>
            </div>
          )}
          {rulesLoading && rules.length === 0 ? (
            <p className="loading">Loading rules…</p>
          ) : (
            <>
              <div className="schedule-columns">
                <div className="schedule-column">
                  <h4 className="schedule-column-title">Light rules</h4>
                  <div className="schedule-list-wrap">
                    <ul className="schedule-list">
                      {rules.filter((r) => r.type === "light").map((r) => (
                        <li
                          key={r.id}
                          className={`schedule-item${r.paused ? " schedule-item--paused" : ""}`}
                        >
                          <span className="schedule-item-desc">
                            {formatTime12h(r.start_time)}
                            {r.end_time ? ` – ${formatTime12h(r.end_time)}` : ""} → {r.brightness_pct}%
                          </span>
                          {r.enabled === false && <span className="schedule-item-badge">Off</span>}
                          {r.paused && <span className="schedule-item-badge schedule-item-badge--paused">Paused</span>}
                          <div className="schedule-item-actions">
                            <button
                              type="button"
                              className="schedule-pause-btn"
                              onClick={() => toggleRulePaused(r)}
                              title={r.paused ? "Resume" : "Pause"}
                            >
                              {r.paused ? "Resume" : "Pause"}
                            </button>
                            <button type="button" className="schedule-edit-btn" onClick={() => openEditRule(r)}>
                              Edit
                            </button>
                            <button type="button" className="schedule-delete-btn" onClick={() => deleteRuleById(r.id)}>
                              Delete
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {isPausedInFuture(lightRulesPausedUntil) && lightRulesPausedUntil && (
                      <div className="controls-paused-overlay" aria-live="polite">
                        <span>Paused until {formatPausedUntil(lightRulesPausedUntil)}</span>
                      </div>
                    )}
                  </div>
                  <button type="button" className="schedule-add-btn" onClick={() => openNewRule("light")}>
                    + Add light rule
                  </button>
                </div>
                <div className="schedule-column">
                  <h4 className="schedule-column-title">Pump rules</h4>
                  <div className="schedule-list-wrap">
                    <ul className="schedule-list">
                      {rules.filter((r) => r.type === "pump").map((r) => (
                        <li
                          key={r.id}
                          className={`schedule-item${r.paused ? " schedule-item--paused" : ""}`}
                        >
                          <span className="schedule-item-desc">
                            {formatTime12h(r.time)} for {r.duration_minutes} min
                          </span>
                          {r.enabled === false && <span className="schedule-item-badge">Off</span>}
                          {r.paused && <span className="schedule-item-badge schedule-item-badge--paused">Paused</span>}
                          <div className="schedule-item-actions">
                            <button
                              type="button"
                              className="schedule-pause-btn"
                              onClick={() => toggleRulePaused(r)}
                              title={r.paused ? "Resume" : "Pause"}
                            >
                              {r.paused ? "Resume" : "Pause"}
                            </button>
                            <button type="button" className="schedule-edit-btn" onClick={() => openEditRule(r)}>
                              Edit
                            </button>
                            <button type="button" className="schedule-delete-btn" onClick={() => deleteRuleById(r.id)}>
                              Delete
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {isPausedInFuture(pumpRulesPausedUntil) && pumpRulesPausedUntil && (
                      <div className="controls-paused-overlay" aria-live="polite">
                        <span>Paused until {formatPausedUntil(pumpRulesPausedUntil)}</span>
                      </div>
                    )}
                  </div>
                  <button type="button" className="schedule-add-btn" onClick={() => openNewRule("pump")}>
                    + Add pump rule
                  </button>
                </div>
              </div>
              {rules.length === 0 && (
                <p className="hint">No rules yet. Add a light or pump rule above.</p>
              )}
            </>
          )}
        </div>

        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h3>Camera</h3>
          <div className="camera-grid">
            <div className="camera-column">
              <div className="camera-placeholder">
                {cameraUpperError ? (
                  <div>
                    <p>Upper: {cameraUpperError}</p>
                    <button type="button" className="btn-off" style={{ marginTop: "0.5rem" }} onClick={() => { setCameraUpperError(null); refreshCameraUpper(); }}>Try again</button>
                  </div>
                ) : cameraUpperBlobUrl ? (
                  <img
                    src={cameraUpperBlobUrl}
                    alt="Upper camera"
                    onError={() => setCameraUpperError("Failed to load. Add the Pi camera addon (see pi-camera-addon/README.md).")}
                  />
                ) : (
                  <div className="camera-placeholder-loading">Loading…</div>
                )}
                <span className="camera-label">Upper</span>
              </div>
              <div className="camera-row-buttons controls">
                <button
                  type="button"
                  className="btn-on"
                  disabled={captureSaveLoading}
                  onClick={() => handleCaptureAndSave(0)}
                  title="Capture from upper camera and save to Pi (requires CAMERA_PHOTOS_DIR)"
                >
                  {captureSaveLoading ? "Saving…" : "Capture & save"}
                </button>
                <button
                  type="button"
                  className="btn-refresh"
                  onClick={refreshCameraUpper}
                  title="Refresh"
                  aria-label="Refresh"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 2v6h-6" />
                    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                    <path d="M3 22v-6h6" />
                    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="camera-column">
              <div className="camera-placeholder">
                {cameraLowerError ? (
                  <div>
                    <p>Lower: {cameraLowerError}</p>
                    <button type="button" className="btn-off" style={{ marginTop: "0.5rem" }} onClick={() => { setCameraLowerError(null); refreshCameraLower(); }}>Try again</button>
                  </div>
                ) : cameraLowerBlobUrl ? (
                  <img
                    src={cameraLowerBlobUrl}
                    alt="Lower camera"
                    onError={() => setCameraLowerError("Failed to load. Add the Pi camera addon (see pi-camera-addon/README.md).")}
                  />
                ) : (
                  <div className="camera-placeholder-loading">Loading…</div>
                )}
                <span className="camera-label">Lower</span>
              </div>
              <div className="camera-row-buttons controls">
                <button
                  type="button"
                  className="btn-on"
                  disabled={captureSaveLoading}
                  onClick={() => handleCaptureAndSave(1)}
                  title="Capture from lower camera and save to Pi (requires CAMERA_PHOTOS_DIR)"
                >
                  {captureSaveLoading ? "Saving…" : "Capture & save"}
                </button>
                <button
                  type="button"
                  className="btn-refresh"
                  onClick={refreshCameraLower}
                  title="Refresh"
                  aria-label="Refresh"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 2v6h-6" />
                    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                    <path d="M3 22v-6h6" />
                    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
          <div className="camera-saved">
            <h4>Saved photos</h4>
            {photosError && <p className="hint" style={{ color: "var(--warn)" }}>{photosError}</p>}
            {cameraPhotos.length === 0 && !photosError && (
              <p className="hint">No saved photos. Set CAMERA_PHOTOS_DIR on the Pi and use &quot;Capture & save&quot; below.</p>
            )}
            <div className="camera-photos-grid">
              {cameraPhotos.map((p) => (
                <div key={p.filename} className="camera-photo-thumb">
                  <a
                    href={`${API_BASE}${p.url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="camera-photo-thumb-link"
                    title={p.filename}
                  >
                    <AuthImg src={`${API_BASE}${p.url}`} alt="" />
                  </a>
                  <div className="camera-photo-actions">
                    <button
                      type="button"
                      className="camera-photo-download"
                      title="Download photo"
                      aria-label="Download photo"
                      onClick={(e) => handleDownloadPhoto(p.url, p.filename, e)}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="camera-photo-delete"
                      onClick={(e) => handleDeletePhoto(p.filename, e)}
                      title="Delete photo"
                      aria-label="Delete photo"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {scheduleForm.open && (
        <div
          className="modal-overlay"
          onClick={closeRuleForm}
          role="dialog"
          aria-modal="true"
          aria-labelledby="schedule-form-modal-title"
        >
          <div className="schedule-form-modal" onClick={(e) => e.stopPropagation()}>
            <h2 id="schedule-form-modal-title">{scheduleForm.editingId ? "Edit rule" : "New rule"}</h2>
            <p className="hint" style={{ marginBottom: "1rem", fontSize: "0.8rem" }}>
              Enter times in Central Time (same as device).
            </p>
            <div className="schedule-form-row">
              <label>Type</label>
              <select
                value={scheduleForm.type}
                onChange={(e) => setScheduleForm((f) => ({ ...f, type: e.target.value as "light" | "pump" }))}
                disabled={!!scheduleForm.editingId}
              >
                <option value="light">Light</option>
                <option value="pump">Pump</option>
              </select>
            </div>
            {scheduleForm.type === "light" && (
              <>
                <div className="schedule-form-row">
                  <label>Start time (Central)</label>
                  <div className="schedule-form-time-wrap">
                    <input
                      type="time"
                      value={scheduleForm.start_time}
                      onChange={(e) => setScheduleForm((f) => ({ ...f, start_time: e.target.value }))}
                    />
                    <span className="schedule-form-time-12h">{formatTime12h(scheduleForm.start_time)}</span>
                  </div>
                </div>
                <div className="schedule-form-row schedule-form-check">
                  <input
                    type="checkbox"
                    id="use_range"
                    checked={scheduleForm.use_range}
                    onChange={(e) => setScheduleForm((f) => ({ ...f, use_range: e.target.checked }))}
                  />
                  <label htmlFor="use_range">Time range (end time turns light off)</label>
                </div>
                {scheduleForm.use_range && (
                  <div className="schedule-form-row">
                    <label>End time (Central)</label>
                    <div className="schedule-form-time-wrap">
                      <input
                        type="time"
                        value={scheduleForm.end_time}
                        onChange={(e) => setScheduleForm((f) => ({ ...f, end_time: e.target.value }))}
                      />
                      <span className="schedule-form-time-12h">{formatTime12h(scheduleForm.end_time)}</span>
                    </div>
                  </div>
                )}
                <div className="schedule-form-row">
                  <label>Brightness (%) — 0 = off</label>
                  <div className="slider-row">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={scheduleForm.brightness_pct}
                      onChange={(e) => setScheduleForm((f) => ({ ...f, brightness_pct: Number(e.target.value) }))}
                    />
                    <span>{scheduleForm.brightness_pct}%</span>
                  </div>
                </div>
              </>
            )}
            {scheduleForm.type === "pump" && (
              <>
                <div className="schedule-form-row">
                  <label>Time (Central)</label>
                  <div className="schedule-form-time-wrap">
                    <input
                      type="time"
                      value={scheduleForm.time}
                      onChange={(e) => setScheduleForm((f) => ({ ...f, time: e.target.value }))}
                    />
                    <span className="schedule-form-time-12h">{formatTime12h(scheduleForm.time)}</span>
                  </div>
                </div>
                <div className="schedule-form-row">
                  <label>Duration (minutes)</label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={scheduleForm.duration_minutes}
                    onChange={(e) => setScheduleForm((f) => ({ ...f, duration_minutes: Number(e.target.value) || 5 }))}
                  />
                </div>
              </>
            )}
            <div className="schedule-form-row schedule-form-check">
              <input
                type="checkbox"
                id="rule_enabled"
                checked={scheduleForm.enabled}
                onChange={(e) => setScheduleForm((f) => ({ ...f, enabled: e.target.checked }))}
              />
              <label htmlFor="rule_enabled">Enabled</label>
            </div>
            <div className="schedule-form-actions">
              <button type="button" className="schedule-save-btn" onClick={submitRuleForm}>
                {scheduleForm.editingId ? "Save" : "Add rule"}
              </button>
              <button type="button" className="schedule-cancel-btn" onClick={closeRuleForm}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {resumeModal.open && (
        <div
          className="modal-overlay"
          onClick={closeResumeModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="resume-modal-title"
        >
          <div className="override-modal" onClick={(e) => e.stopPropagation()}>
            <h2 id="resume-modal-title">
              {resumeModal.type === "light" ? "Light" : "Pump"} rules are paused
            </h2>
            <p className="hint" style={{ marginBottom: "1rem" }}>
              Paused until {formatPausedUntil(resumeModal.pausedUntil)}. Resume rules now?
            </p>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button type="button" className="btn-on" onClick={() => confirmResumeModal(true)}>
                Resume rules
              </button>
              <button type="button" className="btn-off" onClick={() => confirmResumeModal(false)}>
                Keep paused
              </button>
            </div>
          </div>
        </div>
      )}

      {lightOverrideModal.open && (
        <div className="modal-overlay" onClick={cancelLightOverride} role="dialog" aria-modal="true" aria-labelledby="light-override-modal-title">
          <div className="override-modal" onClick={(e) => e.stopPropagation()}>
            <h2 id="light-override-modal-title">Override light schedule</h2>
            <p className="hint" style={{ marginBottom: "1rem" }}>
              This will override your current light rule. Pause light rules for how many minutes?
            </p>
            <div className="schedule-form-row">
              <label htmlFor="light-override-minutes">Minutes</label>
              <input
                id="light-override-minutes"
                type="number"
                min={1}
                max={1440}
                value={lightOverrideModal.minutes}
                onChange={(e) => setLightOverrideModal((m) => ({ ...m, minutes: e.target.value }))}
              />
            </div>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button type="button" className="btn-on" onClick={confirmLightOverride}>
                Override for {lightOverrideModal.minutes || "0"} min
              </button>
              <button type="button" className="btn-off" onClick={cancelLightOverride}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {pumpManualModal.open && (
        <div className="modal-overlay" onClick={cancelPumpManual} role="dialog" aria-modal="true" aria-labelledby="pump-manual-modal-title">
          <div className="override-modal" onClick={(e) => e.stopPropagation()}>
            <h2 id="pump-manual-modal-title">Manual watering</h2>
            <p className="hint" style={{ marginBottom: "1rem" }}>
              Pause all pump rules and run the pump for how many minutes?
            </p>
            <div className="schedule-form-row">
              <label htmlFor="pump-manual-minutes">Minutes</label>
              <input
                id="pump-manual-minutes"
                type="number"
                min={1}
                max={120}
                value={pumpManualModal.minutes}
                onChange={(e) => setPumpManualModal((m) => ({ ...m, minutes: e.target.value }))}
              />
            </div>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button type="button" className="btn-on" onClick={confirmPumpManual}>
                Water for {pumpManualModal.minutes || "0"} min
              </button>
              <button type="button" className="btn-off" onClick={cancelPumpManual}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-overlay" onClick={closeSettingsModal} role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <h2 id="settings-modal-title">Settings</h2>
            <p className="hint" style={{ marginBottom: "1rem", fontSize: "0.8rem" }}>
              Gauge ranges and alert thresholds. Used for gauges and alerts (coming soon).
            </p>
            {settingsLoading && <p className="loading">Loading settings…</p>}
            {settingsError && <p className="hint" style={{ color: "var(--danger)", marginBottom: "1rem" }}>{settingsError}</p>}
            {settingsForm && !settingsLoading && (
              <div className="settings-form">
                <div className="settings-form-grid">
                <section className="settings-section">
                  <div className="settings-section-header">
                    <h4>Water level (cm)</h4>
                    <label className="settings-enable-alerts">
                      <input type="checkbox" id="water_level_alerts" checked={settingsForm.water_level_alerts_enabled} onChange={(e) => setSettingsForm((f) => f && { ...f, water_level_alerts_enabled: e.target.checked })} />
                      Enable alerts
                    </label>
                  </div>
                  <div className="settings-form-row-duo">
                    <div className="settings-field">
                      <label>Min</label>
                      <input type="number" step="any" value={settingsForm.water_level_min} onChange={(e) => setSettingsForm((f) => f && { ...f, water_level_min: Number(e.target.value) || 0 })} />
                    </div>
                    <div className="settings-field">
                      <label>Max</label>
                      <input type="number" step="any" value={settingsForm.water_level_max} onChange={(e) => setSettingsForm((f) => f && { ...f, water_level_max: Number(e.target.value) || 0 })} />
                    </div>
                  </div>
                  <div className="settings-form-row">
                    <label>Low alert</label>
                    <input type="number" step="any" value={settingsForm.water_alert_threshold} onChange={(e) => setSettingsForm((f) => f && { ...f, water_alert_threshold: Number(e.target.value) || 0 })} />
                  </div>
                </section>
                <section className="settings-section">
                  <div className="settings-section-header">
                    <h4>Air temperature (°F)</h4>
                    <label className="settings-enable-alerts">
                      <input type="checkbox" id="air_temp_alerts" checked={settingsForm.air_temp_alerts_enabled} onChange={(e) => setSettingsForm((f) => f && { ...f, air_temp_alerts_enabled: e.target.checked })} />
                      Enable alerts
                    </label>
                  </div>
                  <div className="settings-form-row-duo">
                    <div className="settings-field">
                      <label>Min</label>
                      <input type="number" step="any" value={settingsForm.air_temp_min} onChange={(e) => setSettingsForm((f) => f && { ...f, air_temp_min: Number(e.target.value) || 0 })} />
                    </div>
                    <div className="settings-field">
                      <label>Max</label>
                      <input type="number" step="any" value={settingsForm.air_temp_max} onChange={(e) => setSettingsForm((f) => f && { ...f, air_temp_max: Number(e.target.value) || 0 })} />
                    </div>
                  </div>
                  <div className="settings-form-row-duo">
                    <div className="settings-field">
                      <label>High alert</label>
                      <input type="number" step="any" value={settingsForm.air_temp_high_alert_threshold} onChange={(e) => setSettingsForm((f) => f && { ...f, air_temp_high_alert_threshold: Number(e.target.value) || 0 })} />
                    </div>
                    <div className="settings-field">
                      <label>Low alert</label>
                      <input type="number" step="any" value={settingsForm.air_temp_low_alert_threshold} onChange={(e) => setSettingsForm((f) => f && { ...f, air_temp_low_alert_threshold: Number(e.target.value) || 0 })} />
                    </div>
                  </div>
                </section>
                <section className="settings-section">
                  <div className="settings-section-header">
                    <h4>Humidity (%)</h4>
                    <label className="settings-enable-alerts">
                      <input type="checkbox" id="humidity_alerts" checked={settingsForm.humidity_alerts_enabled} onChange={(e) => setSettingsForm((f) => f && { ...f, humidity_alerts_enabled: e.target.checked })} />
                      Enable alerts
                    </label>
                  </div>
                  <div className="settings-form-row-duo">
                    <div className="settings-field">
                      <label>Min</label>
                      <input type="number" step="any" value={settingsForm.humidity_min} onChange={(e) => setSettingsForm((f) => f && { ...f, humidity_min: Number(e.target.value) || 0 })} />
                    </div>
                    <div className="settings-field">
                      <label>Max</label>
                      <input type="number" step="any" value={settingsForm.humidity_max} onChange={(e) => setSettingsForm((f) => f && { ...f, humidity_max: Number(e.target.value) || 0 })} />
                    </div>
                  </div>
                  <div className="settings-form-row-duo">
                    <div className="settings-field">
                      <label>Low alert</label>
                      <input type="number" step="any" value={settingsForm.humidity_low_alert_threshold} onChange={(e) => setSettingsForm((f) => f && { ...f, humidity_low_alert_threshold: Number(e.target.value) || 0 })} />
                    </div>
                    <div className="settings-field">
                      <label>High alert</label>
                      <input type="number" step="any" value={settingsForm.humidity_high_alert_threshold} onChange={(e) => setSettingsForm((f) => f && { ...f, humidity_high_alert_threshold: Number(e.target.value) || 0 })} />
                    </div>
                  </div>
                </section>
                <section className="settings-section">
                  <div className="settings-section-header">
                    <h4>PCB temperature (°F)</h4>
                    <label className="settings-enable-alerts">
                      <input type="checkbox" id="pcb_temp_alerts" checked={settingsForm.pcb_temp_alerts_enabled} onChange={(e) => setSettingsForm((f) => f && { ...f, pcb_temp_alerts_enabled: e.target.checked })} />
                      Enable alerts
                    </label>
                  </div>
                  <div className="settings-form-row-duo">
                    <div className="settings-field">
                      <label>Min</label>
                      <input type="number" step="any" value={settingsForm.pcb_temp_min} onChange={(e) => setSettingsForm((f) => f && { ...f, pcb_temp_min: Number(e.target.value) || 0 })} />
                    </div>
                    <div className="settings-field">
                      <label>Max</label>
                      <input type="number" step="any" value={settingsForm.pcb_temp_max} onChange={(e) => setSettingsForm((f) => f && { ...f, pcb_temp_max: Number(e.target.value) || 0 })} />
                    </div>
                  </div>
                  <div className="settings-form-row">
                    <label>High alert</label>
                    <input type="number" step="any" value={settingsForm.pcb_temp_alert_threshold} onChange={(e) => setSettingsForm((f) => f && { ...f, pcb_temp_alert_threshold: Number(e.target.value) || 0 })} />
                  </div>
                </section>
                </div>
                <div className="settings-form-actions">
                  <button type="button" className="schedule-save-btn" onClick={saveSettings}>Save</button>
                  <button type="button" className="schedule-cancel-btn" onClick={closeSettingsModal}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
