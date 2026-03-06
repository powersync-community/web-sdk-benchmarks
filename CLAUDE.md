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

This is a **React demo app** comparing four PowerSync watch query implementations side-by-side to illustrate their rendering performance characteristics.

### Watch Query Implementations (the core comparison)

| Component | Hook/API | Key Trade-off |
|-----------|----------|---------------|
| `BasicWatchList` | `useQuery()` | Emits on every table write; new array refs every time |
| `IncrementalWatchList` | `useQuery()` + `rowComparator` | Skips unchanged results; still creates new array refs |
| `DifferentialWatchList` | `query.differentialWatch()` | Preserves object references; React.memo prevents child re-renders |
| `TriggerBasedList` | `db.triggers.trackTableDiff()` | O(writes) not O(results); works on a single table only |

`DifferentialWatchList` + `MemoizedTodoItem` is the optimal pattern for large datasets.

### Key Files

- `src/powersync.ts` — DB schema (`lists`, `todos`), connector, and backend config (localhost:6060 / localhost:8080)
- `src/App.tsx` — Root component, `PowerSyncContext` provider, app-level state
- `src/stores/metricsStore.ts` — Zustand store with a deliberately split design:
  - `useMetricsActions` — stable mutation API, **non-reactive** (no re-renders)
  - `useMetricsState` / `useWatchMetricsState(watchId)` — reactive selectors
- `src/components/ControlPanel.tsx` — Test scenario controls (seed data, update patterns, throttle slider)
- `src/components/MetricsDashboard.tsx` — Global metrics header
- `src/components/TodoListMetrics.tsx` — Per-watch latency and render metrics
- `src/hooks/useWatchMetrics.ts` — Creates per-watch stable metrics API
- `src/utils/metricsWrapper.ts` — Connects PowerSync DB events to write-count tracking

### Metrics Store Pattern

The store is intentionally split to avoid spurious re-renders:

```ts
// Use this for recording metrics (stable, never re-renders consumers)
const actions = useMetricsActions();

// Use this for displaying metrics (reactive)
const metrics = useWatchMetricsState('differential');
```

Item render counts are capped at 500 entries for memory safety.

### Vite / Build Notes

`vite.config.ts` excludes `@journeyapps/wa-sqlite` and `@powersync/web` from dependency optimization due to WASM requirements. Plugins: `vite-plugin-wasm`, `vite-plugin-top-level-await`, `@vitejs/plugin-react`.
