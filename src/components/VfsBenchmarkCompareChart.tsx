import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip,
  type TooltipItem,
  type ChartOptions,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import {
  type BenchmarkInstanceState,
  type BenchmarkResult,
} from "../hooks/useVfsBenchmark";
import { type VFSConfig } from "../vfsConfig";

ChartJS.register(BarElement, CategoryScale, LinearScale, Legend, Tooltip);

interface VfsBenchmarkCompareChartProps {
  states: Map<string, BenchmarkInstanceState>;
  vfsConfigs: VFSConfig[];
}

interface DoneEntry {
  cfg: VFSConfig;
  result: BenchmarkResult;
}

function shortLabel(label: string) {
  return label.replace(/VFS$/, "");
}

function fmt(v: number | null | undefined, decimals = 2): string {
  if (v == null || Number.isNaN(v)) return "–";
  return v.toFixed(decimals);
}

function fmtInt(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "–";
  return Math.round(v).toLocaleString();
}

function pct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "–";
  return `${v.toFixed(0)}%`;
}

const DARK_GRID = "#2a2a2a";
const TICK_COLOR = "#9aa0a6";
const TICK_FONT = { size: 11 as const };
const LABEL_FONT = { size: 12 as const };

const COLORS = {
  singleWrites: "#42a5f5",
  txWrites: "#7e57c2",
  reads: "#66bb6a",
  median: "#90caf9",
  p95: "#ffb74d",
  readRetention: "#66bb6a",
  writeRetention: "#ab47bc",
  latencyRetention: "#ef5350",
};

function buildOptions(
  xTitle: string,
  tooltipLabel: (ctx: TooltipItem<"bar">) => string,
): ChartOptions<"bar"> {
  return {
    indexAxis: "y",
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: {
        labels: {
          color: TICK_COLOR,
          font: LABEL_FONT,
          usePointStyle: true,
          boxWidth: 10,
          boxHeight: 10,
        },
      },
      tooltip: {
        callbacks: {
          label: tooltipLabel,
        },
      },
    },
    scales: {
      x: {
        title: {
          display: true,
          text: xTitle,
          color: TICK_COLOR,
          font: TICK_FONT,
        },
        ticks: {
          color: TICK_COLOR,
          font: TICK_FONT,
        },
        grid: { color: DARK_GRID },
        beginAtZero: true,
      },
      y: {
        ticks: {
          color: TICK_COLOR,
          font: TICK_FONT,
        },
        grid: { display: false },
      },
    },
  };
}

function sectionHeight(rows: number) {
  return Math.max(150, rows * 62);
}

function safeRatio(numerator: number | null | undefined, denominator: number | null | undefined) {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  return (numerator / denominator) * 100;
}

function ThroughputOverviewChart({ entries }: { entries: DoneEntry[] }) {
  const labels = entries.map((e) => shortLabel(e.cfg.label));

  const data = {
    labels,
    datasets: [
      {
        label: "Single writes",
        data: entries.map((e) => e.result.singleWrites.rowsPerSec),
        backgroundColor: COLORS.singleWrites,
      },
      {
        label: `Transaction writes (${entries[0]?.result.config.txBatchSize ?? 0} rows/tx)`,
        data: entries.map((e) => e.result.txWrites.rowsPerSec),
        backgroundColor: COLORS.txWrites,
      },
      {
        label: "Reads",
        data: entries.map((e) => e.result.reads.rowsPerSec),
        backgroundColor: COLORS.reads,
      },
    ],
  };

  const options = buildOptions("Throughput (ops/s)", (ctx) => {
    const entry = entries[ctx.dataIndex];
    if (ctx.datasetIndex === 0) {
      return `${ctx.dataset.label}: ${fmtInt(ctx.parsed.x)} ops/s (median ${fmt(entry.result.singleWrites.median)} ms, p95 ${fmt(entry.result.singleWrites.p95)} ms)`;
    }
    if (ctx.datasetIndex === 1) {
      return `${ctx.dataset.label}: ${fmtInt(ctx.parsed.x)} ops/s (${fmtInt(entry.result.txWrites.txCount)} txns, median ${fmt(entry.result.txWrites.txMedian)} ms, p95 ${fmt(entry.result.txWrites.txP95)} ms)`;
    }
    return `${ctx.dataset.label}: ${fmtInt(ctx.parsed.x)} ops/s (median ${fmt(entry.result.reads.median)} ms, p95 ${fmt(entry.result.reads.p95)} ms)`;
  });

  return (
    <div className="bench-chart-section">
      <h3 className="bench-chart-title">Throughput Overview</h3>
      <p className="bench-chart-desc">
        Compares isolated throughput for single writes, transaction writes, and reads. VFS rows use the same order in
        every chart.
      </p>
      <div className="bench-chart-area" style={{ height: sectionHeight(entries.length) }}>
        <Bar data={data} options={options} />
      </div>
    </div>
  );
}

