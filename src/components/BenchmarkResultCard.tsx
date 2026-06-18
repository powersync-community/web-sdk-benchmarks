import { useState } from "react";
import { type VFSConfig } from "../vfsConfig";
import {
  type BenchmarkConfig,
  type BenchmarkInstanceState,
  type BenchmarkPhase,
  type PhaseResult,
  type InterleavedResult,
  type CheckpointStats,
} from "../hooks/useVfsBenchmark";

/** Rough on-disk size per seeded todo row (Roy's figure: ~1000 rows ≈ 7.3 MB). */
const APPROX_ROW_KIB = 7.5;

/**
 * Warn when SQLite's page cache is large enough to hold the entire read working
 * set — in that case the read numbers reflect cached reads, not VFS I/O.
 */
function readCacheNote(config: BenchmarkConfig): string | null {
  const workingSetKiB = config.readSeedCount * APPROX_ROW_KIB;
  if (config.cacheSizeKb >= workingSetKiB) {
    return "Working set fits in the page cache — reads are served from memory, not the VFS. Lower the cache size to measure VFS read I/O.";
  }
  return null;
}
import { VfsBenchmarkLineChart } from "./VfsBenchmarkLineChart";

interface BenchmarkResultCardProps {
  vfsConfig: VFSConfig;
  state: BenchmarkInstanceState | undefined;
}

const PHASE_LABELS: Record<BenchmarkPhase, string> = {
  warmup: "Warmup",
  "single-writes": "Single Writes",
  "tx-writes": "Transaction Writes",
  reads: "Reads",
  interleaved: "Interleaved Read + Write",
};

