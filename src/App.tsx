import "./App.css";
import { PowerSyncContext, usePowerSync } from "@powersync/react";
import { createDatabase, initPowerSync } from "./powersync";
import { useEffect, useState } from "react";
import { PowerSyncDatabase } from "@powersync/web";
import { useMetricsActions } from "./stores/metricsStore";
import { useDataModelStore } from "./stores/dataModelStore";
import { type DataModel } from "./schemas";
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
  const model = useDataModelStore((s) => s.model);

  // Only initialize VFS DB instances for the live VFS comparison view.
  // The raw benchmark creates and destroys its own isolated instances.
  const { instances } = useVfsDatabases(mode === "vfs-comparison", model);

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

      {mode === "watch-query" && <AppContent model={model} />}
      {mode === "vfs-comparison" && (
        <VfsAppContent
          instances={instances}
          activeVfsIds={activeVfsIds}
          onToggleVfs={toggleVfsId}
          model={model}
        />
      )}
      {mode === "raw-benchmark" && (
        <RawBenchmarkContent
          activeVfsIds={activeVfsIds}
          onToggleVfs={toggleVfsId}
        />
      )}
    </div>
  );
}

interface AppContentProps {
  model: DataModel;
}

function AppContent({ model }: AppContentProps) {
  const { incrementWrites, recordMutationTime, resetAllMetrics } =
    useMetricsActions();
  const [dbState, setDbState] = useState<{
    db: PowerSyncDatabase;
    isInitialized: boolean;
  } | null>(null);
  const [listId, setListId] = useState("75f89104-d95a-4f16-8309-5363f1bb377a");
  const [throttleMs, setThrottleMs] = useState(100);

  // Reset metrics whenever the schema swaps — mixed-schema counters are meaningless.
  useEffect(() => {
    resetAllMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  useEffect(() => {
    const db = createDatabase({ model });
    let cancelled = false;
    let disposeMetrics: (() => void) | null = null;

    setDbState({ db, isInitialized: false });

    initPowerSync(db)
      .then(() => {
        if (cancelled) return;
        disposeMetrics = setupMetricsTracking(
          db,
          incrementWrites,
          recordMutationTime,
        );
        setDbState({ db, isInitialized: true });
      })
      .catch((error) => {
        console.error("Failed to initialize PowerSync:", error);
      });

    return () => {
      cancelled = true;
      disposeMetrics?.();
      db.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  const toggleListId = () =>
    setListId((id) =>
      id === "75f89104-d95a-4f16-8309-5363f1bb377a"
        ? "c1e2f3a4-5678-90ab-cdef-1234567890ab"
        : "75f89104-d95a-4f16-8309-5363f1bb377a",
    );

  if (!dbState) {
    return <div style={{ padding: "20px" }}>Initializing PowerSync...</div>;
  }

  return (
    <PowerSyncContext value={dbState.db}>
      <AppContentInner
        isInitialized={dbState.isInitialized}
        listId={listId}
        throttleMs={throttleMs}
        onThrottleChange={setThrottleMs}
        onToggleList={toggleListId}
        model={model}
      />
    </PowerSyncContext>
  );
}

interface AppContentInnerProps {
  isInitialized: boolean;
  listId: string;
  throttleMs: number;
  onThrottleChange: (v: number) => void;
  onToggleList: () => void;
  model: DataModel;
}

function AppContentInner({
  isInitialized,
  listId,
  throttleMs,
  onThrottleChange,
  onToggleList,
  model,
}: AppContentInnerProps) {
  // Touch usePowerSync so context consumers see swap reactively (no-op otherwise).
  usePowerSync();

  return (
    <div className="app-container">
      <ControlPanel
        listId={listId}
        throttleMs={throttleMs}
        onThrottleChange={onThrottleChange}
        onToggleList={onToggleList}
        model={model}
      />

      <main className="main-content">
        <header>
          <h1>Watch Queries Comparison Demo</h1>
          <p className="subtitle">
            Comparing four types of watch query implementations in PowerSync
          </p>
        </header>

        {!isInitialized && (
          <div className="vfs-init-banner">
            Initializing PowerSync ({model} schema)…
          </div>
        )}

        <MetricsDashboard />

        <div className="watch-grid">
          <BasicWatchList
            listId={listId}
            throttleMs={throttleMs}
            model={model}
          />
          <IncrementalWatchList
            listId={listId}
            throttleMs={throttleMs}
            model={model}
          />
          <DifferentialWatchList
            listId={listId}
            throttleMs={throttleMs}
            model={model}
          />
          <TriggerBasedList
            listId={listId}
            throttleMs={throttleMs}
            model={model}
          />
        </div>
      </main>
    </div>
  );
}

interface VfsAppContentProps {
  instances: VFSInstance[];
  activeVfsIds: Set<string>;
  onToggleVfs: (id: string) => void;
  model: DataModel;
}

function VfsAppContent({
  instances,
  activeVfsIds,
  onToggleVfs,
  model,
}: VfsAppContentProps) {
  const { resetAllMetrics } = useMetricsActions();
  const [listId, setListId] = useState("75f89104-d95a-4f16-8309-5363f1bb377a");
  const [throttleMs, setThrottleMs] = useState(100);
  const [queryType, setQueryType] = useState<QueryType>("differential");

  useEffect(() => {
    resetAllMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  const allReady =
    instances.length > 0 && instances.every((i) => i.status === "ready");
  const visibleInstances = instances.filter((i) =>
    activeVfsIds.has(i.config.id),
  );
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
        model={model}
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
            Comparing four VFS backends using the optimal Differential watch
            strategy
          </p>
        </header>

        {!allReady && (
          <div className="vfs-init-banner">
            Initializing VFS backends ({model} schema)… (
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
              model={model}
            />
          ))}
        </div>
      </main>
    </div>
  );
}

export default App;
