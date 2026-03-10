import { type VFSInstance } from "../hooks/useVfsDatabases";
import {
  type BenchmarkInstanceState,
  type BenchmarkPhase,
  type PhaseResult,
} from "../hooks/useVfsBenchmark";

interface BenchmarkResultCardProps {
  instance: VFSInstance;
  state: BenchmarkInstanceState | undefined;
  n: number;
}

const PHASE_LABELS: Record<BenchmarkPhase, string> = {
  "single-writes": "Single Writes",
  "tx-writes": "Transaction Writes",
  reads: "Reads",
};

export function BenchmarkResultCard({ instance, state, n }: BenchmarkResultCardProps) {
  if (instance.status !== "ready") {
    return (
      <div className="watch-container bench-card">
        <div className="bench-card-header">{instance.config.label}</div>
        <p className="bench-card-placeholder">
          {instance.status === "error" ? "DB init failed" : "Initializing DB…"}
        </p>
      </div>
    );
  }

  return (
    <div className="watch-container bench-card">
      <div className="bench-card-header">{instance.config.label}</div>

      {(!state || state.status === "idle") && (
        <p className="bench-card-placeholder">Press Run Benchmark to start</p>
      )}

      {state?.status === "running" && (
        <div className="bench-running">
          <span className="vfs-spinner" />
          <span>{state.phase ? PHASE_LABELS[state.phase] : "Starting"}…</span>
        </div>
      )}

      {state?.status === "error" && (
        <p className="bench-card-placeholder warning">
          {state.error?.message ?? "Benchmark failed"}
        </p>
      )}

      {state?.status === "done" && state.result && (
        <div className="bench-results">
          <PhaseSection label="Single Writes" result={state.result.singleWrites} n={n} />
          <PhaseSection label="Transaction Writes" result={state.result.txWrites} n={n} isTx />
          <PhaseSection label="Reads" result={state.result.reads} n={n} />
        </div>
      )}
    </div>
  );
}

function PhaseSection({
  label,
  result,
  n,
  isTx = false,
}: {
  label: string;
  result: PhaseResult;
  n: number;
  isTx?: boolean;
}) {
  const fmt = (v: number | null, suffix = "ms") =>
    v !== null ? `${v.toFixed(2)}${suffix}` : "—";

  return (
    <div className="bench-phase">
      <div className="bench-phase-label">
        {label} <span className="bench-n">({n} ops)</span>
      </div>
      <div className="bench-phase-stats">
        <BenchStat label="Total" value={`${result.totalMs.toFixed(0)}ms`} />
        <BenchStat label="Ops/sec" value={Math.round(result.rowsPerSec).toLocaleString()} />
        {isTx ? (
          <BenchStat label="Per-op" value="single commit" dim />
        ) : (
          <>
            <BenchStat label="Min" value={fmt(result.min)} />
            <BenchStat label="Median" value={fmt(result.median)} />
            <BenchStat label="p95" value={fmt(result.p95)} />
            <BenchStat label="Max" value={fmt(result.max)} />
          </>
        )}
      </div>
    </div>
  );
}

function BenchStat({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className="bench-stat">
      <span className="bench-stat-label">{label}</span>
      <span className={`bench-stat-value${dim ? " bench-stat-dim" : ""}`}>{value}</span>
    </div>
  );
}
