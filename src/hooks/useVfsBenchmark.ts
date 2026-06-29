import { useState, useRef, useCallback } from "react";
import {
  PowerSyncDatabase,
  WASQLiteOpenFactory,
  WASQLiteVFS,
} from "@powersync/web";
import { type VFSConfig } from "../vfsConfig";
import { initPowerSync } from "../powersync";
import { simpleSchema } from "../schemas";
import { shuffle } from "../utils/shuffle";

// Isolated list_id so benchmark rows never appear in watch query columns
const BENCH_LIST_ID = "00000000-0000-bench-0000-000000000000";

/** Pause between phases to let GC / microtasks settle */
const PHASE_SETTLE_MS = 500;

/**
 * Wipe persisted storage for a VFS's bench DB so each run starts from zero.
 *
 * Required for `OPFSWriteAheadVFS`: its strict-WAL check rejects the deferred
 * write tx that PowerSync core's `powersync_replace_schema` issues on reopen,
 * surfacing as `IOERR`. Applied to every VFS for consistent baselines.
 *
 * File layouts (keyed by `dbFileName`):
 *   IDBBatchAtomicVFS    — IndexedDB database named `dbFileName`
 *   OPFSCoopSyncVFS      — OPFS files: name, name-journal, name-wal
 *   AccessHandlePoolVFS  — OPFS directory `dbFileName` (random-named children)
 *   OPFSWriteAheadVFS    — OPFS files: name, name-wa0, name-wa1
 */
async function purgeVfsStorage(
  vfs: WASQLiteVFS,
  dbFilename: string,
): Promise<void> {
  if (vfs === WASQLiteVFS.IDBBatchAtomicVFS) {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(dbFilename);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve(); // best-effort
      req.onblocked = () => resolve();
    });
    return;
  }

  let root: FileSystemDirectoryHandle;
  try {
    root = await navigator.storage.getDirectory();
  } catch {
    return;
  }

  // Covers main file, suffixed siblings (-journal / -wal / -wa0 / -wa1), and
  // the AccessHandlePool case where `dbFilename` is itself a directory.
  const candidates = [
    dbFilename,
    `${dbFilename}-journal`,
    `${dbFilename}-wal`,
    `${dbFilename}-wa0`,
    `${dbFilename}-wa1`,
  ];
  await Promise.all(
    candidates.map((name) =>
      root.removeEntry(name, { recursive: true }).catch(() => {}),
    ),
  );
}

export type BenchmarkPhase =
  | "warmup"
  | "single-writes"
  | "tx-writes"
  | "reads"
  | "interleaved";
export type BenchmarkStatus = "idle" | "running" | "done" | "error";

export interface BenchmarkConfig {
  durationSec: number;
  txBatchSize: number;
  readSeedCount: number;
  /**
   * SQLite page cache size in KiB, passed straight through to the PowerSync
   * `WASQLiteOpenFactory` (`cacheSizeKb`), which applies it as
   * `PRAGMA cache_size = -${cacheSizeKb}`. The SDK default is 50 MiB (51200),
   * large enough to hold the entire read working set at default seed counts —
   * so the read phase serves pages from memory, not the VFS. Lowering this
   * (e.g. to ~1 KiB) forces real VFS reads and surfaces per-backend I/O cost.
   */
  cacheSizeKb: number;
  /**
   * Number of additional read-only worker connections, passed straight through
   * to `WASQLiteOpenFactory` (`additionalReaders`). **Only `OPFSWriteAheadVFS`
   * acts on this** — the SDK opens this many extra workers, each hosting a
   * `SQLITE_OPEN_READONLY` connection, so reads can run concurrently with a
   * write (and with each other). Every other VFS ignores it and serves all
   * traffic from a single connection.
   *
   * The SDK default is 1. To make the extra readers observable, the interleaved
   * phase issues this many concurrent read loops — at the default of 1 the phase
   * behaves exactly as before; raising it exercises the reader pool.
   */
  additionalReaders: number;
  /**
   * WAL checkpoint strategy. **Only `OPFSWriteAheadVFS` acts on this** — the
   * other VFSs aren't WAL-mode, so `wal_autocheckpoint` / `wal_checkpoint` are
   * harmless no-ops there and we skip issuing them.
   *
   * - `"auto"` — the VFS default (`wal_autocheckpoint=1`): a passive checkpoint
   *   runs after *every* transaction commit. The WAL stays tiny, but each
   *   commit pays the checkpoint cost.
   * - `"manual"` — `wal_autocheckpoint=0` plus a periodic driver that issues
   *   `PRAGMA wal_checkpoint(passive)` every `checkpointIntervalMs`. Commits
   *   skip the per-commit checkpoint; the WAL drains on a timer instead.
   * - `"disabled"` — `wal_autocheckpoint=0` with no driver. Pure write
   *   throughput with an ever-growing WAL — a ceiling, not a real setting.
   */
  checkpointMode: "auto" | "manual" | "disabled";
  /** Interval for the manual checkpoint driver (used only when `checkpointMode === "manual"`). */
  checkpointIntervalMs: number;
  mode: "sequential";
  /** Shuffle instance order to mitigate position-dependent bias (WASM JIT, I/O cache) */
  shuffleOrder: boolean;
  /** Number of iterations to run per instance (results averaged). Odd count recommended. */
  iterations: number;
}

