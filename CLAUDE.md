# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev        # Start Vite dev server
pnpm build      # TypeScript compile + Vite production build
pnpm lint       # ESLint
pnpm preview    # Preview production build
```

No test runner is configured — this is a demo/showcase app.

## Architecture

This is a **React demo app** with three modes for benchmarking PowerSync performance.

### Modes

| Mode | Purpose |
|------|---------|
| OPFSCoopSync Comparison | Four watch strategies against one `OPFSCoopSyncVFS` DB; measures React rendering impact |
| Watch Strategy Comparison | One watch strategy (selectable) against every VFS backend simultaneously |
| Raw VFS Benchmark | Direct read/write latency benchmark — no watch queries |

### Watch Query Implementations

| Component | Hook/API | Key Trade-off |
|-----------|----------|---------------|
| `BasicWatchList` | `useQuery()` | Emits on every table write; new array refs every time |
| `IncrementalWatchList` | `useQuery()` + `rowComparator` | Skips unchanged results; still creates new array refs |
| `DifferentialWatchList` | `query.differentialWatch()` | Preserves object references; React.memo prevents child re-renders |
| `TriggerBasedList` | `db.triggers.trackTableDiff()` | O(writes) not O(results) — **Simple mode only**. In Complex mode, registers 5 trigger sources and re-runs the enrichment JOIN over affected IDs per fire. |

### Data Model Toggle

The control panel's **Simple / Complex** radio swaps the PowerSync schema via a close → reopen-with-new-schema cycle. State persists in `localStorage` (`powersync-bench-data-model`).

**Per-model dbFilenames (`exampleVFS-{model}.db`, `vfs-compare-{id}-{model}.db`).** Giving each schema its own file means swaps open a fresh DB rather than migrating, and each model keeps its own seeded data. This began as a workaround for a 1.x `replace_schema` failure on `OPFSWriteAheadVFS`; that is fixed in SDK v2 (in-place swaps work), so the split is now a convenience, not a requirement. Helpers: `defaultDbFilename(model)` in `powersync.ts`, `vfsDbFilename(config, model)` in `vfsConfig.ts`.

- **Simple schema** — `lists` + `todos` (with an idle `assignee_id` column so the on-disk shape of `todos` matches Complex).
- **Complex schema** — adds `users`, `tags`, `todo_tags`. Watch query becomes a 4-table JOIN with `GROUP_CONCAT(tag_names, ',' ORDER BY tg.name)`.

`ORDER BY` inside `GROUP_CONCAT` is **load-bearing**: SQLite's concat order is otherwise unspecified, which causes `differentialWatch`'s `JSON.stringify` rowComparator to flag spurious `updated` rows for unchanged tag sets.

`getSchema(model)` and `getTodosWatchSql(model)` in `src/schemas.ts` are the single source of truth — all watch lists and `useVfsDatabases` thread through these.

#### Caveats

- **Simple ↔ Complex timings are not comparable.** Complex seeds ~2.5× the rows and the watch reactor is heavier. Compare _within_ Complex, never across modes.
- **`DifferentialWatch`'s `JSON.stringify` cost rises with the wider row** — intentional signal.
- **`TriggerBasedList` in Complex mode** loses the "O(writes) not O(results)" framing. Reported latency is "trigger fire + affected-ID query + enrichment JOIN."
- **Inside `trackTableDiff` `onChange` callbacks, run reads on the supplied `context` via `context.withDiff(sql, params)`, never `db.getAll(...)`.** The SDK runs onChange inside a `writeTransaction`, which holds the writer lock. A fresh `db.*` call requests a new lock and deadlocks every single-connection VFS (everything except `opfs-wal`). OPFSWriteAheadVFS hides the bug because its reader worker serves the conflicting read. In SDK v2 the handler context type only exposes `withDiff`/`withExtractedDiff`, matching the runtime. `withDiff` is the supported way to issue arbitrary reads on the same tx — its `WITH DIFF AS (...) ${query}` wrapper is harmless when your query doesn't reference DIFF.
- **Raw VFS Benchmark ignores the toggle** — it pins to `simpleSchema` (writes to `todos` only).

All four accept optional `watchId?` and `title?` props so they can run as multiple simultaneous instances with independent metrics slots (used in Watch Strategy Comparison mode).

`DifferentialWatchList` + `MemoizedTodoItem` is the optimal pattern for large datasets.

### VFS Backends

Defined in `src/vfsConfig.ts`. Each entry has an `id`, `label`, `vfs` enum value, a `dbFilename` distinct from the main `exampleVFS.db`, a `persistent` flag, and optional `openOptions` / `note`. Adding a backend is a one-entry change: every view iterates `VFS_CONFIGS` and the grids wrap (`repeat(auto-fit, minmax(260px, 1fr))`).

| ID | VFS | Storage |
|----|-----|---------|
| `idb-batch` | `IDBBatchAtomicVFS` | IndexedDB |
| `opfs-coop` | `OPFSCoopSyncVFS` | OPFS (default) |
| `access-handle-pool` | `AccessHandlePoolVFS` | OPFS (access handles) |
| `opfs-wal` | `OPFSWriteAheadVFS` | OPFS + WAL |
| `opfs-simple` | `SimpleOpfsVFS` | OPFS (two pre-opened handles) |
| `memory-worker` | `InMemoryVfs` + `enableMultiTabs: false` | Memory, dedicated worker. Zero-I/O baseline on the same worker round-trip as the others. |
| `memory-main` | `InMemoryVfs` + `enableMultiTabs: false, useWebWorker: false` | Memory, synchronous in the tab. No worker round-trip. |

The enum member is `WASQLiteVFS.InMemoryVfs` (value `"InMemoryVFS"`). In-memory DBs lose their data on close, so they come back empty after a schema swap or reload.

### SDK v2 Notes

- Databases are constructed with a plain options object: `new PowerSyncDatabase({ schema, database: { dbFilename, vfs, cacheSizeKb, additionalReaders, ...openOptions } })`. `WASQLiteOpenFactory` is not used.
- Use the `CommonPowerSyncDatabase` type for "any PowerSync DB" parameters.
- `usePowerSync()` throws outside a `PowerSyncContext`. `ControlPanel` renders without one in Watch Strategy Comparison mode, so it uses `usePowerSyncOrNull()`.
- Query results expose rows as `result.array` (`rows._array` is deprecated).
- `@journeyapps/wa-sqlite` is a dependency of `@powersync/web`; do not add it to `package.json`.

### WAL Checkpointing (Raw Benchmark)

`wal_autocheckpoint` on `OPFSWriteAheadVFS` is an on/off switch, not a frequency. An auto-checkpoint is attempted only when the WAL holds at least `journal_size_limit` pages (default 1000), all connections read from the newer WAL file, and some connection has it enabled. `wal_checkpoint(passive)` behaves like an auto-checkpoint attempt and returns before completion; `full` or higher guarantees a completed checkpoint. The benchmark's Manual mode therefore uses `wal_checkpoint(full)` on a timer. Do not describe Auto as "per-commit" (see issue #4).

### Key Files

- `src/schemas.ts` — `simpleSchema` / `complexSchema` / `getSchema(model)` / `getTodosWatchSql(model)`
- `src/powersync.ts` — `createDatabase({ model, dbFilename, vfs })` factory, connector, backend config (localhost:6060 / localhost:8080), `initPowerSync()`. **No module-level DB singleton** — construction must react to the chosen schema.
- `src/stores/dataModelStore.ts` — Zustand store with `localStorage` persistence for Simple/Complex
- `src/vfsConfig.ts` — `VFS_CONFIGS` array; single source of truth for VFS metadata
- `src/queryTypeConfig.ts` — `QUERY_TYPE_CONFIGS` + `QueryType` type
- `src/App.tsx` — Root component; `PowerSyncContext` provider; mode state; `useVfsDatabases` lifted here so VFS DBs survive switching between Watch Strategy Comparison and Raw Benchmark
- `src/stores/metricsStore.ts` — Zustand store with a deliberately split design:
  - `useMetricsActions` — stable mutation API, **non-reactive** (no re-renders)
  - `useMetricsState` / `useWatchMetricsState(watchId)` — reactive selectors
- `src/components/ControlPanel.tsx` — Test scenario controls; accepts optional `databases?` array to broadcast writes to all VFS DBs, and `extraControls?` slot for injecting VFS-mode UI
- `src/components/MetricsDashboard.tsx` — Global metrics header
- `src/components/TodoListMetrics.tsx` — Per-watch latency (avg/last/low/median) and render metrics
- `src/components/VfsWatchColumn.tsx` — Wraps a `VFSInstance` in its own `PowerSyncContext`; renders loading/error/ready states
- `src/components/VfsModePanel.tsx` — Checkbox list for toggling VFS backends (min 1 required)
- `src/components/VfsQueryTypePanel.tsx` — Radio selector for query type in Watch Strategy Comparison
- `src/components/RawBenchmarkContent.tsx` — Raw benchmark page layout
- `src/components/BenchmarkResultCard.tsx` — Per-VFS benchmark results (single writes / tx writes / reads)
- `src/hooks/useWatchMetrics.ts` — Creates per-watch stable metrics API
- `src/hooks/useVfsDatabases.ts` — Creates, initialises, wires metrics for, and disposes one DB instance per VFS backend; controlled by `enabled` flag and `model`. The instances are torn down and recreated on schema swap.
- `src/hooks/useVfsBenchmark.ts` — Benchmark runner; backends run sequentially, each on its own freshly opened DB (warmup + four phases); `cancelledRef` prevents state updates after cancel/unmount
- `src/utils/metricsWrapper.ts` — Connects PowerSync DB events to write-count tracking

### Metrics Store Pattern

The store is intentionally split to avoid spurious re-renders:

```ts
// Use this for recording metrics (stable, never re-renders consumers)
const actions = useMetricsActions();

