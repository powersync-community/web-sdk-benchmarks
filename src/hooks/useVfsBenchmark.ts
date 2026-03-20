import { useState, useRef, useCallback } from "react";
import { PowerSyncDatabase } from "@powersync/web";
import { type VFSInstance } from "./useVfsDatabases";

// Isolated list_id so benchmark rows never appear in watch query columns
const BENCH_LIST_ID = "00000000-0000-bench-0000-000000000000";

export type BenchmarkPhase = "warmup" | "single-writes" | "tx-writes" | "reads" | "concurrency";
export type BenchmarkStatus = "idle" | "running" | "done" | "error";

export const WRITE_PRESSURE_PRESETS = [0, 1, 2, 5] as const;

export interface BenchmarkConfig {
  ops: number;
  writePressure: number; // concurrency writes = ops * writePressure
  mode: "sequential";
}

export const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = {
  ops: 100,
  writePressure: 2,
  mode: "sequential",
};

export interface PhaseResult {
  totalMs: number;
  rowsPerSec: number;
  opsCount: number;
  // null for tx-writes (single commit, no per-op measurement)
  min: number | null;
  median: number | null;
  p95: number | null;
  max: number | null;
}

export interface ConcurrencyResult {
  totalMs: number;
  // Read side
  readsCompleted: number;
  readRowsPerSec: number;
  readMin: number | null;
  readMedian: number | null;
  readP95: number | null;
  readMax: number | null;
  // Write pressure context
  writesCompleted: number;
  writesCapped: boolean;
  writeRowsPerSec: number;
  // Per-read snapshots for charting: write count at time of each read
  readSnapshots: { writeCount: number; latencyMs: number }[];
}

export interface BenchmarkResult {
  singleWrites: PhaseResult;
  txWrites: PhaseResult;
  reads: PhaseResult;
  concurrency: ConcurrencyResult;
  config: BenchmarkConfig;
}

export interface BenchmarkInstanceState {
  vfsId: string;
  status: BenchmarkStatus;
  phase: BenchmarkPhase | null;
  result: BenchmarkResult | null;
  error?: Error;
}

function computePerOpStats(latencies: number[], totalMs: number): Omit<PhaseResult, "opsCount"> {
  const n = latencies.length;
  if (n === 0) {
    return { totalMs, rowsPerSec: 0, min: null, median: null, p95: null, max: null };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median = n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return {
    totalMs,
    rowsPerSec: n / (totalMs / 1000),
    min: sorted[0],
    median,
    p95: sorted[Math.min(Math.floor(n * 0.95), n - 1)],
    max: sorted[n - 1],
  };
}

/** Small throwaway run to warm up the VFS / WASM layer */
async function warmup(db: PowerSyncDatabase): Promise<void> {
  const warmupN = 10;
  await db.execute(`DELETE FROM todos WHERE list_id = ?`, [BENCH_LIST_ID]);
  await db.writeTransaction(async (tx) => {
    for (let i = 0; i < warmupN; i++) {
      await tx.execute(
        `INSERT INTO todos (id, description, list_id, completed) VALUES (?, ?, ?, ?)`,
        [crypto.randomUUID(), `warmup-${i}`, BENCH_LIST_ID, 0],
      );
    }
  });
  // A few reads
  await db.getAll(`SELECT * FROM todos WHERE list_id = ?`, [BENCH_LIST_ID]);
  await db.execute(`DELETE FROM todos WHERE list_id = ?`, [BENCH_LIST_ID]);
}

async function benchSingleWrites(db: PowerSyncDatabase, n: number): Promise<PhaseResult> {
  await db.execute(`DELETE FROM todos WHERE list_id = ?`, [BENCH_LIST_ID]);
  const latencies: number[] = [];
  const start = performance.now();
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    await db.execute(
      `INSERT INTO todos (id, description, list_id, completed) VALUES (?, ?, ?, ?)`,
      [crypto.randomUUID(), `bench-single-${i}`, BENCH_LIST_ID, 0],
    );
    latencies.push(performance.now() - t);
  }
  const stats = computePerOpStats(latencies, performance.now() - start);
  return { ...stats, opsCount: n };
}

async function benchTxWrites(db: PowerSyncDatabase, n: number): Promise<PhaseResult> {
  await db.execute(`DELETE FROM todos WHERE list_id = ?`, [BENCH_LIST_ID]);
  const start = performance.now();
  await db.writeTransaction(async (tx) => {
    for (let i = 0; i < n; i++) {
      await tx.execute(
        `INSERT INTO todos (id, description, list_id, completed) VALUES (?, ?, ?, ?)`,
        [crypto.randomUUID(), `bench-tx-${i}`, BENCH_LIST_ID, 0],
      );
    }
  });
  const totalMs = performance.now() - start;
  return { totalMs, rowsPerSec: n / (totalMs / 1000), opsCount: n, min: null, median: null, p95: null, max: null };
}

async function benchReads(db: PowerSyncDatabase, n: number): Promise<PhaseResult> {
  // Read from rows left by benchTxWrites
  const rows = await db.getAll<{ id: string }>(
    `SELECT id FROM todos WHERE list_id = ? LIMIT ?`,
    [BENCH_LIST_ID, n],
  );
  const latencies: number[] = [];
  const start = performance.now();
  for (const row of rows) {
    const t = performance.now();
    await db.getOptional(`SELECT * FROM todos WHERE id = ?`, [row.id]);
    latencies.push(performance.now() - t);
  }
  const totalMs = performance.now() - start;
  await db.execute(`DELETE FROM todos WHERE list_id = ?`, [BENCH_LIST_ID]);
  const stats = computePerOpStats(latencies, totalMs);
  return { ...stats, opsCount: rows.length };
}

