import { WASQLiteVFS } from "@powersync/web";

export interface VFSConfig {
  id: string;
  label: string;
  vfs: WASQLiteVFS;
  dbFilename: string;
}

export const VFS_CONFIGS: VFSConfig[] = [
  {
    id: "idb-batch",
    label: "IDBBatchAtomicVFS",
    vfs: WASQLiteVFS.IDBBatchAtomicVFS,
    dbFilename: "vfs-compare-idb-batch.db",
  },
  {
    id: "opfs-coop",
    label: "OPFSCoopSyncVFS",
    vfs: WASQLiteVFS.OPFSCoopSyncVFS,
    dbFilename: "vfs-compare-opfs-coop.db",
  },
  {
    id: "access-handle-pool",
    label: "AccessHandlePoolVFS",
    vfs: WASQLiteVFS.AccessHandlePoolVFS,
    dbFilename: "vfs-compare-access-handle.db",
  },
  {
    id: "opfs-wal",
    label: "OPFSWriteAheadVFS",
    vfs: WASQLiteVFS.OPFSWriteAheadVFS,
    dbFilename: "vfs-compare-opfs-wal.db",
  },
];
