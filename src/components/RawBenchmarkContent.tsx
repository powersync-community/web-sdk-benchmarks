import { useState } from "react";
import {
  useVfsBenchmark,
  DEFAULT_BENCHMARK_CONFIG,
  DEFAULT_CACHE_SIZE_KB,
  type BenchmarkConfig,
} from "../hooks/useVfsBenchmark";
import { VFS_CONFIGS } from "../vfsConfig";
import { BenchmarkResultCard } from "./BenchmarkResultCard";
import { VfsModePanel } from "./VfsModePanel";
import { VfsBenchmarkCompareChart } from "./VfsBenchmarkCompareChart";
import { Tooltip } from "./Tooltip";

interface RawBenchmarkContentProps {
  activeVfsIds: Set<string>;
  onToggleVfs: (id: string) => void;
}

/**
 * Cache-size presets. The SDK applies `PRAGMA cache_size = -${cacheSizeKb}`, so
 * the value is KiB of page cache. "Default" matches PowerSync's own 50 MiB; the
 * smaller presets force the read phase to actually fetch pages from the VFS
 * instead of serving them from memory.
 */
const CACHE_SIZE_PRESETS: { label: string; cacheSizeKb: number }[] = [
  { label: "Default (50 MiB)", cacheSizeKb: DEFAULT_CACHE_SIZE_KB },
  { label: "Small (1 MiB)", cacheSizeKb: 1024 },
  { label: "Minimal (~1 KiB)", cacheSizeKb: 1 },
];

/**
 * Reader-worker presets, passed to `WASQLiteOpenFactory` as `additionalReaders`.
 * Only `OPFSWriteAheadVFS` opens these extra read-only workers; the interleaved
 * phase runs this many concurrent read loops to exercise them. "Default (1)"
 * matches PowerSync's own default and leaves the phase behaving as before.
 */
const READER_PRESETS: { label: string; additionalReaders: number }[] = [
  { label: "Default (1)", additionalReaders: 1 },
  { label: "2 readers", additionalReaders: 2 },
  { label: "4 readers", additionalReaders: 4 },
];

/**
 * WAL checkpoint strategy, applied via PRAGMAs to `OPFSWriteAheadVFS` only.
 * "Auto" is the VFS default (checkpoint after every commit); "Manual" disables
 * that and drains the WAL on a timer; "Disabled" never explicitly checkpoints
 * (a write-throughput ceiling, not a real setting).
 */
const CHECKPOINT_PRESETS: {
  label: string;
  mode: BenchmarkConfig["checkpointMode"];
}[] = [
  { label: "Auto (per-commit)", mode: "auto" },
  { label: "Manual (periodic)", mode: "manual" },
  { label: "Disabled (no checkpoints)", mode: "disabled" },
];