// Use this for displaying metrics (reactive)
const metrics = useWatchMetricsState('differential');
```

Per-watch latency tracks: average, last, lowest, and median. Item render counts are capped at 500 entries for memory safety.

### Raw Benchmark Isolation

Benchmark rows use `list_id = "00000000-0000-bench-0000-000000000000"` so they never appear in watch query columns. After a warmup, each phase runs for a fixed duration:
1. **Single Writes** — individual `execute()` calls (one commit each); measures per-commit VFS overhead
2. **Transaction Writes** — `txBatchSize` inserts per `writeTransaction()` (one commit); the best-case baseline
3. **Reads** — `getOptional()` by PK against pre-seeded rows
4. **Interleaved Read + Write** — one write loop plus `additionalReaders` concurrent read loops

### VFS DB Lifecycle

`useVfsDatabases(enabled, model)` is called at `App` level with `enabled = mode === "vfs-comparison"`. This means:
- VFS DBs initialise when entering Watch Strategy Comparison
- Leaving that mode disposes every instance and cleans up metrics listeners
- The Raw VFS Benchmark does not use these handles; `useVfsBenchmark` opens its own isolated DB per backend (`benchDbFilename`), one at a time
- Toggling Simple ↔ Complex tears down every instance and reopens them with the new schema. Metrics are reset on swap (mixed-schema counters are meaningless).

The single watch-query DB in `AppContent` follows the same `useEffect([model])` pattern — `createDatabase({ model })` runs on every model change with the previous DB closed in cleanup.

### Vite / Build Notes

`vite.config.ts` excludes `@powersync/web` from dependency optimization due to its web workers and WASM builds. Plugins: `vite-plugin-wasm`, `vite-plugin-top-level-await`, `@vitejs/plugin-react`.