/** PowerSync's own default cache size: 50 MiB (DEFAULT_CACHE_SIZE_KB = 50 * 1024). */
export const DEFAULT_CACHE_SIZE_KB = 50 * 1024;

/** PowerSync's own default reader-worker count for OPFSWriteAheadVFS. */
export const DEFAULT_ADDITIONAL_READERS = 1;

/** Default cadence (ms) for the manual WAL checkpoint driver. */
export const DEFAULT_CHECKPOINT_INTERVAL_MS = 250;

export const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = {
  durationSec: 5,
  txBatchSize: 500,
  readSeedCount: 1000,
  cacheSizeKb: DEFAULT_CACHE_SIZE_KB,
  additionalReaders: DEFAULT_ADDITIONAL_READERS,
  // "auto" mirrors the VFS default (wal_autocheckpoint=1) — unchanged behavior.
  checkpointMode: "auto",
  checkpointIntervalMs: DEFAULT_CHECKPOINT_INTERVAL_MS,
  mode: "sequential",
  shuffleOrder: true,
  iterations: 1,
};

export interface PhaseResult {
  totalMs: number;
  rowsPerSec: number;
  opsCount: number;
  min: number | null;
  median: number | null;
  p95: number | null;
  max: number | null;
  /** For tx-writes: per-transaction commit latencies */
  txCount?: number;
  txMin?: number | null;
  txMedian?: number | null;
  txP95?: number | null;
  txMax?: number | null;
}

export interface InterleavedResult {
  totalMs: number;
  /** Number of concurrent read loops run alongside the single write loop. */
  readConcurrency: number;
  // Read side
  readsCompleted: number;
  readRowsPerSec: number;
  readMin: number | null;
  readMedian: number | null;
  readP95: number | null;
  readMax: number | null;
  // Write side
  writesCompleted: number;
  writeRowsPerSec: number;
  // Per-read snapshots for charting: write count at time of each read
  readSnapshots: { writeCount: number; latencyMs: number }[];
}

export interface CheckpointStats {
  mode: BenchmarkConfig["checkpointMode"];
  /** True only for OPFSWriteAheadVFS; false means the setting was ignored. */
  appliesToVfs: boolean;
  /** Manual checkpoints that completed during the run (manual mode only). */
  checkpointsIssued: number;
  /**
   * Manual mode only: the highest pre-drain WAL size (in *distinct* pages) the
   * checkpoint driver observed — each `PRAGMA wal_checkpoint(passive)` returns
   * the size just before it drains. `null` for auto/disabled (no comparable
   * sample) or if the VFS didn't report it. Note this counts distinct pages, so
   * it reflects the working-set footprint, not cumulative log growth.
   */
  walPagesPeak: number | null;
}

export interface BenchmarkResult {
  singleWrites: PhaseResult;
  txWrites: PhaseResult;
  reads: PhaseResult;
  interleaved: InterleavedResult;
  checkpoint: CheckpointStats;
  config: BenchmarkConfig;
}