export function BenchmarkResultCard({
  vfsConfig,
  state,
}: BenchmarkResultCardProps) {
  const [showChartModal, setShowChartModal] = useState(false);

  return (
    <div className="watch-container bench-card">
      <div className="bench-card-header">{vfsConfig.label}</div>

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
          <PhaseSection
            label="Single Writes"
            result={state.result.singleWrites}
          />
          <PhaseSection
            label="Transaction Writes"
            result={state.result.txWrites}
            isTx
          />
          <PhaseSection
            label="Reads"
            result={state.result.reads}
            note={readCacheNote(state.result.config)}
          />
          <InterleavedSection
            result={state.result.interleaved}
            vfsConfig={vfsConfig}
          />
          <CheckpointSection checkpoint={state.result.checkpoint} />
          <div className="bench-line-chart-row">
            <span className="bench-line-chart-label">
              Latency vs interleaved writes
            </span>
            {state.result.interleaved.readSnapshots.length > 0 && (
              <button
                className="bench-expand-btn"
                onClick={() => setShowChartModal(true)}
                title="Enlarge chart"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M7.5 1.5H10.5V4.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M4.5 10.5H1.5V7.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M10.5 1.5L7 5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <path
                    d="M1.5 10.5L5 7"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </div>
          <VfsBenchmarkLineChart
            snapshots={state.result.interleaved.readSnapshots}
          />
        </div>
      )}

      {showChartModal && state?.result && (
        <div
          className="bench-modal-backdrop"
          onClick={() => setShowChartModal(false)}
        >
          <div className="bench-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bench-modal-header">
              <h2>{vfsConfig.label} — Latency vs Interleaved Writes</h2>
              <button onClick={() => setShowChartModal(false)}>✕</button>
            </div>
            <VfsBenchmarkLineChart
              snapshots={state.result.interleaved.readSnapshots}
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
  note,
}: {
  label: string;
  result: PhaseResult;
  isTx?: boolean;
  note?: string | null;
}) {
  const fmt = (v: number | null) => (v !== null ? `${v.toFixed(2)} ms` : "—");

  return (
    <div className="bench-phase">
      <div className="bench-phase-label">
        {label}{" "}
        <span className="bench-n">
          ({result.opsCount} ops
          {isTx && result.txCount != null ? `, ${result.txCount} txns` : ""})
        </span>
      </div>
      {note && <p className="bench-phase-note">⚠ {note}</p>}
      <div className="bench-phase-stats">
        <BenchStat
          label="Throughput"
          value={`${Math.round(result.rowsPerSec).toLocaleString()} ops/s`}
        />
        {isTx ? (
          <>
            <BenchStat label="Tx Min" value={fmt(result.txMin ?? null)} />
            <BenchStat label="Tx Median" value={fmt(result.txMedian ?? null)} />
            <BenchStat label="Tx p95" value={fmt(result.txP95 ?? null)} />
            <BenchStat label="Tx Max" value={fmt(result.txMax ?? null)} />
          </>
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

function InterleavedSection({
  result,
  vfsConfig,
}: {
  result: InterleavedResult;
  vfsConfig: VFSConfig;
}) {
  const fmt = (v: number | null) => (v !== null ? `${v.toFixed(2)} ms` : "—");

  // additionalReaders only applies to OPFSWriteAheadVFS. When the user asked for
  // concurrent reads on any other backend, be explicit that they serialized.
  const note =
    result.readConcurrency > 1 && vfsConfig.id !== "opfs-wal"
      ? `${result.readConcurrency} concurrent read loops requested, but this backend has a single connection — reads serialized through one worker (extra readers apply only to OPFSWriteAheadVFS).`
      : null;

  return (
    <div className="bench-phase">
      <div className="bench-phase-label">
        Interleaved Read + Write{" "}
        <span className="bench-n">
          ({result.readsCompleted} reads
          {result.readConcurrency > 1
            ? `, ${result.readConcurrency}× concurrent`
            : ""}
          )
        </span>
      </div>
      {note && <p className="bench-phase-note">⚠ {note}</p>}

      {/* Read Performance */}
      <div className="bench-phase-subgroup">
        <span className="bench-subgroup-label">Read Performance</span>
        <div className="bench-phase-stats">
          <BenchStat
            label="Throughput"
            value={`${Math.round(result.readRowsPerSec).toLocaleString()} ops/s`}
          />
          <BenchStat label="Min" value={fmt(result.readMin)} />
          <BenchStat label="Median" value={fmt(result.readMedian)} />
          <BenchStat label="p95" value={fmt(result.readP95)} />
          <BenchStat label="Max" value={fmt(result.readMax)} />
        </div>
      </div>

      {/* Write Context */}
      <div className="bench-phase-subgroup">
        <span className="bench-subgroup-label">Interleaved Writes</span>
        <div className="bench-phase-stats">
          <BenchStat
            label="Writes"
            value={result.writesCompleted.toLocaleString()}
          />
          <BenchStat
            label="Write rate"
            value={`${Math.round(result.writeRowsPerSec).toLocaleString()} ops/s`}
          />
          <BenchStat
            label="Duration"
            value={`${result.totalMs.toFixed(0)} ms`}
          />
        </div>
      </div>
    </div>
  );
}

const CHECKPOINT_MODE_LABELS: Record<CheckpointStats["mode"], string> = {
  auto: "Auto (per-commit)",
  manual: "Manual (periodic)",
  disabled: "Disabled (no checkpoints)",
};

function CheckpointSection({ checkpoint }: { checkpoint: CheckpointStats }) {
  // Non-WAL backends ignore the setting. Only surface that when the user picked
  // something other than the default, so default runs stay uncluttered.
  if (!checkpoint.appliesToVfs) {
    if (checkpoint.mode === "auto") return null;
    return (
      <div className="bench-phase">
        <div className="bench-phase-label">
          WAL Checkpointing{" "}
          <span className="bench-n">({CHECKPOINT_MODE_LABELS[checkpoint.mode]})</span>
        </div>
        <p className="bench-phase-note">
          ⚠ Not a WAL backend — <code>wal_autocheckpoint</code> /{" "}
          <code>wal_checkpoint</code> are no-ops here; setting ignored.
        </p>
      </div>
    );
  }

  // Stats only make sense for manual mode (driver-sampled, self-consistent).
  // Auto/disabled show just the mode label documenting what ran.
  const pages =
    checkpoint.walPagesPeak != null
      ? `${checkpoint.walPagesPeak.toLocaleString()} pages`
      : "—";

  return (
    <div className="bench-phase">
      <div className="bench-phase-label">
        WAL Checkpointing{" "}
        <span className="bench-n">({CHECKPOINT_MODE_LABELS[checkpoint.mode]})</span>
      </div>
      {checkpoint.mode === "manual" && (
        <div className="bench-phase-stats">
          <BenchStat
            label="Checkpoints"
            value={checkpoint.checkpointsIssued.toLocaleString()}
          />
          <BenchStat label="Peak WAL" value={pages} />
        </div>
      )}
    </div>
  );
}

function BenchStat({
  label,
  value,
  dim,
}: {
  label: string;
  value: string;
  dim?: boolean;
}) {
  return (
    <div className="bench-stat">
      <span className="bench-stat-label">{label}</span>
      <span className={`bench-stat-value${dim ? " bench-stat-dim" : ""}`}>
        {value}
      </span>
    </div>
  );
}
