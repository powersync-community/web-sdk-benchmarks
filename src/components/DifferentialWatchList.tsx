import { useCallback, useEffect, useState } from "react";
import { usePowerSync } from "@powersync/react";
import { useWatchMetrics } from "../hooks/useWatchMetrics";
import { TodoListMetrics } from "./TodoListMetrics";
import { MemoizedTodoItem } from "./TodoItem";

interface Todo {
  id: string;
  description: string;
  completed: number;
  list_id: string;
}

interface DifferentialWatchListProps {
  listId: string;
  throttleMs: number;
}

/**
 * DifferentialWatchList - Uses query.differentialWatch()
 *
 * Key Characteristics:
 * - ✅ Skips emissions when results haven't changed
 * - ✅ Preserves object references for unchanged items
 * - ✅ React.memo prevents re-renders for unchanged items
 * - ✅ Provides detailed diff metadata (added/removed/updated)
 * - ⚠️ O(n) comparison on every potential change
 */
export function DifferentialWatchList({
  listId,
  throttleMs,
}: DifferentialWatchListProps) {
  const db = usePowerSync();
  const [todos, setTodos] = useState<Todo[]>([]);
  const watchId = "differential-watch";
  const metrics = useWatchMetrics(watchId);

  useEffect(() => {
    if (!db) return;

    const watchedQuery = db
      .query<Todo>({
        sql: "SELECT * FROM todos WHERE list_id = ?",
        parameters: [listId],
      })
      .differentialWatch({
        throttleMs,
        rowComparator: {
          keyBy: (item) => item.id,
          compareBy: (item) => JSON.stringify(item),
        },
      });

    const dispose = watchedQuery.registerListener({
      onData: (data) => {
        metrics.recordQuery();
        metrics.recordEmission();
        metrics.recordLatency(); // Uses global mutation timestamp to measure reaction time
        // differentialWatch preserves object references for unchanged items
        // Spread to convert readonly array to mutable (references inside remain stable)
        setTodos([...data]);
      },
      onDiff: (diff) => {
        metrics.recordDiff({
          added: diff.added.length,
          removed: diff.removed.length,
          updated: diff.updated.length,
          unchanged: diff.unchanged.length,
        });
      },
    });

    return () => {
      dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, listId, throttleMs]);

  // Track render count when todos change
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
          Uses <code>query.differentialWatch()</code>
        </p>
        <ul>
          <li>Skips unchanged results</li>
          <li>Preserves references</li>
          <li>Minimal re-renders</li>
          <li>Diff metadata</li>
        </ul>
      </div>
      <TodoListMetrics watchId={watchId} title="Differential Watch" />
      <ul className="todo-list">
        {todos.map((todo) => (
          <MemoizedTodoItem
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