async function benchConcurrency(db: PowerSyncDatabase, concurrentReads: number, concurrentWrites: number): Promise<ConcurrencyResult> {
  // Seed a small fixed set of rows to read from — kept stable throughout the test
  const readIds: string[] = [];
  const seedCount = Math.min(50, concurrentReads);
  await db.writeTransaction(async (tx) => {
    for (let i = 0; i < seedCount; i++) {
      const id = crypto.randomUUID();
      readIds.push(id);
      await tx.execute(
        `INSERT INTO todos (id, description, list_id, completed) VALUES (?, ?, ?, ?)`,
        [id, `conc-read-${i}`, BENCH_LIST_ID, 0],
      );
    }
  });

  const readLatencies: number[] = [];
  const readSnapshots: { writeCount: number; latencyMs: number }[] = [];
  let writesCompleted = 0;

  // Write loop — exactly X writes
  const writeLoop = (async () => {
    for (let i = 0; i < concurrentWrites; i++) {
      await db.execute(
        `INSERT INTO todos (id, description, list_id, completed) VALUES (?, ?, ?, ?)`,
        [crypto.randomUUID(), "conc-write", BENCH_LIST_ID, 0],
      );
      writesCompleted++;
    }
  })();

  // Read loop — exactly N reads, cycling through seeded rows
  const readLoop = (async () => {
    for (let i = 0; i < concurrentReads; i++) {
      const id = readIds[i % readIds.length];
      const writeCountAtRead = writesCompleted;
      const t = performance.now();
      await db.getOptional(`SELECT * FROM todos WHERE id = ?`, [id]);
      const latencyMs = performance.now() - t;
      readLatencies.push(latencyMs);
      readSnapshots.push({ writeCount: writeCountAtRead, latencyMs });
    }
  })();

  // Both loops run concurrently — phase ends when both complete
  const start = performance.now();
  await Promise.all([writeLoop, readLoop]);
  const totalMs = performance.now() - start;

  await db.execute(`DELETE FROM todos WHERE list_id = ?`, [BENCH_LIST_ID]);

  const sorted = [...readLatencies].sort((a, b) => a - b);
  const nr = sorted.length;
  const mid = Math.floor(nr / 2);

  return {
    totalMs,
    readsCompleted: nr,
    readRowsPerSec: nr / (totalMs / 1000),
    readMin: nr > 0 ? sorted[0] : null,
    readMedian: nr > 0 ? (nr % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]) : null,
    readP95: nr > 0 ? sorted[Math.min(Math.floor(nr * 0.95), nr - 1)] : null,
    readMax: nr > 0 ? sorted[nr - 1] : null,
    writesCompleted,
    writesCapped: false,
    writeRowsPerSec: writesCompleted / (totalMs / 1000),
    readSnapshots,
  };
}

export function useVfsBenchmark() {
  const [states, setStates] = useState<Map<string, BenchmarkInstanceState>>(new Map());
  const [isRunning, setIsRunning] = useState(false);
  const cancelledRef = useRef(false);

  const patchState = (vfsId: string, patch: Partial<BenchmarkInstanceState>) => {
    if (cancelledRef.current) return;
    setStates((prev) => {
      const next = new Map(prev);
      const cur = next.get(vfsId) ?? { vfsId, status: "idle" as const, phase: null, result: null };
      next.set(vfsId, { ...cur, ...patch });
      return next;
    });
  };

  const run = useCallback(async (instances: VFSInstance[], config: BenchmarkConfig) => {
    cancelledRef.current = false;
    setIsRunning(true);

    const initial = new Map<string, BenchmarkInstanceState>();
    instances.forEach((i) =>
      initial.set(i.config.id, { vfsId: i.config.id, status: "running", phase: "warmup", result: null }),
    );
    setStates(initial);

    // Sequential execution — one VFS at a time to avoid interference
    for (const instance of instances) {
      if (cancelledRef.current) break;

      try {
        // Warmup phase
        patchState(instance.config.id, { phase: "warmup" });
        await warmup(instance.db);
        if (cancelledRef.current) break;

        const concurrentWrites = config.ops * config.writePressure;

        patchState(instance.config.id, { phase: "single-writes" });
        const singleWrites = await benchSingleWrites(instance.db, config.ops);
        if (cancelledRef.current) break;

        patchState(instance.config.id, { phase: "tx-writes" });
        const txWrites = await benchTxWrites(instance.db, config.ops);
        if (cancelledRef.current) break;

        patchState(instance.config.id, { phase: "reads" });
        const reads = await benchReads(instance.db, config.ops);
        if (cancelledRef.current) break;

        patchState(instance.config.id, { phase: "concurrency" });
        const concurrency = await benchConcurrency(instance.db, config.ops, concurrentWrites);
        if (cancelledRef.current) break;

        patchState(instance.config.id, {
          status: "done",
          phase: null,
          result: { singleWrites, txWrites, reads, concurrency, config },
        });
      } catch (error) {
        patchState(instance.config.id, { status: "error", phase: null, error: error as Error });
      }
    }

    if (!cancelledRef.current) setIsRunning(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setIsRunning(false);
  }, []);

  return { states, isRunning, run, cancel };
}
