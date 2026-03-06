# React Watch Query Demo

A React demo app that compares four PowerSync watch query implementations side-by-side to illustrate their rendering performance characteristics.

## What This Demo Shows

Four approaches to watching PowerSync queries, each with different trade-offs:

| Implementation | API | Trade-off |
|----------------|-----|-----------|
| Basic Watch | `useQuery()` | Emits on every table write; new array refs every time |
| Incremental Watch | `useQuery()` + `rowComparator` | Skips unchanged results; still creates new array refs |
| Differential Watch | `query.differentialWatch()` | Preserves object references; React.memo prevents child re-renders |
| Trigger-Based | `db.triggers.trackTableDiff()` | O(writes) not O(results); works on a single table only |

The Differential Watch list with memoized todo items is the optimal pattern for large datasets.

## Setup

Requires a PowerSync backend (localhost:6060 for sync, localhost:8080 for the demo API). See `src/powersync.ts` for configuration.

```bash
pnpm install
pnpm dev
```

## Commands

- `pnpm dev` — Start Vite dev server
- `pnpm build` — TypeScript compile + Vite production build
- `pnpm lint` — ESLint
- `pnpm preview` — Preview production build

## Structure

- **Control Panel** — Test scenarios: seed data, update patterns, throttle slider
- **Metrics Dashboard** — Per-watch latency and render counts
- **PowerSync** — Schema: `lists` and `todos` tables; uses wa-sqlite for local storage

## Tech Stack

React, TypeScript, Vite, PowerSync (wa-sqlite), Zustand.
