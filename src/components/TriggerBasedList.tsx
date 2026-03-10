import { useCallback, useEffect, useState } from "react";
import { usePowerSync } from "@powersync/react";
import { useWatchMetrics } from "../hooks/useWatchMetrics";
import { TodoListMetrics } from "./TodoListMetrics";
import { BasicTodoItem } from "./TodoItem";

interface TriggerBasedListProps {
  listId: string;
  throttleMs: number;
  watchId?: string;
  title?: string;
}

interface Todo {
  id: string;
  description: string;
  completed: number;
  list_id: string;
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
 * Key Characteristics:
 * - ✅ Overhead proportional to writes, not result set size
 * - ✅ Filter at trigger level (efficient)
 * - ✅ Access to previous values (UPDATE operations)
 * - ✅ SQL-queryable DIFF table
 * - ⚠️ Single table only
 * - ⚠️ Requires writeLock during onChange
 */
export function TriggerBasedList({
  listId,
  throttleMs,
  watchId = "trigger-based",
  title = "Trigger-Based Diff",
}: TriggerBasedListProps) {
  const db = usePowerSync();
  const metrics = useWatchMetrics(watchId);

  const [todos, setTodos] = useState<Todo[]>([]);

  useEffect(() => {
    if (!db) return;

    let stop: (() => Promise<void>) | null = null;

    (async () => {
      try {
        // Initial load - fetch existing data before setting up triggers
        const initialData = await db.getAll<Todo>(
          "SELECT * FROM todos WHERE list_id = ?",
          [listId],
        );
        setTodos(initialData);

        stop = await db.triggers.trackTableDiff({
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
              const byId = new Map(prev.map((todo) => [todo.id, todo]));
              const order = prev.map((todo) => todo.id);

              for (const change of changes) {
                const nextValue = change.value
                  ? (JSON.parse(change.value) as Todo)
                  : null;
                const prevValue = change.previous_value
                  ? (JSON.parse(change.previous_value) as Todo)
                  : null;
                const id = nextValue?.id ?? prevValue?.id ?? change.id;

                // Skip if we can't determine a valid ID
                if (!id || typeof id !== 'string') continue;

                if (change.operation === "DELETE") {
                  byId.delete(id);
                } else if (nextValue) {
                  byId.set(id, { ...nextValue, id });
                }
              }

              const next: Todo[] = [];
              for (const id of order) {
                const value = byId.get(id);
                if (value) {
                  next.push(value);
                  byId.delete(id);
                }
              }

              for (const value of byId.values()) {
                next.push(value);
              }

              return next;
            });
            metrics.recordLatency();
          },
        });
      } catch (error) {
        console.error("Failed to setup trigger-based watch:", error);
      }
    })();

    return () => {
      stop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, listId, throttleMs]);

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
        <ul>
          <li>✅ O(writes) not O(results)</li>
          <li>✅ Efficient filtering</li>
          <li>✅ Previous values</li>
          <li>⚠️ Single table only</li>
        </ul>
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
