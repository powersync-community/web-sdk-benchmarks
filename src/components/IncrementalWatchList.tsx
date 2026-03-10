import { useCallback, useEffect } from "react";
import { useQuery } from "@powersync/react";
import { useWatchMetrics } from "../hooks/useWatchMetrics";
import { TodoListMetrics } from "./TodoListMetrics";
import { MemoizedTodoItem } from "./TodoItem";

interface Todo {
  id: string;
  description: string;
  completed: number;
  list_id: string;
}

interface IncrementalWatchListProps {
  listId: string;
  throttleMs: number;
  watchId?: string;
  title?: string;
}

/**
 * IncrementalWatchList - Uses useQuery with rowComparator
 *
 * Key Characteristics:
 * - ✅ Skips emissions when results haven't changed (via rowComparator)
 * - ✅ Efficient row-level comparison instead of JSON.stringify
 * - ⚠️ Still creates new array reference when emitting
 * - ⚠️ Child components still re-render (no memo benefit)
 */
export function IncrementalWatchList({
  listId,
  throttleMs,
  watchId = "incremental-watch",
  title = "Incremental Watch",
}: IncrementalWatchListProps) {
  const metrics = useWatchMetrics(watchId);

  const { data: todos = [], isFetching } = useQuery<Todo>(
    "SELECT * FROM todos WHERE list_id = ?",
    [listId],
    {
      throttleMs,
      rowComparator: {
        keyBy: (item: Todo) => item.id,
        compareBy: (item: Todo) => JSON.stringify(item),
      },
    }
  );

  // Track metrics when query emits
  useEffect(() => {
    if (isFetching) {
      // Query started
      metrics.recordQuery();
      metrics.recordEmission();
    } else {
      // Query completed - record latency from last mutation
      metrics.recordLatency();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFetching]);

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
    []
  );

  return (
    <div className="watch-container">
      <div className="description">
        <p>Uses <code>query.watch({"{ comparator }"})</code></p>
        <ul>
          <li>Skips unchanged results</li>
          <li>Preserves references</li>
          <li>Memo-optimized</li>
        </ul>
      </div>
      <TodoListMetrics watchId={watchId} title={title} />
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