export interface BenchmarkInstanceState {
  vfsId: string;
  status: BenchmarkStatus;
  phase: BenchmarkPhase | null;
  result: BenchmarkResult | null;
  error?: Error;
}

function computePercentiles(latencies: number[]): {
  min: number | null;
  median: number | null;
  p95: number | null;
  max: number | null;
} {
  const n = latencies.length;
  if (n === 0) return { min: null, median: null, p95: null, max: null };
  const sorted = [...latencies].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  return {
    min: sorted[0],
    median: n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid],
    p95: sorted[Math.min(Math.floor(n * 0.95), n - 1)],
    max: sorted[n - 1],
  };
}

/** Yield to the event loop so GC and pending microtasks can settle between phases */
function settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, PHASE_SETTLE_MS));
}

async function cleanup(db: PowerSyncDatabase): Promise<void> {
  await db.execute(`DELETE FROM todos WHERE list_id = ?`, [BENCH_LIST_ID]);
}

/**
 * Warmup mirrors all measured phases briefly: single writes, transaction writes,
 * and PK reads — so WASM JIT, page cache, and VFS layers are all primed.
 */
async function warmup(
  db: PowerSyncDatabase,
  cancelledRef: React.RefObject<boolean>,
): Promise<void> {
  await cleanup(db);

  // Single writes (mirrors single-writes phase). We pre-generate IDs and use
  // `db.execute` so the INSERT goes through `writeLock` — `db.get` routes via
  // `readLock`, which on `OPFSWriteAheadVFS` can land on a reader connection
  // opened SQLITE_OPEN_READONLY and fail with "attempt to write a readonly database".
  const singleIds: string[] = [];
  for (let i = 0; i < 50; i++) {
    if (cancelledRef.current) return;
    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO todos (id, description, list_id, completed) VALUES (?, ?, ?, ?)`,
      [id, `warmup-single-${i}`, BENCH_LIST_ID, 0],
    );
    singleIds.push(id);
  }

  // Transaction writes (mirrors tx-writes phase)
  await db.writeTransaction(async (tx) => {
    for (let i = 0; i < 50; i++) {
      if (cancelledRef.current) return;
      await tx.execute(
        `INSERT INTO todos (id, description, list_id, completed) VALUES (uuid(), ?, ?, ?)`,
        [`warmup-tx-${i}`, BENCH_LIST_ID, 0],
      );
    }
  });

  // PK reads (mirrors reads phase)
  for (let i = 0; i < 50; i++) {
    if (cancelledRef.current) return;
    await db.getOptional(`SELECT * FROM todos WHERE id = ?`, [
      singleIds[i % singleIds.length],
    ]);
  }

  await cleanup(db);
}

async function benchSingleWrites(
  db: PowerSyncDatabase,
  durationSec: number,
  cancelledRef: React.RefObject<boolean>,
): Promise<PhaseResult> {
  await cleanup(db);
  const latencies: number[] = [];
  const deadline = performance.now() + durationSec * 1000;
  const start = performance.now();
  let i = 0;
  while (performance.now() < deadline && !cancelledRef.current) {
    const t = performance.now();
    await db.execute(
      `INSERT INTO todos (id, description, list_id, completed) VALUES (uuid(), ?, ?, ?)`,
      [`bench-single-${i}`, BENCH_LIST_ID, 0],
    );
    latencies.push(performance.now() - t);
    i++;
  }
  const totalMs = performance.now() - start;
  await cleanup(db);
  return {
    totalMs,
    rowsPerSec: latencies.length / (totalMs / 1000),
    opsCount: latencies.length,
    ...computePercentiles(latencies),
  };
}

async function benchTxWrites(
  db: PowerSyncDatabase,
  durationSec: number,
  batchSize: number,
  cancelledRef: React.RefObject<boolean>,
): Promise<PhaseResult> {
  await cleanup(db);
  const start = performance.now();
  const deadline = start + durationSec * 1000;
  let count = 0;
  const txLatencies: number[] = [];

  while (performance.now() < deadline && !cancelledRef.current) {
    const txStart = performance.now();
    await db.writeTransaction(async (tx) => {
      for (let j = 0; j < batchSize && performance.now() < deadline; j++) {
        if (cancelledRef.current) return;
        await tx.execute(
          `INSERT INTO todos (id, description, list_id, completed) VALUES (uuid(), ?, ?, ?)`,
          [`bench-tx-${count}`, BENCH_LIST_ID, 0],
        );
        count++;
      }
    });
    txLatencies.push(performance.now() - txStart);
  }

  const totalMs = performance.now() - start;
  const txPercentiles = computePercentiles(txLatencies);
  await cleanup(db);
  return {
    totalMs,
    rowsPerSec: count / (totalMs / 1000),
    opsCount: count,
    // Per-op percentiles not meaningful for batched writes
    min: null,
    median: null,
    p95: null,
    max: null,
    // Per-transaction commit latencies
    txCount: txLatencies.length,
    txMin: txPercentiles.min,
    txMedian: txPercentiles.median,
    txP95: txPercentiles.p95,
    txMax: txPercentiles.max,
  };
}

async function benchReads(
  db: PowerSyncDatabase,
  durationSec: number,
  seedCount: number,
  cancelledRef: React.RefObject<boolean>,
): Promise<PhaseResult> {
  await cleanup(db);
  // Seed rows using SQL uuid(), collect generated IDs for read lookups
  const ids: string[] = [];
  for (let batch = 0; batch < seedCount; batch += 500) {
    if (cancelledRef.current) break;
    await db.writeTransaction(async (tx) => {
      const end = Math.min(batch + 500, seedCount);
      for (let i = batch; i < end; i++) {
        const row = await tx.get<{ id: string }>(
          `INSERT INTO todos (id, description, list_id, completed) VALUES (uuid(), ?, ?, ?) RETURNING id`,
          [`bench-read-${i}`, BENCH_LIST_ID, 0],
        );
        ids.push(row.id);
      }
    });
  }

  // Read in randomized order, not insertion order. The rows were seeded
  // sequentially, so walking them in order is a near-sequential, cache-friendly
  // access pattern (adjacent rows → adjacent pages). Shuffling once defeats that
  // page locality on every pass — surfacing worst-case random-access read cost.
  const readOrder = shuffle(ids);
  const latencies: number[] = [];
  const deadline = performance.now() + durationSec * 1000;
  const start = performance.now();
  let i = 0;
  while (performance.now() < deadline && !cancelledRef.current) {
    const id = readOrder[i % readOrder.length];
    const t = performance.now();
    await db.getOptional(`SELECT * FROM todos WHERE id = ?`, [id]);
    latencies.push(performance.now() - t);
    i++;
  }
  const totalMs = performance.now() - start;
  await cleanup(db);
  return {
    totalMs,
    rowsPerSec: latencies.length / (totalMs / 1000),
    opsCount: latencies.length,
    ...computePercentiles(latencies),
  };
}

/**
 * Interleaved read/write benchmark.
 *
 * Concurrency: `readConcurrency` independent read loops run alongside one write
 * loop, all via Promise.all. For every VFS except OPFSWriteAheadVFS the SDK has
 * a single connection, so these all serialize through one worker's message
 * queue — raising readConcurrency just adds queueing, not parallel I/O.
 * OPFSWriteAheadVFS is the exception: with `additionalReaders` extra read-only
 * workers, concurrent reads genuinely run in parallel with the write (and each
 * other), so aggregate read throughput scales with readConcurrency.
 */
async function benchInterleaved(
  db: PowerSyncDatabase,
  durationSec: number,
  readSeedCount: number,
  readConcurrency: number,
  cancelledRef: React.RefObject<boolean>,
): Promise<InterleavedResult> {
  await cleanup(db);

  // Use the same seed count as the reads phase for comparable cache behavior
  const seedCount = readSeedCount;
  const readIds: string[] = [];
  for (let batch = 0; batch < seedCount; batch += 500) {
    if (cancelledRef.current) break;
    await db.writeTransaction(async (tx) => {
      const end = Math.min(batch + 500, seedCount);
      for (let i = batch; i < end; i++) {
        const row = await tx.get<{ id: string }>(
          `INSERT INTO todos (id, description, list_id, completed) VALUES (uuid(), ?, ?, ?) RETURNING id`,
          [`interleaved-read-${i}`, BENCH_LIST_ID, 0],
        );
        readIds.push(row.id);
      }
    });
  }

  // Randomize read order (see benchReads): walk the seeded rows in shuffled
  // order so reads measure worst-case random access, not sequential locality.
  const readOrder = shuffle(readIds);

  const readLatencies: number[] = [];
  const readSnapshots: { writeCount: number; latencyMs: number }[] = [];
  let writesCompleted = 0;

  const deadline = performance.now() + durationSec * 1000;
  const start = performance.now();

  // Write loop
  const writeLoop = (async () => {
    while (performance.now() < deadline && !cancelledRef.current) {
      await db.execute(
        `INSERT INTO todos (id, description, list_id, completed) VALUES (uuid(), ?, ?, ?)`,
        ["interleaved-write", BENCH_LIST_ID, 0],
      );
      writesCompleted++;
    }
  })();

  // Read loops — `readConcurrency` of them, each striding by the loop count so
  // they don't all hammer the same id. On OPFSWriteAheadVFS these fan out across
  // the reader-worker pool; on every other VFS they serialize through one worker.
  const loopCount = Math.max(1, readConcurrency);
  const readLoops = Array.from({ length: loopCount }, (_, loopIdx) =>
    (async () => {
      let i = loopIdx;
      while (performance.now() < deadline && !cancelledRef.current) {
        const id = readOrder[i % readOrder.length];
        const writeCountAtRead = writesCompleted;
        const t = performance.now();
        await db.getOptional(`SELECT * FROM todos WHERE id = ?`, [id]);
        const latencyMs = performance.now() - t;
        readLatencies.push(latencyMs);
        readSnapshots.push({ writeCount: writeCountAtRead, latencyMs });
        i += loopCount;
      }
    })(),
  );

  await Promise.all([writeLoop, ...readLoops]);
  const totalMs = performance.now() - start;

  await cleanup(db);

  return {
    totalMs,
    readConcurrency: loopCount,
    readsCompleted: readLatencies.length,
    readRowsPerSec: readLatencies.length / (totalMs / 1000),
    ...prefixKeys(computePercentiles(readLatencies), "read"),
    writesCompleted,
    writeRowsPerSec: writesCompleted / (totalMs / 1000),
    readSnapshots,
  };
}

function prefixKeys(
  p: {
    min: number | null;
    median: number | null;
    p95: number | null;
    max: number | null;
  },
  _prefix: "read",
): {
  readMin: number | null;
  readMedian: number | null;
  readP95: number | null;
  readMax: number | null;
} {
  return {
    readMin: p.min,
    readMedian: p.median,
    readP95: p.p95,
    readMax: p.max,
  };
}

/**
 * Pull the WAL page count out of a `PRAGMA wal_checkpoint(...)` result.
 *
 * OPFSWriteAheadVFS overrides the pragma to return the pre-checkpoint WAL size
 * (in pages) as a single string-valued row; SQLite surfaces it under the
 * `wal_checkpoint` column. Defensive against shape differences and non-WAL VFSs
 * (which return SQLite's standard 3-column busy/log/checkpointed row instead).
 */
function parseWalPages(result: unknown): number | null {
  const row = (result as { rows?: { _array?: Record<string, unknown>[] } })?.rows
    ?._array?.[0];
  if (!row) return null;
  const first = Object.values(row)[0];
  const n =
    typeof first === "string"
      ? parseInt(first, 10)
      : typeof first === "number"
        ? first
        : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Issue a passive checkpoint on the write connection. Routed through
 * `db.execute` (writeLock) — a checkpoint writes pages back to the main file, so
 * it must not land on a SQLITE_OPEN_READONLY reader worker. Returns the
 * pre-checkpoint WAL size in pages, or null if unavailable.
 */
async function checkpointPassive(db: PowerSyncDatabase): Promise<number | null> {
  const r = await db.execute(`PRAGMA wal_checkpoint(passive)`);
  return parseWalPages(r);
}

interface CheckpointDriver {
  stop: () => void;
  getStats: () => { issued: number; walPagesPeak: number | null };
}

/**
 * The "dedicated checkpoint worker": a timer that issues passive checkpoints
 * every `intervalMs` instead of letting the VFS checkpoint on each commit. The
 * actual checkpoint I/O runs asynchronously on the VFS's own write worker (via
 * its `pendingOps` queue), so this only kicks it off. An in-flight guard keeps
 * checkpoints from stacking when one runs longer than the interval.
 */
function startCheckpointDriver(
  db: PowerSyncDatabase,
  intervalMs: number,
  cancelledRef: React.RefObject<boolean>,
): CheckpointDriver {
  let issued = 0;
  let walPagesPeak: number | null = null;
  let inFlight = false;
  const handle = setInterval(() => {
    if (inFlight || cancelledRef.current) return;
    inFlight = true;
    checkpointPassive(db)
      .then((pages) => {
        issued++;
        if (pages != null && (walPagesPeak == null || pages > walPagesPeak)) {
          walPagesPeak = pages;
        }
      })
      .catch(() => {
        // best-effort; a checkpoint racing teardown can reject harmlessly
      })
      .finally(() => {
        inFlight = false;
      });
  }, intervalMs);
  return {
    stop: () => clearInterval(handle),
    getStats: () => ({ issued, walPagesPeak }),
  };
}

export function useVfsBenchmark() {
  const [states, setStates] = useState<Map<string, BenchmarkInstanceState>>(
    new Map(),
  );
  const [isRunning, setIsRunning] = useState(false);
  const cancelledRef = useRef(false);

  const patchState = (
    vfsId: string,
    patch: Partial<BenchmarkInstanceState>,
  ) => {
    if (cancelledRef.current) return;
    setStates((prev) => {
      const next = new Map(prev);
      const cur = next.get(vfsId) ?? {
        vfsId,
        status: "idle" as const,
        phase: null,
        result: null,
      };
      next.set(vfsId, { ...cur, ...patch });
      return next;
    });
  };

  const run = useCallback(
    async (vfsConfigs: VFSConfig[], config: BenchmarkConfig) => {
      cancelledRef.current = false;
      setIsRunning(true);

      const initial = new Map<string, BenchmarkInstanceState>();
      vfsConfigs.forEach((c) =>
        initial.set(c.id, {
          vfsId: c.id,
          status: "running",
          phase: "warmup",
          result: null,
        }),
      );
      setStates(initial);

      // Shuffle to mitigate position-dependent bias (WASM JIT, OS page cache, I/O scheduling)
      const ordered = config.shuffleOrder
        ? [...vfsConfigs].sort(() => Math.random() - 0.5)
        : vfsConfigs;

      for (let idx = 0; idx < ordered.length; idx++) {
        const vfsCfg = ordered[idx];
        if (cancelledRef.current) break;

        // Allow GC and worker message queues to fully drain between instances
        if (idx > 0) {
          await new Promise((r) => setTimeout(r, 1500));
        }

        let db: PowerSyncDatabase | null = null;
        let checkpointDriver: CheckpointDriver | null = null;
        const isWal = vfsCfg.vfs === WASQLiteVFS.OPFSWriteAheadVFS;
        try {
          // Create an isolated DB instance — only one worker + WASM instance alive at a time
          patchState(vfsCfg.id, { phase: "warmup", status: "running" });
          // Wipe any leftover bench file before opening. OPFSWriteAheadVFS
          // rejects the deferred-tx write that `powersync_replace_schema`
          // issues on reopen (IOERR); starting fresh sidesteps it and also
          // gives every VFS a clean baseline.
          await purgeVfsStorage(vfsCfg.vfs, vfsCfg.benchDbFilename);
          db = new PowerSyncDatabase({
            schema: simpleSchema,
            database: new WASQLiteOpenFactory({
              dbFilename: vfsCfg.benchDbFilename,
              vfs: vfsCfg.vfs,
              // Applied by the SDK as `PRAGMA cache_size = -${cacheSizeKb}`.
              // Shrinking this is what makes the read phase actually hit the VFS.
              cacheSizeKb: config.cacheSizeKb,
              // Only OPFSWriteAheadVFS opens these extra read-only workers; all
              // other VFSs ignore it. Exercised by the interleaved phase's
              // concurrent read loops.
              additionalReaders: config.additionalReaders,
            }),
          });
          await initPowerSync(db);

          // Tier 3: WAL checkpoint strategy. Only OPFSWriteAheadVFS is WAL-mode;
          // for every other VFS these pragmas are no-ops, so we skip them and
          // leave the checkpoint stats marked "not applicable".
          if (isWal && config.checkpointMode !== "auto") {
            // Stop the VFS from checkpointing after every commit.
            await db.execute(`PRAGMA wal_autocheckpoint=0`);
          }
          if (isWal && config.checkpointMode === "manual") {
            checkpointDriver = startCheckpointDriver(
              db,
              config.checkpointIntervalMs,
              cancelledRef,
            );
          }

          await warmup(db, cancelledRef);
          if (cancelledRef.current) break;
          await settle();

          patchState(vfsCfg.id, { phase: "single-writes" });
          const singleWrites = await benchSingleWrites(
            db,
            config.durationSec,
            cancelledRef,
          );
          if (cancelledRef.current) break;
          await settle();

          patchState(vfsCfg.id, { phase: "tx-writes" });
          const txWrites = await benchTxWrites(
            db,
            config.durationSec,
            config.txBatchSize,
            cancelledRef,
          );
          if (cancelledRef.current) break;
          await settle();

          patchState(vfsCfg.id, { phase: "reads" });
          const reads = await benchReads(
            db,
            config.durationSec,
            config.readSeedCount,
            cancelledRef,
          );
          if (cancelledRef.current) break;
          await settle();

          patchState(vfsCfg.id, { phase: "interleaved" });
          const interleaved = await benchInterleaved(
            db,
            config.durationSec,
            config.readSeedCount,
            config.additionalReaders,
            cancelledRef,
          );
          if (cancelledRef.current) break;

          // Collect checkpoint stats before tearing down the driver.
          let checkpointsIssued = 0;
          let walPagesPeak: number | null = null;
          // Peak WAL is only meaningful (and self-consistent) when the manual
          // driver samples it via its own passive checkpoints — every sample is
          // the pre-drain high-water mark. We deliberately do NOT take an
          // end-of-run reading for auto/disabled: that single quiescent sample
          // isn't comparable to the driver's peak, and `getWriteAheadSize()`
          // counts *distinct* pages (not total log growth), so it saturates at
          // the working-set size rather than growing without bound.
          if (checkpointDriver) {
            const s = checkpointDriver.getStats();
            checkpointsIssued = s.issued;
            walPagesPeak = s.walPagesPeak;
            checkpointDriver.stop();
            checkpointDriver = null;
          }

          patchState(vfsCfg.id, {
            status: "done",
            phase: null,
            result: {
              singleWrites,
              txWrites,
              reads,
              interleaved,
              checkpoint: {
                mode: config.checkpointMode,
                appliesToVfs: isWal,
                checkpointsIssued,
                walPagesPeak,
              },
              config,
            },
          });
        } catch (error) {
          patchState(vfsCfg.id, {
            status: "error",
            phase: null,
            error: error as Error,
          });
        } finally {
          // Stop the checkpoint driver before closing (covers error/cancel paths).
          if (checkpointDriver) {
            checkpointDriver.stop();
            checkpointDriver = null;
          }
          // Tear down the DB so the next instance runs with zero contention
          if (db) {
            try {
              await db.close();
            } catch {
              // best-effort
            }
            db = null;
          }
        }
      }

      if (!cancelledRef.current) setIsRunning(false);
    },
    [],
  ); // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setIsRunning(false);
    // Clear spinners on any instance still mid-run — patchState ignores writes
    // after cancellation, so reset them here directly.
    setStates((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [id, state] of prev) {
        if (state.status === "running") {
          next.set(id, { ...state, status: "idle", phase: null });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  return { states, isRunning, run, cancel };
}
