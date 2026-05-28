import { useCallback, useEffect, useRef, useState } from "react";
import { usePowerSync } from "@powersync/react";
import { useWatchMetrics } from "../hooks/useWatchMetrics";
import { TodoListMetrics } from "./TodoListMetrics";
import { BasicTodoItem } from "./TodoItem";
import { type DataModel } from "../schemas";

interface TriggerBasedListProps {
  listId: string;
  throttleMs: number;
  watchId?: string;
  title?: string;
  model: DataModel;
}

interface Todo {
  id: string;
  description: string;
  completed: number;
  list_id: string;
  assignee_name?: string;
  list_name?: string;
  tag_names?: string;
}

type DiffRow = {
  id: string | null;
  operation: "INSERT" | "UPDATE" | "DELETE";
  value: string | null;
  previous_value: string | null;
};

/**
 * TriggerBasedList - Uses db.triggers.trackTableDiff()
 *
 * Simple mode:
 * - One trigger on `todos`. O(writes) advantage applies — we read DIFF values
 *   directly and merge into state, avoiding a re-query.
 *
 * Complex mode:
 * - FIVE trigger sources (todos / users / tags / lists / todo_tags). For each
 *   fire we derive affected todo IDs, run an enrichment JOIN over just those
 *   IDs, and merge into state. The "O(writes) not O(results)" framing no
 *   longer applies — reported latency is "trigger fire + affected-ID query +
 *   enrichment JOIN", and there are 5 trigger sources instead of 1.
 */
