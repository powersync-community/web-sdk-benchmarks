import { useState, useRef, useCallback } from "react";
import { PowerSyncDatabase } from "@powersync/web";
import { type VFSInstance } from "./useVfsDatabases";

// Isolated list_id so benchmark rows never appear in watch query columns
const BENCH_LIST_ID = "00000000-0000-bench-0000-000000000000";

export type BenchmarkPhase = "single-writes" | "tx-writes" | "reads";
export type BenchmarkStatus = "idle" | "running" | "done" | "error";

export interface PhaseResult {
  totalMs: number;
  rowsPerSec: number;
  // null for tx-writes (single commit, no per-op measurement)
  min: number | null;
  median: number | null;
  p95: number | null;
  max: number | null;
}

export interface BenchmarkResult {
  singleWrites: PhaseResult;
  txWrites: PhaseResult;
  reads: PhaseResult;
}

export interface BenchmarkInstanceState {
  vfsId: string;
  status: BenchmarkStatus;
  phase: BenchmarkPhase | null;
  result: BenchmarkResult | null;
  error?: Error;
}

function computePerOpStats(latencies: number[], totalMs: number): PhaseResult {
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
  return computePerOpStats(latencies, performance.now() - start);
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
  return { totalMs, rowsPerSec: n / (totalMs / 1000), min: null, median: null, p95: null, max: null };
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
  return computePerOpStats(latencies, totalMs);
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

  const run = useCallback(async (instances: VFSInstance[], n: number) => {
    cancelledRef.current = false;
    setIsRunning(true);

    const initial = new Map<string, BenchmarkInstanceState>();
    instances.forEach((i) =>
      initial.set(i.config.id, { vfsId: i.config.id, status: "running", phase: "single-writes", result: null }),
    );
    setStates(initial);

    await Promise.all(
      instances.map(async (instance) => {
        try {
          patchState(instance.config.id, { phase: "single-writes" });
          const singleWrites = await benchSingleWrites(instance.db, n);
          if (cancelledRef.current) return;

          patchState(instance.config.id, { phase: "tx-writes" });
          const txWrites = await benchTxWrites(instance.db, n);
          if (cancelledRef.current) return;

          patchState(instance.config.id, { phase: "reads" });
          const reads = await benchReads(instance.db, n);
          if (cancelledRef.current) return;

          patchState(instance.config.id, { status: "done", phase: null, result: { singleWrites, txWrites, reads } });
        } catch (error) {
          patchState(instance.config.id, { status: "error", phase: null, error: error as Error });
        }
      }),
    );

    if (!cancelledRef.current) setIsRunning(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setIsRunning(false);
  }, []);

  return { states, isRunning, run, cancel };
}