function LatencyChart({
  entries,
  title,
  description,
  axisTitle,
  getMedian,
  getP95,
  getMax,
}: {
  entries: DoneEntry[];
  title: string;
  description: string;
  axisTitle: string;
  getMedian: (entry: DoneEntry) => number | null | undefined;
  getP95: (entry: DoneEntry) => number | null | undefined;
  getMax: (entry: DoneEntry) => number | null | undefined;
}) {
  const labels = entries.map((e) => shortLabel(e.cfg.label));

  const data = {
    labels,
    datasets: [
      {
        label: "Median",
        data: entries.map((e) => getMedian(e) ?? null),
        backgroundColor: COLORS.median,
      },
      {
        label: "p95",
        data: entries.map((e) => getP95(e) ?? null),
        backgroundColor: COLORS.p95,
      },
    ],
  };

  const options = buildOptions(axisTitle, (ctx) => {
    const entry = entries[ctx.dataIndex];
    return `${ctx.dataset.label}: ${fmt(ctx.parsed.x)} ms (max ${fmt(getMax(entry))} ms)`;
  });

  return (
    <div className="bench-chart-section">
      <h3 className="bench-chart-title">{title}</h3>
      <p className="bench-chart-desc">{description}</p>
      <div className="bench-chart-area" style={{ height: sectionHeight(entries.length) }}>
        <Bar data={data} options={options} />
      </div>
    </div>
  );
}

function SerializedMixRetentionChart({ entries }: { entries: DoneEntry[] }) {
  const labels = entries.map((e) => shortLabel(e.cfg.label));

  const data = {
    labels,
    datasets: [
      {
        label: "Read throughput vs isolated",
        data: entries.map((e) =>
          safeRatio(e.result.interleaved.readRowsPerSec, e.result.reads.rowsPerSec),
        ),
        backgroundColor: COLORS.readRetention,
      },
      {
        label: "Write throughput vs isolated",
        data: entries.map((e) =>
          safeRatio(e.result.interleaved.writeRowsPerSec, e.result.singleWrites.rowsPerSec),
        ),
        backgroundColor: COLORS.writeRetention,
      },
      {
        label: "Read median vs isolated",
        data: entries.map((e) =>
          safeRatio(e.result.reads.median, e.result.interleaved.readMedian),
        ),
        backgroundColor: COLORS.latencyRetention,
      },
    ],
  };

  const options = buildOptions("Retention vs isolated baseline (%)", (ctx) => {
    const entry = entries[ctx.dataIndex];
    if (ctx.datasetIndex === 0) {
      return `${ctx.dataset.label}: ${pct(ctx.parsed.x)} (${fmtInt(entry.result.interleaved.readRowsPerSec)} vs ${fmtInt(entry.result.reads.rowsPerSec)} ops/s)`;
    }
    if (ctx.datasetIndex === 1) {
      return `${ctx.dataset.label}: ${pct(ctx.parsed.x)} (${fmtInt(entry.result.interleaved.writeRowsPerSec)} vs ${fmtInt(entry.result.singleWrites.rowsPerSec)} ops/s)`;
    }
    return `${ctx.dataset.label}: ${pct(ctx.parsed.x)} (${fmt(entry.result.interleaved.readMedian)} ms vs ${fmt(entry.result.reads.median)} ms median)`;
  });

  return (
    <div className="bench-chart-section">
      <h3 className="bench-chart-title">Serialized Mix vs Isolated Baseline</h3>
      <p className="bench-chart-desc">
        Compares interleaved read throughput to isolated reads, interleaved write throughput to isolated single writes,
        and interleaved read median to isolated read median. VFS rows use the same order in every chart. 100% means
        unchanged from the isolated phase.
      </p>
      <div className="bench-chart-area" style={{ height: sectionHeight(entries.length) }}>
        <Bar data={data} options={options} />
      </div>
    </div>
  );
}

