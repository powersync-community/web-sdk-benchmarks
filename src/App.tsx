import "./App.css";
import { PowerSyncContext, usePowerSync } from "@powersync/react";
import { initPowerSync, powerSyncDatabase } from "./powersync";
import { useEffect, useState } from "react";
import { useMetricsActions } from "./stores/metricsStore";
import { MetricsDashboard } from "./components/MetricsDashboard";
import { setupMetricsTracking } from "./utils/metricsWrapper";
import { BasicWatchList } from "./components/BasicWatchList";
import { IncrementalWatchList } from "./components/IncrementalWatchList";
import { DifferentialWatchList } from "./components/DifferentialWatchList";
import { TriggerBasedList } from "./components/TriggerBasedList";
import { ControlPanel } from "./components/ControlPanel";
import { VfsWatchColumn } from "./components/VfsWatchColumn";
import { VfsModePanel } from "./components/VfsModePanel";
import { VfsQueryTypePanel } from "./components/VfsQueryTypePanel";
import { RawBenchmarkContent } from "./components/RawBenchmarkContent";
import { useVfsDatabases, type VFSInstance } from "./hooks/useVfsDatabases";
import { VFS_CONFIGS } from "./vfsConfig";
import { type QueryType } from "./queryTypeConfig";

type AppMode = "watch-query" | "vfs-comparison" | "raw-benchmark";

function App() {
  const [mode, setMode] = useState<AppMode>("watch-query");
  const [activeVfsIds, setActiveVfsIds] = useState<Set<string>>(
    new Set(VFS_CONFIGS.map((c) => c.id)),
  );

  // VFS DB instances are shared between vfs-comparison and raw-benchmark
  // so switching between them doesn't re-initialize the databases.
  const { instances } = useVfsDatabases(mode !== "watch-query");

  const toggleVfsId = (id: string) => {
    setActiveVfsIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size === 1) return prev;
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <PowerSyncContext value={powerSyncDatabase}>
      <div className="app-root">
        <div className="mode-toggle">
          <button
            className={`mode-toggle-button${mode === "watch-query" ? " active" : ""}`}
            onClick={() => setMode("watch-query")}
          >
            Watch Query Comparison
          </button>
          <button
            className={`mode-toggle-button${mode === "vfs-comparison" ? " active" : ""}`}
            onClick={() => setMode("vfs-comparison")}
          >
            VFS Comparison
          </button>
          <button
            className={`mode-toggle-button${mode === "raw-benchmark" ? " active" : ""}`}
            onClick={() => setMode("raw-benchmark")}
          >
            Raw VFS Benchmark
          </button>
        </div>

        {mode === "watch-query" && <AppContent />}
        {mode === "vfs-comparison" && (
          <VfsAppContent
            instances={instances}
            activeVfsIds={activeVfsIds}
            onToggleVfs={toggleVfsId}
          />
        )}
        {mode === "raw-benchmark" && (
          <RawBenchmarkContent
            instances={instances}
            activeVfsIds={activeVfsIds}
            onToggleVfs={toggleVfsId}
          />
        )}
      </div>
    </PowerSyncContext>
  );
}

function AppContent() {
  const db = usePowerSync();
  const { incrementWrites, recordMutationTime } = useMetricsActions();
  const [isInitialized, setIsInitialized] = useState(false);
  const [listId, setListId] = useState("75f89104-d95a-4f16-8309-5363f1bb377a");
  const [throttleMs, setThrottleMs] = useState(100);

  useEffect(() => {
    if (!db) return;

    const disposeMetrics = setupMetricsTracking(
      db,
      incrementWrites,
      recordMutationTime,
    );

    initPowerSync(powerSyncDatabase)
      .then(() => {
        setIsInitialized(true);
      })
      .catch((error) => {
        console.error("Failed to initialize PowerSync:", error);
      });

    return () => {
      disposeMetrics();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  const toggleListId = () =>
    setListId((id) =>
      id === "75f89104-d95a-4f16-8309-5363f1bb377a"
        ? "c1e2f3a4-5678-90ab-cdef-1234567890ab"
        : "75f89104-d95a-4f16-8309-5363f1bb377a",
    );

  if (!isInitialized) {
    return <div style={{ padding: "20px" }}>Initializing PowerSync...</div>;
  }

  return (
    <div className="app-container">
      <ControlPanel
        listId={listId}
        throttleMs={throttleMs}
        onThrottleChange={setThrottleMs}
        onToggleList={toggleListId}
      />

      <main className="main-content">
        <header>
          <h1>Watch Queries Comparison Demo</h1>
          <p className="subtitle">
            Comparing four types of watch query implementations in PowerSync
          </p>
        </header>

        <MetricsDashboard />

        <div className="watch-grid">
          <BasicWatchList listId={listId} throttleMs={throttleMs} />
          <IncrementalWatchList listId={listId} throttleMs={throttleMs} />
          <DifferentialWatchList listId={listId} throttleMs={throttleMs} />
          <TriggerBasedList listId={listId} throttleMs={throttleMs} />
        </div>
      </main>
    </div>
  );
}

interface VfsAppContentProps {
  instances: VFSInstance[];
  activeVfsIds: Set<string>;
  onToggleVfs: (id: string) => void;
}

function VfsAppContent({ instances, activeVfsIds, onToggleVfs }: VfsAppContentProps) {
  const [listId, setListId] = useState("75f89104-d95a-4f16-8309-5363f1bb377a");
  const [throttleMs, setThrottleMs] = useState(100);
  const [queryType, setQueryType] = useState<QueryType>("differential");

  const allReady = instances.length > 0 && instances.every((i) => i.status === "ready");
  const visibleInstances = instances.filter((i) => activeVfsIds.has(i.config.id));
  const readyDbs = instances
    .filter((i) => activeVfsIds.has(i.config.id) && i.status === "ready")
    .map((i) => i.db);

  const toggleListId = () =>
    setListId((id) =>
      id === "75f89104-d95a-4f16-8309-5363f1bb377a"
        ? "c1e2f3a4-5678-90ab-cdef-1234567890ab"
        : "75f89104-d95a-4f16-8309-5363f1bb377a",
    );

  return (
    <div className="app-container">
      <ControlPanel
        listId={listId}
        throttleMs={throttleMs}
        onThrottleChange={setThrottleMs}
        onToggleList={toggleListId}
        databases={readyDbs}
        extraControls={
          <>
            <VfsQueryTypePanel queryType={queryType} onChange={setQueryType} />
            <VfsModePanel activeVfsIds={activeVfsIds} onToggle={onToggleVfs} />
          </>
        }
      />

      <main className="main-content">
        <header>
          <h1>VFS Comparison Demo</h1>
          <p className="subtitle">
            Comparing four VFS backends using the optimal Differential watch strategy
          </p>
        </header>

        {!allReady && (
          <div className="vfs-init-banner">
            Initializing VFS backends… (
            {instances.filter((i) => i.status === "ready").length}/
            {instances.length} ready)
          </div>
        )}

        <MetricsDashboard />

        <div
          className="watch-grid"
          style={{
            gridTemplateColumns: `repeat(${visibleInstances.length}, 1fr)`,
          }}
        >
          {visibleInstances.map((instance) => (
            <VfsWatchColumn
              key={instance.config.id}
              instance={instance}
              listId={listId}
              throttleMs={throttleMs}
              queryType={queryType}
            />
          ))}
        </div>
      </main>
    </div>
  );
}

export default App;
