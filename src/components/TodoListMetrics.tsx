import {
  useWatchMetricsState,
  useMetricsActions,
  type WatchMetrics,
} from "../stores/metricsStore";

interface TodoListMetricsProps {
  watchId: string;
  title: string;
}

export function TodoListMetrics({ watchId, title }: TodoListMetricsProps) {
  const metrics = useWatchMetricsState(watchId);
  const { resetWatchMetrics } = useMetricsActions();

  return (
    <div
      style={{
        padding: "12px",
        backgroundColor: "#1e1e1e",
        borderRadius: "4px",
        border: "1px solid #333",
        marginBottom: "12px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>
          {title}
        </h3>
        <button
          onClick={() => resetWatchMetrics(watchId)}
          style={{
            padding: "3px 8px",
            fontSize: "11px",
            cursor: "pointer",
            backgroundColor: "transparent",
            border: "1px solid #555",
            borderRadius: "3px",
            color: "#888",
          }}
        >
          Reset
        </button>
      </div>

      <MetricsGrid metrics={metrics} />

      <LatencySection metrics={metrics} />
    </div>
  );
}

function MetricsGrid({ metrics }: { metrics: WatchMetrics }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: "6px 16px",
        fontSize: "12px",
      }}
    >
      <MetricRow label="Renders" value={metrics.renderCount} />
      <MetricRow label="Item Renders" value={metrics.totalItemRenders} />
      <MetricRow label="Queries" value={metrics.queryCount} />
      <MetricRow label="Emissions" value={metrics.emissionCount} />
      <MetricRow label="Triggers" value={metrics.triggerFireCount} />
    </div>
  );
}

function LatencySection({ metrics }: { metrics: WatchMetrics }) {
  const fmt = (v: number | null) => v !== null ? `${v.toFixed(1)}ms` : "—";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: "6px 16px",
        fontSize: "11px",
        color: "#888",
        paddingTop: "8px",
        borderTop: "1px solid #333",
      }}
    >
      <span>Avg <span style={{ color: "#4caf50", marginLeft: "0.5rem" }}>{fmt(metrics.averageLatency)}</span></span>
      <span>Last <span style={{ color: "#2196f3", marginLeft: "0.5rem" }}>{fmt(metrics.lastQueryLatency)}</span></span>
      <span>Low <span style={{ color: "#ff9800", marginLeft: "0.5rem" }}>{fmt(metrics.lowestLatency)}</span></span>
      <span>Median <span style={{ color: "#9c27b0", marginLeft: "0.5rem" }}>{fmt(metrics.medianLatency)}</span></span>
    </div>
  );
}

function MetricRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string | number;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
      }}
    >
      <span style={{ color: "#777" }}>{label}</span>
      <span
        style={{
          fontWeight: 500,
          fontVariantNumeric: "tabular-nums",
          color: valueColor ?? "rgba(255, 255, 255, 0.9)",
        }}
      >
        {value}
      </span>
    </div>
  );
}
