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
| Watch Query Comparison | Four watch strategies against one DB; measures React rendering impact |
| VFS Comparison | One watch strategy (selectable) against four VFS backends simultaneously |
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

**Per-model dbFilenames (`exampleVFS-{model}.db`, `vfs-compare-{id}-{model}.db`).** wa-sqlite 1.5+ ships `OPFSWriteAheadVFS` with a strict-WAL check (`Write transaction cannot use BEGIN DEFERRED`) that PowerSync core's `replace_schema` trips when migrating in place. Giving each schema its own file means swaps open a fresh DB rather than migrating, sidestepping the bug. Helpers: `defaultDbFilename(model)` in `powersync.ts`, `vfsDbFilename(config, model)` in `vfsConfig.ts`.

- **Simple schema** — `lists` + `todos` (with an idle `assignee_id` column so the on-disk shape of `todos` matches Complex).
- **Complex schema** — adds `users`, `tags`, `todo_tags`. Watch query becomes a 4-table JOIN with `GROUP_CONCAT(tag_names, ',' ORDER BY tg.name)`.

`ORDER BY` inside `GROUP_CONCAT` is **load-bearing**: SQLite's concat order is otherwise unspecified, which causes `differentialWatch`'s `JSON.stringify` rowComparator to flag spurious `updated` rows for unchanged tag sets.

`getSchema(model)` and `getTodosWatchSql(model)` in `src/schemas.ts` are the single source of truth — all watch lists and `useVfsDatabases` thread through these.

#### Caveats

- **Simple ↔ Complex timings are not comparable.** Complex seeds ~2.5× the rows and the watch reactor is heavier. Compare _within_ Complex, never across modes.
- **`DifferentialWatch`'s `JSON.stringify` cost rises with the wider row** — intentional signal.
- **`TriggerBasedList` in Complex mode** loses the "O(writes) not O(results)" framing. Reported latency is "trigger fire + affected-ID query + enrichment JOIN."
- **Inside `trackTableDiff` `onChange` callbacks, run reads on the supplied `context` via `context.withDiff(sql, params)`, never `db.getAll(...)`.** The SDK runs onChange inside a `writeTransaction`, which holds the writer lock. A fresh `db.*` call requests a new lock and deadlocks every single-worker VFS (idb-batch / opfs-coop / access-handle-pool). OPFSWriteAheadVFS hides the bug because its reader worker serves the conflicting read. The handler context types claim to extend `LockContext` (with `getAll`/`execute`/etc.), but at runtime it's built via `{ ...tx, withDiff, withExtractedDiff }` — only `withDiff`/`withExtractedDiff` survive the spread; the `tx` prototype methods don't. `withDiff` is the supported way to issue arbitrary reads on the same tx — its `WITH DIFF AS (...) ${query}` wrapper is harmless when your query doesn't reference DIFF.
- **Raw VFS Benchmark ignores the toggle** — it pins to `simpleSchema` (writes to `todos` only).

All four accept optional `watchId?` and `title?` props so they can run as multiple simultaneous instances with independent metrics slots (used in VFS Comparison mode).

`DifferentialWatchList` + `MemoizedTodoItem` is the optimal pattern for large datasets.

### VFS Backends

Defined in `src/vfsConfig.ts`. Each entry has an `id`, `label`, `vfs` enum value, and a `dbFilename` distinct from the main `exampleVFS.db`.

| ID | VFS | Storage |
|----|-----|---------|
| `idb-batch` | `IDBBatchAtomicVFS` | IndexedDB |
| `opfs-coop` | `OPFSCoopSyncVFS` | OPFS |
| `access-handle-pool` | `AccessHandlePoolVFS` | OPFS (access handles) |
| `opfs-wal` | `OPFSWriteAheadVFS` | OPFS + WAL (default) |

### Key Files

- `src/schemas.ts` — `simpleSchema` / `complexSchema` / `getSchema(model)` / `getTodosWatchSql(model)`
- `src/powersync.ts` — `createDatabase({ model, dbFilename, vfs })` factory, connector, backend config (localhost:6060 / localhost:8080), `initPowerSync()`. **No module-level DB singleton** — construction must react to the chosen schema.
- `src/stores/dataModelStore.ts` — Zustand store with `localStorage` persistence for Simple/Complex
- `src/vfsConfig.ts` — `VFS_CONFIGS` array; single source of truth for VFS metadata
- `src/queryTypeConfig.ts` — `QUERY_TYPE_CONFIGS` + `QueryType` type
- `src/App.tsx` — Root component; `PowerSyncContext` provider; mode state; `useVfsDatabases` lifted here so VFS DBs survive switching between VFS Comparison and Raw Benchmark
- `src/stores/metricsStore.ts` — Zustand store with a deliberately split design:
  - `useMetricsActions` — stable mutation API, **non-reactive** (no re-renders)
  - `useMetricsState` / `useWatchMetricsState(watchId)` — reactive selectors
- `src/components/ControlPanel.tsx` — Test scenario controls; accepts optional `databases?` array to broadcast writes to all VFS DBs, and `extraControls?` slot for injecting VFS-mode UI
- `src/components/MetricsDashboard.tsx` — Global metrics header
- `src/components/TodoListMetrics.tsx` — Per-watch latency (avg/last/low/median) and render metrics
- `src/components/VfsWatchColumn.tsx` — Wraps a `VFSInstance` in its own `PowerSyncContext`; renders loading/error/ready states
- `src/components/VfsModePanel.tsx` — Checkbox list for toggling VFS backends (min 1 required)
- `src/components/VfsQueryTypePanel.tsx` — Radio selector for query type in VFS Comparison
- `src/components/RawBenchmarkContent.tsx` — Raw benchmark page layout
- `src/components/BenchmarkResultCard.tsx` — Per-VFS benchmark results (single writes / tx writes / reads)
- `src/hooks/useWatchMetrics.ts` — Creates per-watch stable metrics API
- `src/hooks/useVfsDatabases.ts` — Creates, initialises, wires metrics for, and disposes all 4 VFS DB instances; controlled by `enabled` flag and `model`. The 4 instances are torn down and recreated on schema swap.
- `src/hooks/useVfsBenchmark.ts` — Benchmark runner; three phases run in parallel per DB; `cancelledRef` prevents state updates after cancel/unmount
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

Benchmark rows use `list_id = "00000000-0000-bench-0000-000000000000"` so they never appear in watch query columns. The three benchmark phases are:
1. **Single Writes** — N individual `execute()` calls (one commit each); measures per-commit VFS overhead
2. **Transaction Writes** — N inserts in one `writeTransaction()` (one commit); the best-case baseline
3. **Reads** — N `getOptional()` by PK against the rows left by transaction writes

### VFS DB Lifecycle

`useVfsDatabases(enabled, model)` is called at `App` level with `enabled = mode !== "watch-query"`. This means:
- VFS DBs initialise once when entering either VFS mode
- Switching between VFS Comparison and Raw Benchmark reuses the same open DB handles
- Switching back to Watch Query mode disposes all four instances and cleans up metrics listeners
- Toggling Simple ↔ Complex tears down all four instances and reopens them with the new schema. Metrics are reset on swap (mixed-schema counters are meaningless).

The single watch-query DB in `AppContent` follows the same `useEffect([model])` pattern — `createDatabase({ model })` runs on every model change with the previous DB closed in cleanup.

### Vite / Build Notes

`vite.config.ts` excludes `@journeyapps/wa-sqlite` and `@powersync/web` from dependency optimization due to WASM requirements. Plugins: `vite-plugin-wasm`, `vite-plugin-top-level-await`, `@vitejs/plugin-react`.
