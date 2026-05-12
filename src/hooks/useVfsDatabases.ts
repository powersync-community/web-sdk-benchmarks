import { useEffect, useRef, useState } from "react";
import { PowerSyncDatabase, WASQLiteOpenFactory } from "@powersync/web";
import { VFS_CONFIGS, vfsDbFilename, type VFSConfig } from "../vfsConfig";
import { initPowerSync } from "../powersync";
import { getSchema, type DataModel } from "../schemas";
import { setupMetricsTracking } from "../utils/metricsWrapper";
import { useMetricsActions } from "../stores/metricsStore";

export type VFSInstanceStatus = "pending" | "initializing" | "ready" | "error";

export interface VFSInstance {
  config: VFSConfig;
  db: PowerSyncDatabase;
  status: VFSInstanceStatus;
  error?: Error;
}

interface VFSDatabasesResult {
  instances: VFSInstance[];
  allReady: boolean;
  anyError: boolean;
}

export function useVfsDatabases(
  enabled: boolean,
  model: DataModel,
): VFSDatabasesResult {
  const { incrementWrites, recordMutationTime } = useMetricsActions();
  const [instances, setInstances] = useState<VFSInstance[]>([]);
  // Keep refs for cleanup across re-renders
  const disposeMetricsRefs = useRef<Array<() => void>>([]);
  const dbsRef = useRef<PowerSyncDatabase[]>([]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const schema = getSchema(model);

    // Create all DB instances immediately. Filenames are per-model so the
    // schema swap opens a fresh file instead of migrating in place (which
    // trips wa-sqlite's strict-WAL check inside `replace_schema`).
    const newInstances: VFSInstance[] = VFS_CONFIGS.map((config) => ({
      config,
      db: new PowerSyncDatabase({
        schema,
        database: new WASQLiteOpenFactory({
          dbFilename: vfsDbFilename(config, model),
          vfs: config.vfs,
        }),
      }),
      status: "pending" as VFSInstanceStatus,
    }));

    dbsRef.current = newInstances.map((i) => i.db);
    setInstances(newInstances);

    // Initialize each DB in parallel, updating status per-instance
    newInstances.forEach((instance, idx) => {
      setInstances((prev) =>
        prev.map((p, i) => (i === idx ? { ...p, status: "initializing" } : p)),
      );

      initPowerSync(instance.db)
        .then(() => {
          const disposeMetrics = setupMetricsTracking(
            instance.db,
            incrementWrites,
            recordMutationTime,
          );
          disposeMetricsRefs.current[idx] = disposeMetrics;

          setInstances((prev) =>
            prev.map((p, i) => (i === idx ? { ...p, status: "ready" } : p)),
          );
        })
        .catch((error: Error) => {
          console.error(`Failed to init VFS ${instance.config.id}:`, error);
          setInstances((prev) =>
            prev.map((p, i) =>
              i === idx ? { ...p, status: "error", error } : p,
            ),
          );
        });
    });

    return () => {
      // Dispose metrics listeners
      disposeMetricsRefs.current.forEach((dispose) => dispose?.());
      disposeMetricsRefs.current = [];
      // Close all DB instances
      dbsRef.current.forEach((db) => {
        db.close().catch(() => {});
      });
      dbsRef.current = [];
      setInstances([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, model]);

  const allReady =
    instances.length === VFS_CONFIGS.length &&
    instances.every((i) => i.status === "ready");
  const anyError = instances.some((i) => i.status === "error");

  return { instances, allReady, anyError };
}
