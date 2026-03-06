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

function App() {
  return (
    <PowerSyncContext value={powerSyncDatabase}>
      <AppContent />
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

    // Set up metrics tracking using PowerSync events (proper approach)
    const disposeMetrics = setupMetricsTracking(
      db,
      incrementWrites,
      recordMutationTime,
    );

    // Initialize PowerSync
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

export default App;