export function RawBenchmarkContent({
  activeVfsIds,
  onToggleVfs,
}: RawBenchmarkContentProps) {
  const [config, setConfig] = useState<BenchmarkConfig>(
    DEFAULT_BENCHMARK_CONFIG,
  );
  const [showCompareChart, setShowCompareChart] = useState(false);
  const { states, isRunning, run, cancel } = useVfsBenchmark();

  const visibleVfsConfigs = VFS_CONFIGS.filter((c) => activeVfsIds.has(c.id));
  const canRun = visibleVfsConfigs.length > 0;

  const updateConfig = (patch: Partial<BenchmarkConfig>) =>
    setConfig((prev) => ({ ...prev, ...patch }));

  return (
    <div className="app-container">
      <aside className="control-panel">
        <VfsModePanel activeVfsIds={activeVfsIds} onToggle={onToggleVfs} />
        <div className="control-section">
          <h3>
            Benchmark Config
            <Tooltip content="Measures per-operation latency for writes and reads against each VFS backend. Backends run sequentially to avoid cross-VFS interference." />
          </h3>

          <div className="bench-n-input">
            <label htmlFor="bench-duration" className="bench-n-label">
              Duration (seconds)
              <Tooltip
                content={
                  <>
                    Each phase runs for this duration. Total time ≈{" "}
                    {config.durationSec * 4}s per VFS (4 measured phases +
                    warmup).
                  </>
                }
              />
            </label>
            <input
              id="bench-duration"
              type="number"
              value={config.durationSec}
              min={1}
              max={60}
              step={1}
              disabled={isRunning}
              onChange={(e) =>
                updateConfig({
                  durationSec: Math.max(1, Number(e.target.value)),
                })
              }
              className="bench-n-field"
            />
          </div>

          <div className="bench-n-input">
            <label htmlFor="bench-batch-size" className="bench-n-label">
              Transaction Batch Size
              <Tooltip content="Rows per writeTransaction() call. Per-transaction commit latency is captured." />
            </label>
            <input
              id="bench-batch-size"
              type="number"
              value={config.txBatchSize}
              min={1}
              max={10000}
              step={100}
              disabled={isRunning}
              onChange={(e) =>
                updateConfig({
                  txBatchSize: Math.max(1, Number(e.target.value)),
                })
              }
              className="bench-n-field"
            />
          </div>

          <div className="bench-n-input">
            <label htmlFor="bench-read-seed" className="bench-n-label">
              Read Seed Rows
              <Tooltip content="Rows seeded before the read phase. Higher values push beyond SQLite's page cache for more realistic VFS read measurement." />
            </label>
            <input
              id="bench-read-seed"
              type="number"
              value={config.readSeedCount}
              min={10}
              max={50000}
              step={100}
              disabled={isRunning}
              onChange={(e) =>
                updateConfig({
                  readSeedCount: Math.max(10, Number(e.target.value)),
                })
              }
              className="bench-n-field"
            />
          </div>

          <div className="bench-n-input">
            <label htmlFor="bench-cache-size" className="bench-n-label">
              SQLite Cache Size
              <Tooltip
                content={
                  <>
                    Passed to <code>WASQLiteOpenFactory</code> as{" "}
                    <code>cacheSizeKb</code> (
                    <code>PRAGMA cache_size = -cacheSizeKb</code>). PowerSync's
                    default 50 MiB holds the entire read working set at typical
                    seed counts, so reads come from memory, not the VFS. Drop it
                    to <strong>Minimal</strong> to force real VFS read I/O and
                    expose per-backend differences.
                  </>
                }
              />
            </label>
            <select
              id="bench-cache-size"
              value={config.cacheSizeKb}
              disabled={isRunning}
              onChange={(e) =>
                updateConfig({ cacheSizeKb: Number(e.target.value) })
              }
              className="bench-n-field"
            >
              {CACHE_SIZE_PRESETS.map((preset) => (
                <option key={preset.cacheSizeKb} value={preset.cacheSizeKb}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>

          <div className="bench-n-input">
            <label htmlFor="bench-readers" className="bench-n-label">
              Reader Workers
              <Tooltip
                content={
                  <>
                    Passed to <code>WASQLiteOpenFactory</code> as{" "}
                    <code>additionalReaders</code>. Only{" "}
                    <code>OPFSWriteAheadVFS</code> opens these extra read-only
                    workers — every other VFS serves all traffic from a single
                    connection and ignores this. The{" "}
                    <strong>Interleaved Read + Write</strong> phase runs this
                    many concurrent read loops, so on WAL the aggregate read
                    throughput scales with reader count while writes continue;
                    elsewhere the reads just queue behind one worker.
                  </>
                }
              />
            </label>
            <select
              id="bench-readers"
              value={config.additionalReaders}
              disabled={isRunning}
              onChange={(e) =>
                updateConfig({ additionalReaders: Number(e.target.value) })
              }
              className="bench-n-field"
            >
              {READER_PRESETS.map((preset) => (
                <option
                  key={preset.additionalReaders}
                  value={preset.additionalReaders}
                >
                  {preset.label}
                </option>
              ))}
            </select>
          </div>

          <div className="bench-n-input">
            <label htmlFor="bench-checkpoint" className="bench-n-label">
              WAL Checkpointing
              <Tooltip
                content={
                  <>
                    Applies only to <code>OPFSWriteAheadVFS</code> (the WAL
                    backend); other VFSs ignore it.{" "}
                    <strong>Auto</strong> is the VFS default —{" "}
                    <code>wal_autocheckpoint=1</code> runs a passive checkpoint
                    after <em>every</em> commit, keeping the WAL tiny but taxing
                    each write. <strong>Manual</strong> sets{" "}
                    <code>wal_autocheckpoint=0</code> and drains the WAL on a
                    timer (<code>PRAGMA wal_checkpoint(passive)</code> every{" "}
                    {config.checkpointIntervalMs}ms). <strong>Disabled</strong>{" "}
                    never explicitly checkpoints — a throughput ceiling, not a
                    real setting.
                  </>
                }
              />
            </label>
            <select
              id="bench-checkpoint"
              value={config.checkpointMode}
              disabled={isRunning}
              onChange={(e) =>
                updateConfig({
                  checkpointMode: e.target
                    .value as BenchmarkConfig["checkpointMode"],
                })
              }
              className="bench-n-field"
            >
              {CHECKPOINT_PRESETS.map((preset) => (
                <option key={preset.mode} value={preset.mode}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>

          {isRunning ? (
            <button onClick={cancel} className="control-button danger">
              <span className="button-label">Cancel</span>
            </button>
          ) : (
            <button
              onClick={() => run(visibleVfsConfigs, config)}
              disabled={!canRun}
              className="control-button"
            >
              <span className="button-label">Run Benchmark</span>
              <Tooltip
                variant="corner"
                content="Runs warmup + 4 phases per VFS, sequentially."
              />
            </button>
          )}
        </div>

        <div className="control-section legend">
          <h3>Phases</h3>
          <dl>
            <dt>Warmup</dt>
            <dd>
              Mirrors all measured phases briefly (single writes, transactions,
              reads) to prime WASM JIT, VFS layers, and page cache. Results
              discarded.
            </dd>
            <dt>Single Writes</dt>
            <dd>
              Individual inserts for {config.durationSec}s, each its own
              implicit transaction. Exposes raw per-commit VFS overhead.
            </dd>
            <dt>Transaction Writes</dt>
            <dd>
              Batched inserts ({config.txBatchSize} per transaction) for{" "}
              {config.durationSec}s. Per-transaction commit latency is captured.
            </dd>
            <dt>Reads</dt>
            <dd>
              Primary-key lookups for {config.durationSec}s against{" "}
              {config.readSeedCount.toLocaleString()} seeded rows. Whether these
              hit the VFS or SQLite's in-memory page cache depends on the cache
              size — see Measurement Notes.
            </dd>
            <dt>Interleaved Read + Write</dt>
            <dd>
              {config.additionalReaders} concurrent read loop
              {config.additionalReaders === 1 ? "" : "s"} run alongside one write
              loop via Promise.all for {config.durationSec}s. On every VFS except{" "}
              <code>OPFSWriteAheadVFS</code> these serialize through one worker —
              measuring interleaved scheduling latency, not parallel I/O. On WAL,
              the extra reader workers let reads run in parallel with the write.
            </dd>
          </dl>
        </div>

        <div className="control-section legend">
          <h3>⚠ Measurement Notes</h3>
          <dl>
            <dt>Timer Precision</dt>
            <dd>
              Browser <code>performance.now()</code> is reduced to 5–100μs due
              to Spectre mitigations. Sub-millisecond per-op latencies may show
              quantization artifacts.
            </dd>
            <dt>SDK Overhead</dt>
            <dd>
              All operations go through PowerSync's Web Worker proxy (JS →
              postMessage → worker → SQLite → postMessage → JS). Latencies
              include this round-trip, not just VFS I/O.
            </dd>
            <dt>Phase Isolation</dt>
            <dd>
              Each phase cleans up its data before and after. A 500ms settle
              pause between phases allows GC and pending microtasks to complete.
            </dd>
            <dt>Read Cache vs. VFS I/O</dt>
            <dd>
              At the default 50 MiB cache, the read working set (≈7.5 KiB/row)
              fits entirely in memory, so the read phase measures cached reads —
              not VFS I/O. Lower the cache size to force pages from the backend.
              Even then, <code>OPFSWriteAheadVFS</code> keeps page 1 in memory
              while the synchronous OPFS VFSs re-fetch it for every read tx, so
              WAL can read faster despite doing more work.
            </dd>
            <dt>Reader Workers &amp; Concurrency</dt>
            <dd>
              <code>additionalReaders</code> only opens real parallel
              connections on <code>OPFSWriteAheadVFS</code>, which alone supports
              concurrent reads — raising <strong>Reader Workers</strong> fans
              reads across those workers, so its interleaved read throughput
              scales sharply and stays far above the others in absolute terms.
              Other backends share one worker: more read loops still raise their
              read throughput, but via deeper queue pipelining (the worker stays
              fed), <em>not</em> parallel I/O — the reads never overlap, write
              throughput drops as reads take scheduler share, and the totals stay
              an order of magnitude below WAL. The per-card ⚠ note flags when
              concurrent reads were requested on a single-connection backend.
            </dd>
            <dt>WAL Checkpointing</dt>
            <dd>
              <code>OPFSWriteAheadVFS</code> checkpoints after every commit by
              default (<code>wal_autocheckpoint=1</code>), so its write phases
              carry the cost of draining the WAL each time.{" "}
              <strong>Manual</strong> and <strong>Disabled</strong> lift that
              cost off the commit path — expect somewhat higher write throughput
              (the effect is modest and noisy at short durations). In{" "}
              <strong>Manual</strong> the card shows how many checkpoints the
              driver fired and the peak pre-drain WAL size — note this VFS counts{" "}
              <em>distinct</em> pages, so it reflects the working set, not
              cumulative log growth. The other VFSs aren't WAL-mode, so the
              setting is recorded but does nothing — each card says so.
            </dd>
          </dl>
        </div>
      </aside>

      <main className="main-content">
        <header>
          <div className="bench-header-row">
            <div>
              <h1>SDK Benchmark</h1>
              <p className="subtitle">
                Sequential per-VFS — {config.durationSec}s per phase, batch size{" "}
                {config.txBatchSize}
              </p>
            </div>
            <button
              className="bench-chart-icon-btn"
              onClick={() => setShowCompareChart(true)}
              title="Compare VFS results"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect
                  x="1"
                  y="9"
                  width="3"
                  height="8"
                  rx="1"
                  fill="currentColor"
                />
                <rect
                  x="6"
                  y="5"
                  width="3"
                  height="12"
                  rx="1"
                  fill="currentColor"
                />
                <rect
                  x="11"
                  y="2"
                  width="3"
                  height="15"
                  rx="1"
                  fill="currentColor"
                />
                <rect
                  x="16"
                  y="6"
                  width="1"
                  height="1"
                  rx="0.5"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
        </header>

        <div
          className="watch-grid"
          style={{
            gridTemplateColumns: `repeat(${visibleVfsConfigs.length}, 1fr)`,
          }}
        >
          {visibleVfsConfigs.map((vfsCfg) => (
            <BenchmarkResultCard
              key={vfsCfg.id}
              vfsConfig={vfsCfg}
              state={states.get(vfsCfg.id)}
            />
          ))}
        </div>
      </main>

      {showCompareChart && (
        <div
          className="bench-modal-backdrop"
          onClick={() => setShowCompareChart(false)}
        >
          <div className="bench-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bench-modal-header">
              <h2>VFS Comparison — Latency &amp; Throughput</h2>
              <button onClick={() => setShowCompareChart(false)}>✕</button>
            </div>
            <VfsBenchmarkCompareChart
              states={states}
              vfsConfigs={visibleVfsConfigs}
            />
          </div>
        </div>
      )}
    </div>
  );
}
