const _apiUrl = (import.meta.env.VITE_GARDYN_API_URL ?? "").trim();
if (!_apiUrl) {
  throw new Error(
    "VITE_GARDYN_API_URL is not set. Add it to your .env file (see .env.example)."
  );
}
const API_BASE = _apiUrl;

let getToken: (() => string | null) | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthCallbacks(
  tokenGetter: () => string | null,
  unauthorizedCb: () => void
) {
  getToken = tokenGetter;
  onUnauthorized = unauthorizedCb;
}

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  const token = getToken?.() ?? null;
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    onUnauthorized?.();
    const text = await res.text();
    throw new Error(`API 401: ${text || "Unauthorized"}`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204 || res.headers.get("content-length") === "0")
    return undefined as T;
  return res.json() as Promise<T>;
}

/**
 * Fetch a URL with the current auth token (e.g. for camera images). Returns a Blob.
 * Call URL.createObjectURL(blob) for use in <img src>. Revoke the URL when done.
 */
export async function fetchWithAuth(url: string): Promise<Blob> {
  const token = getToken?.();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) {
    onUnauthorized?.();
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.blob();
}

// API returns some values as strings (e.g. "45.00")
function num(v: unknown): number | null {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

export type AppSettings = {
  water_level_min: number;
  water_level_max: number;
  water_alert_threshold: number;
  air_temp_min: number;
  air_temp_max: number;
  air_temp_high_alert_threshold: number;
  air_temp_low_alert_threshold: number;
  humidity_min: number;
  humidity_max: number;
  humidity_low_alert_threshold: number;
  humidity_high_alert_threshold: number;
  pcb_temp_min: number;
  pcb_temp_max: number;
  pcb_temp_alert_threshold: number;
  water_level_alerts_enabled: boolean;
  humidity_alerts_enabled: boolean;
  air_temp_alerts_enabled: boolean;
  pcb_temp_alerts_enabled: boolean;
  slack_webhook_url: string | null;
  slack_cooldown_minutes: number;
  slack_notifications_enabled: boolean;
  slack_runtime_errors_enabled: boolean;
  plant_of_the_day_slack_time: string;
};

export const api = {
  getDistance: () => request<{ distance: number }>("/distance"),
  getHumidity: () => request<{ humidity?: string | number }>("/humidity").then((r) => ({ humidity: num(r.humidity) })),
  getTemperature: () => request<{ temperature?: string | number }>("/temperature").then((r) => ({ temperature: num(r.temperature) })),
  getPcbTemp: () =>
    request<{ "pcb-temp"?: string | number }>("/pcb-temp").then((r) => ({ pcb_temp: num(r["pcb-temp"]) })),
  getLightBrightness: () => request<{ value?: number }>("/light/brightness"),
  lightOn: () => request<{ message?: string }>("/light/on", { method: "POST" }),
  lightOff: () => request<{ message?: string }>("/light/off", { method: "POST" }),
  setLightBrightness: (value: number) =>
    request<{ message?: string }>("/light/brightness", {
      method: "POST",
      body: JSON.stringify({ value }),
    }),
  getPumpSpeed: () => request<{ value?: number }>("/pump/speed"),
  getPumpStats: () => request<PumpStats>("/pump/stats"),
  pumpOn: () => request<{ message?: string }>("/pump/on", { method: "POST" }),
  pumpOff: () => request<{ message?: string }>("/pump/off", { method: "POST" }),
  setPumpSpeed: (value: number) =>
    request<{ message?: string }>("/pump/speed", {
      method: "POST",
      body: JSON.stringify({ value }),
    }),

  // Camera (dev-branch API)
  getCameraDevices: () =>
    request<{ devices: { id: number; device: string; name: string }[] }>("/camera/devices"),
  captureCamera: async (device: 0 | 1 | "upper" | "lower" = 0, save = false) => {
    const token = getToken?.() ?? null;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/camera/capture`, {
      method: "POST",
      headers,
      body: JSON.stringify({ device: device === "upper" ? 0 : device === "lower" ? 1 : device, save }),
    });
    if (res.status === 401) {
      onUnauthorized?.();
      const t = await res.text();
      throw new Error(`API 401: ${t || "Unauthorized"}`);
    }
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`API ${res.status}: ${t || res.statusText}`);
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return res.json() as Promise<{ message?: string; filename?: string; url?: string }>;
    return res.blob();
  },
  getCameraPhotos: () =>
    request<{ photos: { filename: string; url: string }[]; message?: string }>("/camera/photos"),
  deleteCameraPhoto: (filename: string) =>
    request<void>(`/camera/photos/${encodeURIComponent(filename)}`, { method: "DELETE" }),

  // Schedule rules (includes server-side pause-until for overlay)
  getRules: () =>
    request<{
      rules: ScheduleRule[];
      light_rules_paused_until?: string | null;
      pump_rules_paused_until?: string | null;
    }>("/schedule/rules"),
  getRule: (id: string) =>
    request<ScheduleRule>(`/schedule/rules/${id}`),
  createRule: (rule: ScheduleRuleCreate) =>
    request<ScheduleRule>("/schedule/rules", {
      method: "POST",
      body: JSON.stringify(rule),
    }),
  updateRule: (id: string, updates: Partial<ScheduleRuleCreate>) =>
    request<ScheduleRule>(`/schedule/rules/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    }),
  deleteRule: (id: string) =>
    request<void>(`/schedule/rules/${id}`, { method: "DELETE" }),

  /** Pause all light rules for N minutes (server-side; scheduler skips until then). */
  pauseLightRulesForMinutes: (minutes: number) =>
    request<void>("/schedule/rules/pause-light-rules", {
      method: "POST",
      body: JSON.stringify({ minutes }),
    }),
  /** Pause all pump rules for N minutes (server-side). */
  pausePumpRulesForMinutes: (minutes: number) =>
    request<void>("/schedule/rules/pause-pump-rules", {
      method: "POST",
      body: JSON.stringify({ minutes }),
    }),
  /** Schedule pump to turn off in N minutes (scheduler turns it off). */
  setManualPumpOffInMinutes: (minutes: number) =>
    request<void>("/schedule/rules/manual-pump-off", {
      method: "POST",
      body: JSON.stringify({ minutes }),
    }),
  /** Clear light rules pause (resume rules now). */
  resumeLightRules: () =>
    request<void>("/schedule/rules/resume-light-rules", { method: "POST" }),
  /** Clear pump rules pause (resume rules now). */
  resumePumpRules: () =>
    request<void>("/schedule/rules/resume-pump-rules", { method: "POST" }),

  // App settings (gauge/alert thresholds and alert toggles)
  getSettings: () => request<AppSettings>("/settings"),
  updateSettings: (settings: Partial<AppSettings>) =>
    request<AppSettings>("/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  /** Send a test Slack message. Optional webhook_url in body to test before saving. */
  testSlack: (webhookUrl?: string | null) =>
    request<{ message?: string }>("/settings/test-slack", {
      method: "POST",
      body: JSON.stringify(webhookUrl ? { webhook_url: webhookUrl } : {}),
    }),

  /** Plant of the day (Perenual API). 404 if none set. */
  getPlantOfTheDay: () =>
    request<PlantOfTheDay>("/plant-of-the-day"),

  /** Historical sensor readings. range: day | week | month | year */
  getHistoryReadings: (metrics: string[], range: HistoryRange) =>
    request<{ data: HistoryReadingPoint[] }>(
      `/history/readings?metrics=${encodeURIComponent(metrics.join(","))}&range=${encodeURIComponent(range)}`
    ),
  /** Pump on/off events for history. */
  getHistoryPumpEvents: (range: HistoryRange) =>
    request<{ events: PumpEventRecord[] }>(
      `/history/pump-events?range=${encodeURIComponent(range)}`
    ),

  /** Backup: run full backup to MongoDB (with audit). */
  backupRun: () =>
    request<{ success: boolean; message: string; created_at?: string; audit?: { ok: boolean; message: string; details: Record<string, unknown> } }>(
      "/backup/run",
      { method: "POST" }
    ),
  /** Backup: restore from MongoDB (overwrites local DB and files). */
  backupRestore: () =>
    request<{ success: boolean; message: string; backup_created_at?: string }>(
      "/backup/restore",
      { method: "POST" }
    ),
  /** Backup: get status (last backup time). */
  getBackupStatus: () =>
    request<{ available: boolean; created_at?: string; last_incremental_at?: string; message?: string }>(
      "/backup/status"
    ),
};

export type HistoryRange = "day" | "week" | "month" | "year";

export type HistoryReadingPoint = {
  created_at: string;
  water_level?: number;
  humidity?: number;
  air_temp?: number;
  pcb_temp?: number;
  light_percentage?: number;
};

export type PumpEventRecord = {
  created_at: string;
  is_on: boolean;
  trigger: string;
  rule_id: string | null;
};

export type PlantOfTheDay = {
  id?: number;
  common_name?: string;
  genus?: string;
  species_epithet?: string;
  /** Server-computed Wikipedia URL (genus + epithet); use this when present. */
  wikipedia_url?: string;
  scientific_name?: string[];
  description?: string;
  type?: string;
  cycle?: string;
  watering?: string;
  watering_general_benchmark?: { value?: string; unit?: string };
  sunlight?: string[];
  propagation?: string[];
  hardiness?: { min?: string; max?: string };
  origin?: string[];
  dimensions?: { min_value?: number; max_value?: number; unit?: string }[];
  maintenance?: string;
  care_level?: string;
  growth_rate?: string;
  default_image?: {
    thumbnail?: string;
    small_url?: string;
    regular_url?: string;
    medium_url?: string;
    original_url?: string;
  };
  care_guides?: string;
};

export type LightRule = {
  type: "light";
  id?: string;
  enabled?: boolean;
  paused?: boolean;
  start_time: string;
  end_time: string | null;
  brightness_pct: number;
};

export type PumpRule = {
  type: "pump";
  id?: string;
  enabled?: boolean;
  paused?: boolean;
  time: string;
  duration_minutes: number;
};

export type ScheduleRule = (LightRule | PumpRule) & { id: string };

export type ScheduleRuleCreate =
  | Omit<LightRule, "id">
  | Omit<PumpRule, "id">;

export type PumpStats = {
  speed?: number;
  power?: number;
  [key: string]: unknown;
};

export { API_BASE };
