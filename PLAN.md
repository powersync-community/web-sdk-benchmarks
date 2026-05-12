# Plan: Complex data model + release SDK build

Two changes landing alongside the new web VFS release:

1. Add a runtime toggle for a complex (5-table, JOIN-heavy) data model so query performance can be compared across multiple tables.
2. Replace the dev pins of `@powersync/web`, `@powersync/common`, and `@journeyapps/wa-sqlite` with their release versions.

---

## 1. Complex data model (runtime toggle, 5 tables)

UI exposure: Simple / Complex radio in the control panel. The same `dbFilename` is reused for each backend; complex tables stay empty in Simple mode. Schema swap goes through the standard PowerSync close → reopen-with-new-schema path, so on a Complex → Simple swap the `ps_data__users`/`ps_data__tags`/etc. tables remain on disk as residual storage. That's acceptable for a benchmark app; just don't claim "no migration happens."

This affects **5 DB files**, not 4: `exampleVFS.db` used by Watch Query mode (`src/powersync.ts:27`) plus the 4 VFS dbFilenames in `vfsConfig.ts`.

### Schema (logical model — PowerSync has no FK enforcement)

```
users      (id, name, avatar_color)
lists      (id, name, owner_id)         -- owner_id references users.id (logical only)
todos      (id, list_id, description,   -- list_id references lists.id
            completed, assignee_id)     -- assignee_id references users.id, nullable
tags       (id, name, color)
todo_tags  (todo_id, tag_id)            -- many-to-many between todos and tags
```

PowerSync `Table`s only declare columns — the "→" notation in earlier drafts was misleading. All ID columns are `column.text` (PowerSync UUIDs). `assignee_id` is added in **both** Simple and Complex schemas so column shape stays comparable; in Simple mode it is always `NULL` and never read by the watch SQL.

### Complex watch query

```sql
SELECT t.*,
       u.name AS assignee_name,
       l.name AS list_name,
       GROUP_CONCAT(tg.name ORDER BY tg.name) AS tag_names
FROM todos t
LEFT JOIN users u      ON u.id = t.assignee_id
JOIN      lists l      ON l.id = t.list_id
LEFT JOIN todo_tags tt ON tt.todo_id = t.id
LEFT JOIN tags tg      ON tg.id = tt.tag_id
WHERE t.list_id = ?
GROUP BY t.id
```

`ORDER BY tg.name` inside `GROUP_CONCAT` is load-bearing: without it, SQLite's tag order is unspecified, which causes `compareBy: JSON.stringify` in `DifferentialWatchList` to report spurious `updated` rows for unchanged tag sets. That's noise, not signal. (Decision: order it. Wider-row cost is the signal we want; ordering churn is not.)

### Code changes

**`src/schemas.ts` (new)**

- Export `simpleSchema` (current `lists` + `todos`, plus `assignee_id` column on `todos`).
- Export `complexSchema` (all 5 tables).
- Export `type DataModel = "simple" | "complex"` and `getSchema(model)`.

**`src/powersync.ts`**

- Drop the module-level `powerSyncDatabase` singleton (`src/powersync.ts:27`) — DB construction must react to the chosen schema, so it can't run at import time.
- Export `createDatabase({ model, dbFilename, vfs })` factory.
- Keep `initPowerSync` and `connector` unchanged.

**`src/stores/dataModelStore.ts` (new)**

- Zustand store: `{ model: DataModel, setModel }`.
- Persist to `localStorage` so reloads keep the choice.

**`src/App.tsx`**

- Read `model` from the store. The DB swap is **not** a `useMemo` (a memo can't `await close()` and can't dispose its previous value). Use the same shape as `useVfsDatabases.ts:30`:
  - `useState<{ db, isInitialized }>` for the current DB.
  - `useEffect([model])` that creates + inits a new DB, then in cleanup closes the old one.
- Re-key/re-pass `PowerSyncContext value` with the new DB so `usePowerSync()` consumers (`AppContent` in `App.tsx:90`) see the swap.
- Show an "Initializing…" banner during swap (same UX as the existing `vfs-init-banner`).
- Pass `model` to `useVfsDatabases` so all four VFS columns rebuild on toggle (see hook change below).
- Reset metrics on swap (mixed-schema counters are meaningless).

