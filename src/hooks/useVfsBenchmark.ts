import { useState, useRef, useCallback } from "react";
import { PowerSyncDatabase, WASQLiteOpenFactory } from "@powersync/web";
import { type VFSConfig } from "../vfsConfig";
import { initPowerSync } from "../powersync";
import { simpleSchema } from "../schemas";

// Isolated list_id so benchmark rows never appear in watch query columns
const BENCH_LIST_ID = "00000000-0000-bench-0000-000000000000";

/** Pause between phases to let GC / microtasks settle */
const PHASE_SETTLE_MS = 500;

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
  mode: "sequential";
  /** Shuffle instance order to mitigate position-dependent bias (WASM JIT, I/O cache) */
  shuffleOrder: boolean;
  /** Number of iterations to run per instance (results averaged). Odd count recommended. */
  iterations: number;
}

export const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = {
  durationSec: 5,
  txBatchSize: 500,
  readSeedCount: 1000,
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

export interface BenchmarkResult {
  singleWrites: PhaseResult;
  txWrites: PhaseResult;
  reads: PhaseResult;
  interleaved: InterleavedResult;
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

  // Single writes (mirrors single-writes phase)
  const singleIds: string[] = [];
  for (let i = 0; i < 50; i++) {
    if (cancelledRef.current) return;
    const row = await db.get<{ id: string }>(
      `INSERT INTO todos (id, description, list_id, completed) VALUES (uuid(), ?, ?, ?) RETURNING id`,
      [`warmup-single-${i}`, BENCH_LIST_ID, 0],
    );
    singleIds.push(row.id);
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

  const latencies: number[] = [];
  const deadline = performance.now() + durationSec * 1000;
  const start = performance.now();
  let i = 0;
  while (performance.now() < deadline && !cancelledRef.current) {
    const id = ids[i % ids.length];
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
 * NOTE: PowerSync's web SDK proxies all SQL through a single Web Worker,
 * so Promise.all does NOT achieve true parallelism. Both loops are serialized
 * through the worker's message queue. This measures how read latency is
 * affected by interleaved write operations, not true concurrent I/O.
 */
async function benchInterleaved(
  db: PowerSyncDatabase,
  durationSec: number,
  readSeedCount: number,
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

  // Read loop
  const readLoop = (async () => {
    let i = 0;
    while (performance.now() < deadline && !cancelledRef.current) {
      const id = readIds[i % readIds.length];
      const writeCountAtRead = writesCompleted;
      const t = performance.now();
      await db.getOptional(`SELECT * FROM todos WHERE id = ?`, [id]);
      const latencyMs = performance.now() - t;
      readLatencies.push(latencyMs);
      readSnapshots.push({ writeCount: writeCountAtRead, latencyMs });
      i++;
    }
  })();

  await Promise.all([writeLoop, readLoop]);
  const totalMs = performance.now() - start;

  await cleanup(db);

  return {
    totalMs,
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
        try {
          // Create an isolated DB instance — only one worker + WASM instance alive at a time
          patchState(vfsCfg.id, { phase: "warmup", status: "running" });
          db = new PowerSyncDatabase({
            schema: simpleSchema,
            database: new WASQLiteOpenFactory({
              dbFilename: vfsCfg.benchDbFilename,
              vfs: vfsCfg.vfs,
            }),
          });
          await initPowerSync(db);

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
            cancelledRef,
          );
          if (cancelledRef.current) break;

          patchState(vfsCfg.id, {
            status: "done",
            phase: null,
            result: { singleWrites, txWrites, reads, interleaved, config },
          });
        } catch (error) {
          patchState(vfsCfg.id, {
            status: "error",
            phase: null,
            error: error as Error,
          });
        } finally {
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