export function TriggerBasedList({
  listId,
  throttleMs,
  watchId = "trigger-based",
  title = "Trigger-Based Diff",
  model,
}: TriggerBasedListProps) {
  const db = usePowerSync();
  const metrics = useWatchMetrics(watchId);

  const [todos, setTodos] = useState<Todo[]>([]);
  const displayedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!db) return;

    let cancelled = false;
    const stopFns: Array<() => Promise<void>> = [];

    if (model === "simple") {
      (async () => {
        try {
          const initialData = await db.getAll<Todo>(
            "SELECT * FROM todos WHERE list_id = ?",
            [listId],
          );
          if (cancelled) return;
          setTodos(initialData);
          displayedIdsRef.current = new Set(initialData.map((t) => t.id));

          const stop = await db.triggers.trackTableDiff({
            source: "todos",
            columns: ["description", "completed", "list_id"],
            when: {
              INSERT: `json_extract(NEW.data, '$.list_id') = '${listId}'`,
              UPDATE: `json_extract(NEW.data, '$.list_id') = '${listId}'`,
              DELETE: `json_extract(OLD.data, '$.list_id') = '${listId}'`,
            },
            throttleMs,
            onChange: async (context) => {
              metrics.recordTriggerFire();
              metrics.recordQuery();

              const changes = await context.withDiff<DiffRow>(
                "SELECT id, operation, value, previous_value FROM DIFF",
              );

              setTodos((prev) => {
                const byId = new Map(prev.map((t) => [t.id, t]));
                const order = prev.map((t) => t.id);

                for (const change of changes) {
                  const nextValue = change.value
                    ? (JSON.parse(change.value) as Todo)
                    : null;
                  const prevValue = change.previous_value
                    ? (JSON.parse(change.previous_value) as Todo)
                    : null;
                  const id = nextValue?.id ?? prevValue?.id ?? change.id;
                  if (!id || typeof id !== "string") continue;
                  if (change.operation === "DELETE") {
                    byId.delete(id);
                  } else if (nextValue) {
                    byId.set(id, { ...nextValue, id });
                  }
                }

                const next: Todo[] = [];
                for (const id of order) {
                  const v = byId.get(id);
                  if (v) {
                    next.push(v);
                    byId.delete(id);
                  }
                }
                for (const v of byId.values()) next.push(v);
                displayedIdsRef.current = new Set(next.map((t) => t.id));
                return next;
              });
              metrics.recordLatency();
            },
          });
          if (cancelled) {
            await stop();
            return;
          }
          stopFns.push(stop);
        } catch (error) {
          console.error("Failed to setup trigger-based watch (simple):", error);
        }
      })();
    } else {
      // ============================================================
      // Complex mode — 5 trigger sources + shared enrichment JOIN.
      // ============================================================

      const enrichmentSql = (placeholders: string) => `
        SELECT t.*,
               u.name AS assignee_name,
               l.name AS list_name,
               GROUP_CONCAT(tg.name, ',' ORDER BY tg.name) AS tag_names
        FROM todos t
        LEFT JOIN users u      ON u.id = t.assignee_id
        JOIN      lists l      ON l.id = t.list_id
        LEFT JOIN todo_tags tt ON tt.todo_id = t.id
        LEFT JOIN tags tg      ON tg.id = tt.tag_id
        WHERE t.list_id = ? AND t.id IN (${placeholders})
        GROUP BY t.id
      `;

      // The enrichment query MUST run on the same transaction context as the
      // trigger fire — `trackTableDiff` calls our onChange inside a
      // `writeTransaction`, which holds the writer lock on single-worker
      // VFSs (idb-batch / opfs-coop / access-handle-pool). Using `db.getAll`
      // here would deadlock those VFSs (the read waits for the writer lock
      // that this very transaction holds). OPFSWriteAheadVFS escapes the
      // deadlock only because it has a separate reader worker.
      //
      // The handler context is built via `{ ...tx, withDiff, ... }`, so the
      // tx methods on its prototype (getAll/execute/...) are NOT on the
      // spread — only `withDiff`/`withExtractedDiff` are. We piggy-back on
      // `withDiff` to run the enrichment join on the same writer tx; the
      // unused DIFF CTE is harmless.
      const refreshAffected = async (
        ctx: { withDiff: <T>(query: string, params?: ReadonlyArray<unknown>) => Promise<T[]> },
        idsToRefresh: Iterable<string>,
        idsToDelete: Iterable<string>,
      ) => {
        const refreshArr = Array.from(new Set(idsToRefresh));
        const deleteArr = Array.from(new Set(idsToDelete));
        let enriched: Todo[] = [];
        if (refreshArr.length > 0) {
          const placeholders = refreshArr.map(() => "?").join(",");
          enriched = await ctx.withDiff<Todo>(enrichmentSql(placeholders), [
            listId,
            ...refreshArr,
          ]);
        }
        if (cancelled) return;
        setTodos((prev) => {
          const byId = new Map(prev.map((t) => [t.id, t]));
          for (const id of deleteArr) byId.delete(id);
          for (const row of enriched) byId.set(row.id, row);

          // If a refreshed row no longer matches list_id (e.g., reassigned),
          // it won't be in `enriched` but also won't be deleted. Drop it.
          for (const id of refreshArr) {
            if (!enriched.some((r) => r.id === id) && !deleteArr.includes(id)) {
              byId.delete(id);
            }
          }

          const next: Todo[] = [];
          for (const old of prev) {
            const cur = byId.get(old.id);
            if (cur) {
              next.push(cur);
              byId.delete(old.id);
            }
          }
          for (const cur of byId.values()) next.push(cur);
          displayedIdsRef.current = new Set(next.map((t) => t.id));
          return next;
        });
      };

      // Helper: register a trigger, but if the effect was cancelled during the
      // await, immediately tear it down. Without this, a trigger registered
      // after the useEffect cleanup ran is leaked — its onChange keeps firing
      // and doing DB work into a dead component.
      const pushTrigger = async (
        options: Parameters<typeof db.triggers.trackTableDiff>[0],
      ) => {
        const stop = await db.triggers.trackTableDiff(options);
        if (cancelled) {
          await stop().catch(() => {});
          return;
        }
        stopFns.push(stop);
      };

      (async () => {
        try {
          // Initial load
          const initial = await db.getAll<Todo>(
            `SELECT t.*,
                    u.name AS assignee_name,
                    l.name AS list_name,
                    GROUP_CONCAT(tg.name, ',' ORDER BY tg.name) AS tag_names
             FROM todos t
             LEFT JOIN users u      ON u.id = t.assignee_id
             JOIN      lists l      ON l.id = t.list_id
             LEFT JOIN todo_tags tt ON tt.todo_id = t.id
             LEFT JOIN tags tg      ON tg.id = tt.tag_id
             WHERE t.list_id = ?
             GROUP BY t.id`,
            [listId],
          );
          if (cancelled) return;
          setTodos(initial);
          displayedIdsRef.current = new Set(initial.map((t) => t.id));

          // 1) todos — diff rows are the affected IDs directly.
          await pushTrigger({
            source: "todos",
            columns: ["description", "completed", "list_id", "assignee_id"],
            when: {
              INSERT: `json_extract(NEW.data, '$.list_id') = '${listId}'`,
              UPDATE: `json_extract(NEW.data, '$.list_id') = '${listId}' OR json_extract(OLD.data, '$.list_id') = '${listId}'`,
              DELETE: `json_extract(OLD.data, '$.list_id') = '${listId}'`,
            },
            throttleMs,
            onChange: async (context) => {
              metrics.recordTriggerFire();
              metrics.recordQuery();
              const rows = await context.withDiff<{
                id: string;
                operation: "INSERT" | "UPDATE" | "DELETE";
              }>("SELECT id, operation FROM DIFF");
              const del = rows
                .filter((r) => r.operation === "DELETE")
                .map((r) => r.id);
              const upsert = rows
                .filter((r) => r.operation !== "DELETE")
                .map((r) => r.id);
              await refreshAffected(context, upsert, del);
              metrics.recordLatency();
            },
          });

          // 2) users — affected = todos in this list with assignee_id ∈ DIFF.
          await pushTrigger({
            source: "users",
            columns: ["name"],
            // Filter happens in onChange via affected-ID query; permissive when.
            when: { INSERT: "1", UPDATE: "1", DELETE: "1" },
            throttleMs,
            onChange: async (context) => {
              metrics.recordTriggerFire();
              metrics.recordQuery();
              const affected = await context.withDiff<{ id: string }>(
                `SELECT t.id FROM todos t
                 WHERE t.list_id = '${listId}'
                   AND t.assignee_id IN (SELECT id FROM DIFF)`,
              );
              if (affected.length > 0) {
                await refreshAffected(
                  context,
                  affected.map((a) => a.id),
                  [],
                );
              }
              metrics.recordLatency();
            },
          });

          // 3) tags — affected = displayed todos linked via todo_tags to any DIFF tag.
          await pushTrigger({
            source: "tags",
            columns: ["name"],
            when: { INSERT: "1", UPDATE: "1", DELETE: "1" },
            throttleMs,
            onChange: async (context) => {
              metrics.recordTriggerFire();
              metrics.recordQuery();
              const affected = await context.withDiff<{ todo_id: string }>(
                `SELECT DISTINCT tt.todo_id FROM todo_tags tt
                 WHERE tt.tag_id IN (SELECT id FROM DIFF)`,
              );
              const filtered = affected
                .map((a) => a.todo_id)
                .filter((id) => displayedIdsRef.current.has(id));
              if (filtered.length > 0) {
                await refreshAffected(context, filtered, []);
              }
              metrics.recordLatency();
            },
          });

          // 4) lists — if the active list's name changed, refresh all displayed.
          await pushTrigger({
            source: "lists",
            columns: ["name"],
            when: {
              INSERT: `json_extract(NEW.data, '$.id') = '${listId}'`,
              UPDATE: `json_extract(NEW.data, '$.id') = '${listId}'`,
              DELETE: `json_extract(OLD.data, '$.id') = '${listId}'`,
            },
            throttleMs,
            onChange: async (context) => {
              metrics.recordTriggerFire();
              metrics.recordQuery();
              const ids = Array.from(displayedIdsRef.current);
              if (ids.length > 0) {
                await refreshAffected(context, ids, []);
              }
              metrics.recordLatency();
            },
          });

          // 5) todo_tags — INSERT/UPDATE/DELETE change tag_names.
          //    Affected todo_id is in NEW (INSERT/UPDATE) or OLD (DELETE).
          await pushTrigger({
            source: "todo_tags",
            columns: ["tag_id"],
            when: { INSERT: "1", UPDATE: "1", DELETE: "1" },
            throttleMs,
            onChange: async (context) => {
              metrics.recordTriggerFire();
              metrics.recordQuery();
              const rows = await context.withDiff<{
                todo_id_new: string | null;
                todo_id_old: string | null;
              }>(
                `SELECT
                   json_extract(value, '$.todo_id') AS todo_id_new,
                   json_extract(previous_value, '$.todo_id') AS todo_id_old
                 FROM DIFF`,
              );
              const ids = new Set<string>();
              for (const r of rows) {
                if (r.todo_id_new) ids.add(r.todo_id_new);
                if (r.todo_id_old) ids.add(r.todo_id_old);
              }
              const filtered = Array.from(ids).filter((id) =>
                displayedIdsRef.current.has(id),
              );
              if (filtered.length > 0) {
                await refreshAffected(context, filtered, []);
              }
              metrics.recordLatency();
            },
          });
        } catch (error) {
          console.error("Failed to setup trigger-based watch (complex):", error);
        }
      })();
    }

    return () => {
      cancelled = true;
      Promise.all(stopFns.map((stop) => stop().catch(() => {}))).catch(
        () => {},
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, listId, throttleMs, model]);

  // Track render count when todos update
  useEffect(() => {
    metrics.recordRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todos]);

  const handleItemRender = useCallback(
    (itemId: string) => {
      metrics.recordItemRender(itemId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="watch-container">
      <div className="description">
        <p>
          Uses <code>db.triggers.trackTableDiff()</code>
        </p>
        {model === "complex" ? (
          <ul>
            <li>5 trigger sources (todos/users/tags/lists/todo_tags)</li>
            <li>Affected-ID query + enrichment JOIN per fire</li>
            <li>⚠️ O(writes) framing does not apply</li>
          </ul>
        ) : (
          <ul>
            <li>✅ O(writes) not O(results)</li>
            <li>✅ Efficient filtering</li>
            <li>✅ Previous values</li>
            <li>⚠️ Single table only</li>
          </ul>
        )}
      </div>
      <TodoListMetrics watchId={watchId} title={title} />
      <ul className="todo-list">
        {todos.map((todo) => (
          <BasicTodoItem
            key={todo.id}
            todo={todo}
            onRender={() => handleItemRender(todo.id)}
          />
        ))}
      </ul>
      {todos.length === 0 && <p className="empty">No todos in this list</p>}
    </div>
  );
}