**`src/hooks/useVfsDatabases.ts`**

- Add `model` to the dep array alongside `enabled`; close + recreate the 4 DB instances when it changes. The existing `useEffect([enabled])` cleanup at `useVfsDatabases.ts:80` already does the right teardown — extend the deps and pass `model` through to the `WASQLiteOpenFactory` + schema selection.

**`src/components/ControlPanel.tsx`**

- Add a built-in `DataModelPanel` section rendered at the top of the panel (above `extraControls` at `ControlPanel.tsx:142`). Built-in, not slot — both Watch Query and VFS Comparison modes need it, and Watch Query mode doesn't currently pass `extraControls` (`App.tsx:132`). Radio: Simple / Complex.
- Branch the seed and update helpers:
  - **Simple**: unchanged.
  - **Complex**: `seedComplexData(db, listId, n)` — inserts ~5 users, ~8 tags, then N todos with random `assignee_id`, then 0–3 `todo_tags` per todo, all in one `writeTransaction`. Same N as Simple seed buttons.
  - `cleanData` in complex mode: `DELETE FROM todo_tags` → `DELETE FROM todos` → `DELETE FROM tags` → `DELETE FROM users` → `DELETE FROM lists`. Order matters for readability even though PowerSync doesn't enforce FKs.

> **Seed-timing comparability:** Complex seed is ~2.5× the row writes of Simple (5 users + 8 tags + N todos + ~1.5N `todo_tags`) and the watch reactor is much heavier. **Simple ↔ Complex timings are not directly comparable.** Frame the comparison as _within_ Complex (across watch strategies and VFS backends). Document this in the UI near the toggle.

**Watch list components** — `BasicWatchList`, `IncrementalWatchList`, `DifferentialWatchList`, `TriggerBasedList`

- Each takes a new `model: DataModel` prop.
- Branch the SQL:
  - Simple → existing `SELECT * FROM todos WHERE list_id = ?`
  - Complex → JOIN query above
- Widen the `Todo` row type with optional `assignee_name?: string`, `list_name?: string`, `tag_names?: string`. Keep `tag_names` a **string** (the `GROUP_CONCAT` output), not an array — `MemoizedTodoItem` uses `React.memo`'s shallow equality, and an array reference from a new emission would break memoization.
- `TodoItem` / `MemoizedTodoItem` render the extra fields when present (assignee chip, tag pills) — cosmetic; doesn't affect benchmarks.

**`TriggerBasedList` in Complex mode — full-coverage triggers**
The single-table headline of Simple mode is gone in Complex: to keep correctness comparable to the other three strategies, register **five** `trackTableDiff` watchers, one per table. On any fire, compute the set of affected `todo` IDs, re-run the JOIN query for just those IDs, and merge into state.

| Trigger source | What it watches | How to derive affected todo IDs |
|---|---|---|
| `todos` (existing)   | `["description", "completed", "list_id", "assignee_id"]` — note `assignee_id` is new vs. `TriggerBasedList.tsx:67` | DIFF rows directly |
| `users`              | `["name"]`              | `SELECT id FROM todos WHERE list_id = ? AND assignee_id IN (DIFF.id)` |
| `tags`               | `["name"]`              | `SELECT todo_id FROM todo_tags WHERE tag_id IN (DIFF.id) AND todo_id IN (current displayed ids)` |
| `lists`              | `["name"]`              | If the active `listId` is in the DIFF, refresh all displayed rows; else no-op. |
| `todo_tags`          | `["tag_id"]` (and INSERT/DELETE) | `DIFF.todo_id ∩ current displayed ids` |

All five watchers share one `throttleMs`. The `when` clauses filter aggressively — e.g., the `users` trigger fires only when the changed user is an `assignee_id` for the current list — to keep idle cost low.

Trade-off, to surface in the component header and the README:

- The "O(writes) not O(results)" advantage **disappears** in Complex mode: each fire pays for the affected-ID query plus an enrichment JOIN, and there are five trigger sources instead of one.
- Latency reported is "trigger fire + affected-ID query + enrichment JOIN," not "trigger fire alone."
- The strategy is now effectively *triggered re-execution of the JOIN over affected rows* — correctness is comparable to Differential, but the asymptotic story is no longer the differentiator.

