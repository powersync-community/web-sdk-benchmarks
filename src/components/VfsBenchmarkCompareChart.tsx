import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip,
  type TooltipItem,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { type BenchmarkInstanceState } from "../hooks/useVfsBenchmark";
import { type VFSInstance } from "../hooks/useVfsDatabases";

ChartJS.register(BarElement, CategoryScale, LinearScale, Legend, Tooltip);

interface VfsBenchmarkCompareChartProps {
  states: Map<string, BenchmarkInstanceState>;
  instances: VFSInstance[];
}

// Strip "VFS" suffix for shorter labels
function shortLabel(label: string) {
  return label.replace(/VFS$/, "");
}

export function VfsBenchmarkCompareChart({ states, instances }: VfsBenchmarkCompareChartProps) {
  const done = instances.filter((inst) => states.get(inst.config.id)?.status === "done");

  if (done.length === 0) {
    return (
      <div className="bench-compare-chart" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "#555", fontSize: 12, margin: 0 }}>Run the benchmark to see comparisons</p>
      </div>
    );
  }

  const labels = done.map((inst) => shortLabel(inst.config.label));

  const readMin    = done.map((inst) => states.get(inst.config.id)!.result!.reads.min ?? 0);
  const readP95    = done.map((inst) => states.get(inst.config.id)!.result!.reads.p95 ?? 0);
  const concurMin  = done.map((inst) => states.get(inst.config.id)!.result!.concurrency.readMin ?? 0);
  const concurP95  = done.map((inst) => states.get(inst.config.id)!.result!.concurrency.readP95 ?? 0);

  const data = {
    labels,
    datasets: [
      { label: "Read min",       data: readMin,   backgroundColor: "#4caf50" },
      { label: "Read p95",       data: readP95,   backgroundColor: "#00897b" },
      { label: "Concurrent min", data: concurMin, backgroundColor: "#ff9800" },
      { label: "Concurrent p95", data: concurP95, backgroundColor: "#f44336" },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    plugins: {
      legend: {
        labels: { color: "#888", font: { size: 11 } },
      },
      tooltip: {
        callbacks: {
          label: (ctx: TooltipItem<"bar">) =>
            `${ctx.dataset.label ?? ""}: ${(ctx.parsed.y ?? 0).toFixed(2)}ms`,
        },
      },
    },
    scales: {
      x: {
        ticks: { color: "#888", font: { size: 10 } },
        grid: { color: "#2a2a2a" },
      },
      y: {
        title: { display: true, text: "Latency (ms)", color: "#888", font: { size: 10 } },
        ticks: { color: "#888", font: { size: 10 } },
        grid: { color: "#2a2a2a" },
      },
    },
  };

  return (
    <div className="bench-compare-chart">
      <Bar data={data} options={options} />
    </div>
  );
}
