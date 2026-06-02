# PowerSync Web SDK Benchmark

A stand-alone React demo app that benchmarks PowerSync's watch query implementations and VFS storage options side-by-side, using the [@powersync/web](https://www.npmjs.com/package/@powersync/web) module. Three modes let you explore different dimensions of performance. Important note; this benchmarking tool does not connect to a PowerSync Service instance, everything runs locally. 

> All sources were written with AI assistance. 

## Data Model Toggle

The control panel has a **Simple / Complex** radio that swaps the PowerSync schema. Each schema uses its own DB file (`exampleVFS-simple.db` / `exampleVFS-complex.db`, plus `vfs-compare-{id}-{model}.db` for the 4 VFS columns) so swapping opens a fresh DB rather than migrating in place. This sidesteps a wa-sqlite 1.5+ `OPFSWriteAheadVFS` strict-WAL check that PowerSync core's `replace_schema` would otherwise trip on schema migration.

| Mode | Tables | Watch SQL |
|------|--------|-----------|
| **Simple** | `lists`, `todos` (with idle `assignee_id` column) | `SELECT * FROM todos WHERE list_id = ?` |
| **Complex** | `lists`, `todos`, `users`, `tags`, `todo_tags` | 4-table JOIN with `GROUP_CONCAT(tag_names ORDER BY name)` |

`assignee_id` is present on `todos` in both modes so the column shape is identical — toggling does not produce migrations on `todos`.

**`tag_names` is ordered inside `GROUP_CONCAT`** — without `ORDER BY` the concat order is unspecified, causing `differentialWatch`'s `JSON.stringify` row comparator to report spurious `updated` rows for unchanged tag sets.

### Caveats

- **Simple ↔ Complex timings are not directly comparable.** Complex seeds write ~2.5× the rows (5 users + 8 tags + N todos + ~1.5N todo_tags) and the watch reactor is much heavier. Compare _within_ Complex (across watch strategies and VFS backends), not across modes.
- **`differentialWatch`'s `JSON.stringify` rowComparator becomes more expensive** with the wider JOIN row — that's signal the demo intentionally exposes.
- **`TriggerBasedList` loses its "O(writes) not O(results)" framing in Complex mode.** It registers five trigger sources (`todos`, `users`, `tags`, `lists`, `todo_tags`); each fire computes affected todo IDs and re-runs the enrichment JOIN over just those IDs. The strategy effectively becomes _triggered re-execution of the JOIN over affected rows_. Reported latency is "trigger fire + affected-ID query + enrichment JOIN."
- The **Raw VFS Benchmark mode ignores the data model toggle** — it writes only to `todos` against a reserved `list_id`.

## Modes

### Watch Query Comparison

Compares four watch query implementations against the same database, showing how each strategy affects React rendering performance.

| Column | API | Behaviour |
|--------|-----|-----------|
| Basic | `useQuery()` | Re-runs on every table write; new array reference every time |
| Incremental | `useQuery()` + `rowComparator` | Skips emission when results are unchanged |
| Differential | `query.differentialWatch()` | Preserves object references for unchanged rows; `React.memo` prevents child re-renders |
| Trigger-Based | `db.triggers.trackTableDiff()` | O(writes) overhead instead of O(result set) in Simple mode; in Complex mode it tracks five sources and re-runs the enrichment JOIN over affected IDs (see caveats) |

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

Measures raw database operation latency for each VFS backend with no watch queries involved. Backends run sequentially (order shuffled to mitigate position bias); each runs a warmup plus four measured phases, with every phase running for a fixed duration and reporting how much throughput it achieved:

| Phase | What it measures |
|-------|-----------------|
| **Single Writes** | Individual inserts, one commit per row, for the configured duration. Exposes per-commit VFS overhead. |
| **Transaction Writes** | Batched inserts (`txBatchSize` per `writeTransaction()`) for the configured duration. Per-transaction commit latency is captured. |
| **Reads** | Primary-key lookups for the configured duration against a pool of pre-seeded rows. |
| **Read Under Write Pressure** | Interleaved reads and writes for the configured duration. Both are serialised through the same Web Worker, so this shows how read latency degrades when writes compete for the worker, not true concurrent I/O. |

Results show total time, ops/sec, and per-operation min / median / p95 / max (transaction writes also report per-commit percentiles). The gap between Single Writes and Transaction Writes is the key signal: a large gap means the VFS has expensive per-commit overhead and single writes should be avoided in hot paths.

Configurable parameters: **Duration** (seconds per phase, default 5), **Transaction Batch Size** (default 500), and **Read Seed Rows** (default 1000). A **comparison chart** (bar chart icon in the header) overlays min and p95 latency for all active backends side-by-side across every phase.

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
├── powersync.ts                     # createDatabase() factory, connector, initPowerSync()
├── schemas.ts                       # simpleSchema / complexSchema + getSchema(model) + JOIN SQL
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
│   ├── metricsStore.ts              # Zustand — split into actions (stable) + state (reactive)
│   └── dataModelStore.ts            # Persisted Simple/Complex schema choice
│
└── utils/
    └── metricsWrapper.ts            # Wires PowerSync DB events to write-count tracking
```

## Technical Notes

**VFS DB lifecycle** — VFS databases are initialized once when entering either VFS mode and kept alive while switching between VFS Comparison and Raw Benchmark. Switching back to Watch Query mode disposes all four instances.

**Metrics store split** — `useMetricsActions` is intentionally non-reactive so components that only record metrics never re-render. Only `useWatchMetricsState(watchId)` and `useGlobalTotals()` trigger re-renders.

**Benchmark isolation** — benchmark rows use a reserved `list_id` (`00000000-0000-bench-0000-000000000000`) so they never appear in watch query columns.

**WASM / build** — `vite.config.ts` excludes `@journeyapps/wa-sqlite` and `@powersync/web` from dependency optimisation. Plugins: `vite-plugin-wasm`, `vite-plugin-top-level-await`, `@vitejs/plugin-react`.

## Tech Stack

React, TypeScript, Vite, PowerSync (`@powersync/web` + wa-sqlite), Zustand.