### Caveats to surface in the UI

- `differentialWatch`'s `compareBy: JSON.stringify` is more expensive with the wider JOIN row — that's signal we want to expose.
- `TriggerBasedList` in Complex mode registers 5 trigger sources and re-fetches affected rows on each fire; reported latency includes the affected-ID query plus the enrichment JOIN. The "O(writes) not O(results)" framing applies to Simple mode only.
- Simple ↔ Complex seed/watch timings are not directly comparable.

### Out of scope

- Raw VFS Benchmark stays unchanged — it writes to `todos` only by design. Add a note in `RawBenchmarkContent` that benchmarks ignore the data model toggle.
- No changes to `useVfsBenchmark`, `BenchmarkResultCard`, metrics store, or the `VfsBenchmark*Chart` components.

---

## 2. Replace dev SDK builds with the release build

**`package.json`** — current dev pins (`package.json:13-16`):

| Package                  | From                       | To                       |
| ------------------------ | -------------------------- | ------------------------ |
| `@journeyapps/wa-sqlite` | `0.0.0-dev-20260226155430` | latest published release |
| `@powersync/web`         | `0.0.0-dev-20260226160529` | latest published release |
| `@powersync/common`      | `0.0.0-dev-20260226160529` | **remove from `dependencies`** (transitive via `@powersync/web`) |

`@powersync/react` is already on `^1.7.3` release — no change.

Concretely:

```bash
pnpm remove @powersync/common
pnpm add @powersync/web@latest @journeyapps/wa-sqlite@latest
```

Check `src/` after install for any direct `@powersync/common` imports — if found, switch them to `@powersync/web` re-exports.

**Lockfile** — delete `bun.lock`; the repo standardises on `pnpm` (per CLAUDE.md), and a `pnpm-workspace.yaml` is the source of truth. Run `pnpm install` to refresh `pnpm-lock.yaml`.

### Sanity checks after install

- `WASQLiteVFS` still exports `OPFSWriteAheadVFS`, `OPFSCoopSyncVFS`, `AccessHandlePoolVFS`, `IDBBatchAtomicVFS` (the four `vfsConfig.ts` uses).
- `query(...).differentialWatch({ throttleMs, rowComparator })` API surface unchanged.
- `db.triggers.trackTableDiff({ source, columns, when, throttleMs, onChange })` + `context.withDiff(sql)` unchanged.
- `vite.config.ts` `optimizeDeps.exclude` for `@journeyapps/wa-sqlite` and `@powersync/web` still required (release versions still ship WASM + workers).
- `pnpm build` succeeds (TS check + Vite prod build).
- `pnpm dev` — all four VFS columns boot, watch queries emit, raw benchmark runs to completion.

---

## Suggested order of work

1. `pnpm remove @powersync/common`, `pnpm add @powersync/web@latest @journeyapps/wa-sqlite@latest`, delete `bun.lock`, `pnpm install`. Smoke-test the existing UI — verify no API breaks before adding schema work on top.
2. Introduce `schemas.ts` + the `useEffect`-driven DB factory + data-model store. **Thread `model` through `useVfsDatabases` in this step** so all 5 DB instances react consistently; keep Complex-mode SQL branches not-yet-wired (Simple branch active end-to-end).
3. Add Complex schema usage, complex seed helpers, and the JOIN query in `BasicWatchList`.
4. Roll the JOIN query out to `IncrementalWatchList` and `DifferentialWatchList`; widen `Todo` type; small UI for the extra fields.
5. `TriggerBasedList` Complex-mode rewrite: add `assignee_id` to the `todos` trigger columns, register the four additional triggers (`users`, `tags`, `lists`, `todo_tags`) with their `when`-clause filters, wire the affected-ID queries and the shared enrichment JOIN.
6. README + CLAUDE.md updates documenting the toggle, the JOIN-query trade-offs, Simple ↔ Complex non-comparability of timings, and `TriggerBasedList`'s loss of the O(writes) framing in Complex mode.
