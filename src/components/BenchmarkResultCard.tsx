import { useState } from "react";
import { type VFSInstance } from "../hooks/useVfsDatabases";
import {
  type BenchmarkInstanceState,
  type BenchmarkPhase,
  type PhaseResult,
  type ConcurrencyResult,
} from "../hooks/useVfsBenchmark";
import { VfsBenchmarkLineChart } from "./VfsBenchmarkLineChart";

interface BenchmarkResultCardProps {
  instance: VFSInstance;
  state: BenchmarkInstanceState | undefined;
}

const PHASE_LABELS: Record<BenchmarkPhase, string> = {
  warmup: "Warmup",
  "single-writes": "Single Writes",
  "tx-writes": "Transaction Writes",
  reads: "Reads",
  concurrency: "Read Under Write Pressure",
};

export function BenchmarkResultCard({ instance, state }: BenchmarkResultCardProps) {
  const [showChartModal, setShowChartModal] = useState(false);

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
          {/* Run metadata */}
          <div className="bench-run-meta">
            <span>Sequential</span>
            <span>·</span>
            <span>{state.result.config.ops} ops</span>
            <span>·</span>
            <span>Write pressure {state.result.config.writePressure}×</span>
          </div>

          <PhaseSection label="Single Writes" result={state.result.singleWrites} />
          <PhaseSection label="Transaction Writes" result={state.result.txWrites} isTx />
          <PhaseSection label="Reads" result={state.result.reads} />
          <ConcurrencySection result={state.result.concurrency} />
          <div className="bench-line-chart-row">
            <span className="bench-line-chart-label">Latency vs write pressure</span>
            {state.result.concurrency.readSnapshots.length > 0 && (
              <button
                className="bench-expand-btn"
                onClick={() => setShowChartModal(true)}
                title="Enlarge chart"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M7.5 1.5H10.5V4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M4.5 10.5H1.5V7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M10.5 1.5L7 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M1.5 10.5L5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            )}
          </div>
          <VfsBenchmarkLineChart snapshots={state.result.concurrency.readSnapshots} />
        </div>
      )}

      {showChartModal && state?.result && (
        <div className="bench-modal-backdrop" onClick={() => setShowChartModal(false)}>
          <div className="bench-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bench-modal-header">
              <h2>{instance.config.label} — Latency vs Write Pressure</h2>
              <button onClick={() => setShowChartModal(false)}>✕</button>
            </div>
            <VfsBenchmarkLineChart
              snapshots={state.result.concurrency.readSnapshots}
              className="bench-line-chart-large"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PhaseSection({
  label,
  result,
  isTx = false,
}: {
  label: string;
  result: PhaseResult;
  isTx?: boolean;
}) {
  const fmt = (v: number | null) =>
    v !== null ? `${v.toFixed(2)} ms` : "—";

  return (
    <div className="bench-phase">
      <div className="bench-phase-label">
        {label} <span className="bench-n">({result.opsCount} ops)</span>
      </div>
      <div className="bench-phase-stats">
        <BenchStat label="Total" value={`${result.totalMs.toFixed(0)} ms`} />
        <BenchStat label="Throughput" value={`${Math.round(result.rowsPerSec).toLocaleString()} ops/s`} />
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

function ConcurrencySection({ result }: { result: ConcurrencyResult }) {
  const fmt = (v: number | null) => (v !== null ? `${v.toFixed(2)} ms` : "—");

  return (
    <div className="bench-phase">
      <div className="bench-phase-label">
        Read Under Write Pressure <span className="bench-n">({result.readsCompleted} reads)</span>
      </div>

      {/* Read Performance */}
      <div className="bench-phase-subgroup">
        <span className="bench-subgroup-label">Read Performance</span>
        <div className="bench-phase-stats">
          <BenchStat label="Throughput" value={`${Math.round(result.readRowsPerSec).toLocaleString()} ops/s`} />
          <BenchStat label="Min" value={fmt(result.readMin)} />
          <BenchStat label="Median" value={fmt(result.readMedian)} />
          <BenchStat label="p95" value={fmt(result.readP95)} />
          <BenchStat label="Max" value={fmt(result.readMax)} />
        </div>
      </div>

      {/* Write Context */}
      <div className="bench-phase-subgroup">
        <span className="bench-subgroup-label">Write Context</span>
        <div className="bench-phase-stats">
          <BenchStat
            label="Writes"
            value={`${result.writesCompleted.toLocaleString()}${result.writesCapped ? " (capped)" : ""}`}
          />
          <BenchStat label="Write rate" value={`${Math.round(result.writeRowsPerSec).toLocaleString()} ops/s`} />
          <BenchStat label="Duration" value={`${result.totalMs.toFixed(0)} ms`} />
        </div>
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
