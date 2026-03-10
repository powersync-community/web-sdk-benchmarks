import { useState } from "react";
import { type VFSInstance } from "../hooks/useVfsDatabases";
import { useVfsBenchmark } from "../hooks/useVfsBenchmark";
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
  const [n, setN] = useState(100);
  const [showCompareChart, setShowCompareChart] = useState(false);
  const { states, isRunning, run, cancel } = useVfsBenchmark();

  const visibleInstances = instances.filter((i) => activeVfsIds.has(i.config.id));
  const allReady =
    visibleInstances.length > 0 && visibleInstances.every((i) => i.status === "ready");

  return (
    <div className="app-container">
      <aside className="control-panel">
        <div className="control-section">
          <h3>Benchmark Config</h3>
          <p className="section-description">
            Measures per-operation latency for writes and reads against each VFS backend.
          </p>

          <div className="bench-n-input">
            <label htmlFor="bench-n" className="bench-n-label">
              Operations (N)
            </label>
            <input
              id="bench-n"
              type="number"
              value={n}
              min={1}
              max={10000}
              step={50}
              disabled={isRunning}
              onChange={(e) => setN(Math.max(1, Number(e.target.value)))}
              className="bench-n-field"
            />
            <p className="setting-description">
              Number of rows per phase. Higher values give more stable percentiles.
            </p>
          </div>

          {isRunning ? (
            <button onClick={cancel} className="control-button danger">
              <span className="button-label">Cancel</span>
            </button>
          ) : (
            <button
              onClick={() => run(visibleInstances, n)}
              disabled={!allReady}
              className="control-button"
            >
              <span className="button-label">Run Benchmark</span>
              <span className="button-description">
                Runs all four phases for each active VFS in parallel.
              </span>
            </button>
          )}
        </div>

        <div className="control-section legend">
          <h3>Phases</h3>
          <dl>
            <dt>Single Writes</dt>
            <dd>
              N individual inserts, each its own implicit transaction. Exposes raw per-commit VFS
              overhead.
            </dd>
            <dt>Transaction Writes</dt>
            <dd>
              N inserts in one writeTransaction() — a single commit. Compare to single writes to
              see batching benefit.
            </dd>
            <dt>Reads</dt>
            <dd>
              N primary-key lookups against the rows from the transaction phase. Measures read
              latency under no write pressure.
            </dd>
            <dt>Read Under Write Pressure</dt>
            <dd>
              N reads while a background write loop runs at full speed simultaneously. Compare
              latency to the Reads phase — the difference shows how much the VFS blocks reads
              behind write commits.
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
                Per-operation latency — single writes vs transaction vs reads ({n} ops each)
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
              n={n}
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
