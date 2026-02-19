import { useId } from "react";

export type RadialGaugeProps = {
  value: number | null;
  min: number;
  max: number;
  unit: string;
  label: string;
  /** When true, scale is flipped: higher values on the left, needle and gradient adjusted */
  invertScale?: boolean;
  /** Low alert: values below this are danger (e.g. water: values above this = low water = danger) */
  lowAlert?: number;
  /** High alert: values above this are danger */
  highAlert?: number;
  /** Format value for display (e.g. 1 decimal) */
  formatValue?: (n: number) => string;
};

const SAFE_COLOR = "var(--accent)"; // #4ade80 green
const DANGER_COLOR = "var(--danger)"; // #f87171 red
const COLD_COLOR = "#60a5fa"; // blue for low temp/humidity

export function RadialGauge({
  value,
  min,
  max,
  unit,
  label,
  invertScale = false,
  lowAlert,
  highAlert,
  formatValue = (n) => String(Math.round(n * 10) / 10),
}: RadialGaugeProps) {
  const gradientId = useId().replace(/:/g, "");
  const filterId = useId().replace(/:/g, "");
  const range = max - min;
  if (range <= 0) return null;

  // Pivot at bottom, arc = top semicircle (sweeps above pivot). Needle points up into arc.
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  let valueNorm = value != null ? (clamp(value) - min) / range : 0.5;
  if (invertScale) valueNorm = 1 - valueNorm; // higher value -> left
  const needleAngleDeg = 180 - 180 * valueNorm; // 180° left, 90° top, 0° right
  const needleAngleRad = (needleAngleDeg * Math.PI) / 180;

  // Gradient stops: safe (green) to danger (red). Optional low/high alerts for three-zone.
  const hasThreeZones = lowAlert != null && highAlert != null;
  const singleAlert = highAlert ?? lowAlert;

  // Transition width as % of scale for smooth color blending
  const transitionPct = 30;
  let gradientStops: { offset: number; color: string }[];
  if (hasThreeZones && lowAlert != null && highAlert != null) {
    const lowPct = ((lowAlert - min) / range) * 100;
    const highPct = ((highAlert - min) / range) * 100;
    const safeZoneWidth = highPct - lowPct;
    // Cap transition so the two blend zones don't overlap (keeps stops in ascending order)
    const transition = Math.min(transitionPct, Math.max(0, safeZoneWidth) / 2);
    gradientStops = [
      { offset: 0, color: COLD_COLOR },
      { offset: Math.min(lowPct, 100), color: COLD_COLOR },
      { offset: Math.min(lowPct + transition, 100), color: SAFE_COLOR },
      { offset: Math.max(highPct - transition, 0), color: SAFE_COLOR },
      { offset: Math.min(highPct, 100), color: DANGER_COLOR },
      { offset: 100, color: DANGER_COLOR },
    ];
  } else if (singleAlert != null) {
    // Two-zone: safe from min to alert, danger from alert to max (water low alert, PCB high alert)
    const alertPct = ((singleAlert - min) / range) * 100;
    gradientStops = [
      { offset: 0, color: SAFE_COLOR },
      { offset: Math.min(alertPct, 100), color: SAFE_COLOR },
      { offset: Math.min(alertPct + transitionPct, 100), color: DANGER_COLOR },
      { offset: 100, color: DANGER_COLOR },
    ];
  } else {
    gradientStops = [
      { offset: 0, color: SAFE_COLOR },
      { offset: 100, color: DANGER_COLOR },
    ];
  }

  const cx = 100;
  const cy = 112;
  const radius = 72;
  const strokeWidth = 14;
  const startAngle = 180;
  const endAngle = 0;
  const startRad = (startAngle * Math.PI) / 180;
  const endRad = (endAngle * Math.PI) / 180;
  const x1 = cx + radius * Math.cos(startRad);
  const y1 = cy - radius * Math.sin(startRad);
  const x2 = cx + radius * Math.cos(endRad);
  const y2 = cy - radius * Math.sin(endRad);
  const largeArc = startAngle - endAngle >= 180 ? 1 : 0;
  const arcD = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`; // sweep 1 = clockwise = top semicircle (through 270°)

  const needleLength = 62;
  const needleTipX = cx + needleLength * Math.cos(needleAngleRad);
  const needleTipY = cy - needleLength * Math.sin(needleAngleRad);

  return (
    <div className="radial-gauge" aria-label={`${label}: ${value != null ? formatValue(value) : "—"} ${unit}`}>
      <svg
        className="radial-gauge-svg"
        viewBox="0 0 200 140"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient
            id={gradientId}
            x1={invertScale ? "100%" : "0%"}
            y1="0%"
            x2={invertScale ? "0%" : "100%"}
            y2="0%"
          >
            {gradientStops.map((s, i) => (
              <stop key={i} offset={`${s.offset}%`} stopColor={s.color} />
            ))}
          </linearGradient>
          <filter id={filterId} x="-30%" y="-30%" width="160%" height="160%" filterUnits="objectBoundingBox">
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* Arc track (background) */}
        <path
          d={arcD}
          fill="none"
          stroke="var(--border)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Colored arc with glow */}
        <path
          d={arcD}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          filter={`url(#${filterId})`}
        />
        {/* Needle */}
        {value != null && (
          <g className="radial-gauge-needle">
            <line
              x1={cx}
              y1={cy}
              x2={needleTipX}
              y2={needleTipY}
              stroke="var(--text)"
              strokeWidth={3}
              strokeLinecap="round"
            />
            <circle cx={cx} cy={cy} r={5} fill="var(--surface2)" stroke="var(--text)" strokeWidth={1.5} />
          </g>
        )}
      </svg>
      <div className="radial-gauge-scale-labels">
        <span className="radial-gauge-min">{formatValue(invertScale ? max : min)}</span>
        <span className="radial-gauge-max">{formatValue(invertScale ? min : max)}</span>
      </div>
      <div className="radial-gauge-value">
        {value != null ? (
          <>
            <span className="radial-gauge-number">{formatValue(value)}</span>
            <span className="radial-gauge-unit">{unit}</span>
          </>
        ) : (
          <span className="radial-gauge-empty">—</span>
        )}
      </div>
    </div>
  );
}
