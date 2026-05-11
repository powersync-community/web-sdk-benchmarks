import { useState } from "react";
import {
  useVfsBenchmark,
  DEFAULT_BENCHMARK_CONFIG,
  type BenchmarkConfig,
} from "../hooks/useVfsBenchmark";
import { VFS_CONFIGS } from "../vfsConfig";
import { BenchmarkResultCard } from "./BenchmarkResultCard";
import { VfsModePanel } from "./VfsModePanel";
import { VfsBenchmarkCompareChart } from "./VfsBenchmarkCompareChart";

interface RawBenchmarkContentProps {
  activeVfsIds: Set<string>;
  onToggleVfs: (id: string) => void;
}

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
          <h3>Benchmark Config</h3>
          <p className="section-description">
            Measures per-operation latency for writes and reads against each VFS
            backend. Backends run sequentially to avoid cross-VFS interference.
          </p>

          <div className="bench-n-input">
            <label htmlFor="bench-duration" className="bench-n-label">
              Duration (seconds)
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
            <p className="setting-description">
              Each phase runs for this duration. Total time ≈{" "}
              {config.durationSec * 4}s per VFS (4 measured phases + warmup).
            </p>
          </div>

          <div className="bench-n-input">
            <label htmlFor="bench-batch-size" className="bench-n-label">
              Transaction Batch Size
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
            <p className="setting-description">
              Rows per writeTransaction() call. Per-transaction commit latency
              is captured.
            </p>
          </div>

          <div className="bench-n-input">
            <label htmlFor="bench-read-seed" className="bench-n-label">
              Read Seed Rows
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
            <p className="setting-description">
              Rows seeded before the read phase. Higher values push beyond
              SQLite's page cache for more realistic VFS read measurement.
            </p>
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
              <span className="button-description">
                Runs warmup + 4 phases per VFS, sequentially.
              </span>
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
              {config.readSeedCount.toLocaleString()} seeded rows.
            </dd>
            <dt>Interleaved Read + Write</dt>
            <dd>
              Independent read and write loops run via Promise.all for{" "}
              {config.durationSec}s. Both are serialized through the same Web
              Worker message queue — this measures interleaved scheduling
              latency, not true parallel I/O.
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
