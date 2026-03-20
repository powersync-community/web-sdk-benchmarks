import { useState } from "react";
import { type VFSInstance } from "../hooks/useVfsDatabases";
import { useVfsBenchmark, DEFAULT_BENCHMARK_CONFIG, type BenchmarkConfig, WRITE_PRESSURE_PRESETS } from "../hooks/useVfsBenchmark";
import { BenchmarkResultCard } from "./BenchmarkResultCard";
import { VfsModePanel } from "./VfsModePanel";
import { VfsBenchmarkCompareChart } from "./VfsBenchmarkCompareChart";

interface RawBenchmarkContentProps {
  instances: VFSInstance[];
  activeVfsIds: Set<string>;
  onToggleVfs: (id: string) => void;
}

export function RawBenchmarkContent({
  instances,
  activeVfsIds,
  onToggleVfs,
}: RawBenchmarkContentProps) {
  const [config, setConfig] = useState<BenchmarkConfig>(DEFAULT_BENCHMARK_CONFIG);
  const [showCompareChart, setShowCompareChart] = useState(false);
  const { states, isRunning, run, cancel } = useVfsBenchmark();

  const visibleInstances = instances.filter((i) => activeVfsIds.has(i.config.id));
  const allReady =
    visibleInstances.length > 0 && visibleInstances.every((i) => i.status === "ready");

  const updateConfig = (patch: Partial<BenchmarkConfig>) =>
    setConfig((prev) => ({ ...prev, ...patch }));

  return (
    <div className="app-container">
      <aside className="control-panel">
        <div className="control-section">
          <h3>Benchmark Config</h3>
          <p className="section-description">
            Measures per-operation latency for writes and reads against each VFS backend.
            Backends run sequentially to avoid cross-VFS interference.
          </p>

          <div className="bench-n-input">
            <label htmlFor="bench-ops" className="bench-n-label">
              Operations
            </label>
            <input
              id="bench-ops"
              type="number"
              value={config.ops}
              min={1}
              max={10000}
              step={50}
              disabled={isRunning}
              onChange={(e) => updateConfig({ ops: Math.max(1, Number(e.target.value)) })}
              className="bench-n-field"
            />
            <p className="setting-description">
              Number of operations per phase (writes, reads, and concurrency reads).
            </p>
          </div>

          <div className="bench-n-input">
            <label className="bench-n-label">Write Pressure</label>
            <div className="bench-segmented-row">
              {WRITE_PRESSURE_PRESETS.map((v) => (
                <button
                  key={v}
                  className={`bench-segment${config.writePressure === v ? " active" : ""}`}
                  disabled={isRunning}
                  onClick={() => updateConfig({ writePressure: v })}
                >
                  {v === 0 ? "None" : `${v}×`}
                </button>
              ))}
            </div>
            <div className="bench-pressure-custom">
              <input
                id="bench-write-pressure"
                type="number"
                value={config.writePressure}
                min={0}
                max={100}
                step={1}
                disabled={isRunning}
                onChange={(e) => updateConfig({ writePressure: Math.max(0, Number(e.target.value)) })}
                className="bench-n-field"
              />
              <span className="bench-pressure-suffix">× multiplier</span>
            </div>
            <p className="setting-description">
              Concurrent writes = ops × {config.writePressure} ({config.ops * config.writePressure} writes).
              Controls write load during the concurrency phase.
            </p>
          </div>

          {isRunning ? (
            <button onClick={cancel} className="control-button danger">
              <span className="button-label">Cancel</span>
            </button>
          ) : (
            <button
              onClick={() => run(visibleInstances, config)}
              disabled={!allReady}
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
              Small throwaway pass to warm up the VFS/WASM layer. Results are discarded.
            </dd>
            <dt>Single Writes</dt>
            <dd>
              {config.ops} individual inserts, each its own implicit transaction. Exposes raw per-commit VFS
              overhead.
            </dd>
            <dt>Transaction Writes</dt>
            <dd>
              {config.ops} inserts in one writeTransaction() — a single commit. Compare to single writes to
              see batching benefit.
            </dd>
            <dt>Reads</dt>
            <dd>
              {config.ops} primary-key lookups against the rows from the transaction phase. Measures read
              latency under no write pressure.
            </dd>
            <dt>Read Under Write Pressure</dt>
            <dd>
              {config.ops} reads and {config.ops * config.writePressure} writes run simultaneously.
              Phase ends when both complete. Compare latency to the isolated Reads phase —
              the difference shows how much the VFS blocks reads behind write commits.
            </dd>
          </dl>
        </div>

        <div className="control-section legend">
          <h3>⚠ Measurement Notes</h3>
          <dl>
            <dt>Timer Precision</dt>
            <dd>
              Browser <code>performance.now()</code> is reduced to 5–100μs due to Spectre
              mitigations. Sub-millisecond per-op latencies may show quantization artifacts.
            </dd>
            <dt>Phase Ordering</dt>
            <dd>
              Phases run sequentially with implicit data dependencies — reads use rows from
              transaction writes, concurrency seeds its own data after cleanup.
            </dd>
          </dl>
        </div>

        <VfsModePanel activeVfsIds={activeVfsIds} onToggle={onToggleVfs} />
      </aside>

      <main className="main-content">
        <header>
          <div className="bench-header-row">
            <div>
              <h1>Raw VFS Benchmark</h1>
              <p className="subtitle">
                Sequential per-VFS — {config.ops} ops, write pressure {config.writePressure}×
              </p>
            </div>
            <button
              className="bench-chart-icon-btn"
              onClick={() => setShowCompareChart(true)}
              title="Compare VFS results"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="1" y="9" width="3" height="8" rx="1" fill="currentColor"/>
                <rect x="6" y="5" width="3" height="12" rx="1" fill="currentColor"/>
                <rect x="11" y="2" width="3" height="15" rx="1" fill="currentColor"/>
                <rect x="16" y="6" width="1" height="1" rx="0.5" fill="currentColor"/>
              </svg>
            </button>
          </div>
        </header>

        <div
          className="watch-grid"
          style={{ gridTemplateColumns: `repeat(${visibleInstances.length}, 1fr)` }}
        >
          {visibleInstances.map((instance) => (
            <BenchmarkResultCard
              key={instance.config.id}
              instance={instance}
              state={states.get(instance.config.id)}
            />
          ))}
        </div>
      </main>

      {showCompareChart && (
        <div className="bench-modal-backdrop" onClick={() => setShowCompareChart(false)}>
          <div className="bench-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bench-modal-header">
              <h2>VFS Comparison — Min &amp; p95 Latency</h2>
              <button onClick={() => setShowCompareChart(false)}>✕</button>
            </div>
            <VfsBenchmarkCompareChart states={states} instances={visibleInstances} />
          </div>
        </div>
      )}
    </div>
  );
}
