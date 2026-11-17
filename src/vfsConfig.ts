import { WASQLiteVFS, type WebSQLOpenOptions } from "@powersync/web";
import type { DataModel } from "./schemas";

export interface VFSConfig {
  id: string;
  label: string;
  vfs: WASQLiteVFS;
  /** Filename used by the live VFS comparison view (per-model — see `vfsDbFilename`) */
  dbFilename: string;
  /** Separate filename used by the isolated benchmark runner */
  benchDbFilename: string;
  /** False for in-memory backends: nothing on disk to purge, data is gone on close. */
  persistent: boolean;
  /**
   * Extra `database` open options for this backend. The in-memory VFS uses
   * these to pick where SQLite runs: a dedicated worker (`enableMultiTabs:
   * false`) or the tab itself (`useWebWorker: false` as well).
   */
  openOptions?: Pick<WebSQLOpenOptions, "enableMultiTabs" | "useWebWorker">;
  /** Short caveat shown on the benchmark card. */
  note?: string;
}

/**
 * VFS comparison filenames are namespaced per data model so a schema swap
 * opens a fresh DB. See `defaultDbFilename` in `powersync.ts` for context.
 */
export function vfsDbFilename(config: VFSConfig, model: DataModel): string {
  return `${config.dbFilename.replace(/\.db$/, "")}-${model}.db`;
}

export const VFS_CONFIGS: VFSConfig[] = [
  {
    id: "idb-batch",
    label: "IDBBatchAtomicVFS",
    vfs: WASQLiteVFS.IDBBatchAtomicVFS,
    dbFilename: "vfs-compare-idb-batch.db",
    benchDbFilename: "bench-idb-batch.db",
    persistent: true,
  },
  {
    id: "opfs-coop",
    label: "OPFSCoopSyncVFS",
    vfs: WASQLiteVFS.OPFSCoopSyncVFS,
    dbFilename: "vfs-compare-opfs-coop.db",
    benchDbFilename: "bench-opfs-coop.db",
    persistent: true,
  },
  {
    id: "access-handle-pool",
    label: "AccessHandlePoolVFS",
    vfs: WASQLiteVFS.AccessHandlePoolVFS,
    dbFilename: "vfs-compare-access-handle.db",
    benchDbFilename: "bench-access-handle.db",
    persistent: true,
  },
  {
    id: "opfs-wal",
    label: "OPFSWriteAheadVFS",
    vfs: WASQLiteVFS.OPFSWriteAheadVFS,
    dbFilename: "vfs-compare-opfs-wal.db",
    benchDbFilename: "bench-opfs-wal.db",
    persistent: true,
  },
  {
    id: "opfs-simple",
    label: "SimpleOpfsVFS",
    vfs: WASQLiteVFS.SimpleOpfsVFS,
    dbFilename: "vfs-compare-opfs-simple.db",
    benchDbFilename: "bench-opfs-simple.db",
    persistent: true,
  },
  {
    id: "memory-worker",
    label: "InMemoryVFS (worker)",
    vfs: WASQLiteVFS.InMemoryVfs,
    dbFilename: "vfs-compare-memory-worker.db",
    benchDbFilename: "bench-memory-worker.db",
    persistent: false,
    openOptions: { enableMultiTabs: false },
    note: "No persistence. Same worker round-trip as the other backends with zero storage I/O, so the gap to each persistent VFS is its storage cost.",
  },
  {
    id: "memory-main",
    label: "InMemoryVFS (main thread)",
    vfs: WASQLiteVFS.InMemoryVfs,
    dbFilename: "vfs-compare-memory-main.db",
    benchDbFilename: "bench-memory-main.db",
    persistent: false,
    openOptions: { enableMultiTabs: false, useWebWorker: false },
    note: "No persistence. SQLite runs synchronously in the tab with no worker round-trip, so this is not like-for-like with the worker-hosted backends.",
  },
];