export function VfsBenchmarkCompareChart({
  states,
  vfsConfigs,
}: VfsBenchmarkCompareChartProps) {
  const entries: DoneEntry[] = vfsConfigs
    .filter((cfg) => states.get(cfg.id)?.status === "done")
    .map((cfg) => ({ cfg, result: states.get(cfg.id)!.result! }));

  const runningCount = vfsConfigs.filter(
    (cfg) => states.get(cfg.id)?.status === "running",
  ).length;
  const errorCount = vfsConfigs.filter(
    (cfg) => states.get(cfg.id)?.status === "error",
  ).length;

  if (entries.length === 0) {
    return (
      <div
        className="bench-compare-charts"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 200,
        }}
      >
        <p style={{ color: "#555", fontSize: 12, margin: 0 }}>
          Run the benchmark to see comparisons
        </p>
      </div>
    );
  }

  return (
    <div className="bench-compare-charts">
      {(runningCount > 0 || errorCount > 0 || entries.length !== vfsConfigs.length) && (
        <p className="bench-chart-desc" style={{ marginBottom: 0 }}>
          Showing {entries.length} completed {entries.length === 1 ? "result" : "results"}
          {runningCount > 0 ? ` · ${runningCount} running` : ""}
          {errorCount > 0 ? ` · ${errorCount} failed` : ""}
        </p>
      )}

      <ThroughputOverviewChart entries={entries} />

      <LatencyChart
        entries={entries}
        title="Read Latency"
        description="Compares isolated read median and p95 latency. VFS rows use the same order in every chart. Lower is better."
        axisTitle="Latency (ms)"
        getMedian={(entry) => entry.result.reads.median}
        getP95={(entry) => entry.result.reads.p95}
        getMax={(entry) => entry.result.reads.max}
      />

      <LatencyChart
        entries={entries}
        title="Transaction Commit Latency"
        description={`Compares per-transaction commit median and p95 latency at ${entries[0]?.result.config.txBatchSize ?? 0} rows/tx. VFS rows use the same order in every chart. Lower is better.`}
        axisTitle="Commit latency (ms)"
        getMedian={(entry) => entry.result.txWrites.txMedian}
        getP95={(entry) => entry.result.txWrites.txP95}
        getMax={(entry) => entry.result.txWrites.txMax}
      />

      <LatencyChart
        entries={entries}
        title="Serialized Mix Read Latency"
        description="Compares read median and p95 latency during the interleaved read/write phase. VFS rows use the same order in every chart. Lower is better."
        axisTitle="Read latency (ms)"
        getMedian={(entry) => entry.result.interleaved.readMedian}
        getP95={(entry) => entry.result.interleaved.readP95}
        getMax={(entry) => entry.result.interleaved.readMax}
      />

      <SerializedMixRetentionChart entries={entries} />
    </div>
  );
}
