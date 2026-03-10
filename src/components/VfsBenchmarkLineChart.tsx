import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  type TooltipItem,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Tooltip);

interface Snapshot {
  writeCount: number;
  latencyMs: number;
}

interface VfsBenchmarkLineChartProps {
  snapshots: Snapshot[] | undefined;
  className?: string;
}

export function VfsBenchmarkLineChart({ snapshots, className = "bench-line-chart" }: VfsBenchmarkLineChartProps) {
  if (!snapshots || snapshots.length === 0) {
    return (
      <div className={`${className} bench-card-placeholder`}>
        Run benchmark to see latency progression
      </div>
    );
  }

  // Downsample if more than 150 points
  const step = snapshots.length > 150 ? Math.ceil(snapshots.length / 150) : 1;
  const sampled = snapshots.filter((_, i) => i % step === 0);
  const large = sampled.length > 150;

  const data = {
    labels: sampled.map((s) => s.writeCount),
    datasets: [
      {
        data: sampled.map((s) => s.latencyMs),
        borderColor: "#4caf50",
        backgroundColor: "transparent",
        borderWidth: 1.5,
        pointRadius: large ? 0 : 2,
        tension: 0,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: TooltipItem<"line">) => `${(ctx.parsed.y ?? 0).toFixed(2)}ms`,
          title: (items: TooltipItem<"line">[]) => `Writes: ${items[0]?.label ?? ""}`,
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: "Write count", color: "#666", font: { size: 9 } },
        ticks: { color: "#666", font: { size: 9 }, maxTicksLimit: 6 },
        grid: { color: "#2a2a2a" },
      },
      y: {
        title: { display: true, text: "Latency (ms)", color: "#666", font: { size: 9 } },
        ticks: { color: "#666", font: { size: 9 }, maxTicksLimit: 4 },
        grid: { color: "#2a2a2a" },
      },
    },
  };

  return (
    <div className={className}>
      <Line data={data} options={options} />
    </div>
  );
}
