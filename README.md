# PowerSync Web Bench

A React demo app that benchmarks PowerSync's watch query implementations and VFS storage backends side-by-side. Three modes let you explore different dimensions of performance.

> All source was written with AI assistance. 

## Modes

### Watch Query Comparison

Compares four watch query implementations against the same database, showing how each strategy affects React rendering performance.

| Column | API | Behaviour |
|--------|-----|-----------|
| Basic | `useQuery()` | Re-runs on every table write; new array reference every time |
| Incremental | `useQuery()` + `rowComparator` | Skips emission when results are unchanged |
| Differential | `query.differentialWatch()` | Preserves object references for unchanged rows; `React.memo` prevents child re-renders |
| Trigger-Based | `db.triggers.trackTableDiff()` | O(writes) overhead instead of O(result set); single table only |

**Recommended pattern for large datasets:** Differential + `MemoizedTodoItem`.

Metrics tracked per column: query count, emission count, render count, item render count, and latency (avg / last / low / median).

The **throttle slider** controls the trailing-edge debounce applied to all watch types equally. At 0 ms every individual write fires a separate emission, maximising the visible difference between strategies. At higher values writes within the window collapse into a single emission.

**Clean Data** resets both the database and all metric counters.

### VFS Comparison

Runs the same watch query strategy (selectable) against four different VFS backends simultaneously, so you can compare how storage choice affects watch query latency and render behaviour.

| VFS | Storage |
|-----|---------|
| `IDBBatchAtomicVFS` | IndexedDB |
| `OPFSCoopSyncVFS` | OPFS (cooperative sync) |
| `AccessHandlePoolVFS` | OPFS (access handle pool) |
| `OPFSWriteAheadVFS` | OPFS + WAL (default) |

Each column has its own `PowerSyncDatabase` instance and independent metrics slot. Control panel writes are broadcast to all active VFS databases simultaneously.

### Raw VFS Benchmark

Measures raw database operation latency for each VFS backend with no watch queries involved. Three phases run in parallel across all active backends:

| Phase | What it measures |
|-------|-----------------|
| **Single Writes** | N individual inserts, one commit per row. Exposes per-commit VFS overhead. |
| **Transaction Writes** | N inserts in a single `writeTransaction()`. One commit total — the best-case baseline. |
| **Reads** | N primary-key lookups against the rows written in the transaction phase. |
| **Read Under Write Pressure** | N reads while a background write loop runs at full speed simultaneously. The latency delta vs plain Reads shows how much the VFS serialises reads behind write commits. |

Results show total time, ops/sec, and per-operation min / median / p95 / max. The gap between Single Writes and Transaction Writes is the key signal: a large gap means the VFS has expensive per-commit overhead and single writes should be avoided in hot paths.

The number of operations N is configurable (default 100). A **comparison chart** (bar chart icon in the header) overlays min and p95 latency for all active backends side-by-side across every phase.

## Getting Started

```bash
pnpm install
pnpm dev
```

The app runs entirely in the browser using `@powersync/web` with WASM SQLite. No backend is required for the benchmarks. The PowerSync sync connector (localhost:6060 / localhost:8080) is commented out in `src/powersync.ts` and only needed if you want to enable cloud sync.

```bash
pnpm build    # TypeScript compile + Vite production build
pnpm lint     # ESLint
pnpm preview  # Preview production build
```

## Project Structure

```
src/
├── App.tsx                          # Mode toggle, VFS DB lifecycle, root layout
├── powersync.ts                     # Schema, connector, initPowerSync()
├── vfsConfig.ts                     # VFS_CONFIGS registry (id, label, enum, filename)
├── queryTypeConfig.ts               # QUERY_TYPE_CONFIGS (basic/incremental/differential/trigger)
│
├── components/
│   ├── BasicWatchList.tsx           # useQuery() implementation
│   ├── IncrementalWatchList.tsx     # useQuery() + rowComparator
│   ├── DifferentialWatchList.tsx    # query.differentialWatch()
│   ├── TriggerBasedList.tsx         # db.triggers.trackTableDiff()
│   ├── TodoItem.tsx                 # BasicTodoItem + MemoizedTodoItem
│   ├── ControlPanel.tsx             # Seed/update/clean controls; broadcasts to multiple DBs
│   ├── MetricsDashboard.tsx         # Global write/query totals
│   ├── TodoListMetrics.tsx          # Per-watch latency + render metrics panel
│   ├── VfsWatchColumn.tsx           # PowerSyncContext wrapper for one VFS instance
│   ├── VfsModePanel.tsx             # VFS backend checkbox selector
│   ├── VfsQueryTypePanel.tsx        # Query type radio selector
│   ├── RawBenchmarkContent.tsx      # Raw benchmark page layout
│   └── BenchmarkResultCard.tsx      # Per-VFS benchmark results card
│
├── hooks/
│   ├── useWatchMetrics.ts           # Stable per-watch metrics API (non-reactive)
│   ├── useVfsDatabases.ts           # Creates/inits/disposes 4 VFS DB instances
│   └── useVfsBenchmark.ts           # Benchmark runner (single writes / tx writes / reads)
│
├── stores/
│   └── metricsStore.ts              # Zustand — split into actions (stable) + state (reactive)
│
└── utils/
    └── metricsWrapper.ts            # Wires PowerSync DB events to write-count tracking
```

## Technical Notes

**VFS DB lifecycle** — VFS databases are initialised once when entering either VFS mode and kept alive while switching between VFS Comparison and Raw Benchmark. Switching back to Watch Query mode disposes all four instances.

**Metrics store split** — `useMetricsActions` is intentionally non-reactive so components that only record metrics never re-render. Only `useWatchMetricsState(watchId)` and `useGlobalTotals()` trigger re-renders.

**Benchmark isolation** — benchmark rows use a reserved `list_id` (`00000000-0000-bench-0000-000000000000`) so they never appear in watch query columns.

**WASM / build** — `vite.config.ts` excludes `@journeyapps/wa-sqlite` and `@powersync/web` from dependency optimisation. Plugins: `vite-plugin-wasm`, `vite-plugin-top-level-await`, `@vitejs/plugin-react`.

## Tech Stack

React, TypeScript, Vite, PowerSync (`@powersync/web` + wa-sqlite), Zustand.
