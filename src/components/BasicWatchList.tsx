import { useCallback, useEffect } from "react";
import { useQuery } from "@powersync/react";
import { useWatchMetrics } from "../hooks/useWatchMetrics";
import { TodoListMetrics } from "./TodoListMetrics";
import { BasicTodoItem } from "./TodoItem";
import { getTodosWatchSql, type DataModel } from "../schemas";

interface Todo {
  id: string;
  description: string;
  completed: number;
  list_id: string;
  assignee_name?: string;
  list_name?: string;
  tag_names?: string;
}

interface BasicWatchListProps {
  listId: string;
  throttleMs: number;
  watchId?: string;
  title?: string;
  model: DataModel;
}

/**
 * BasicWatchList - Uses useQuery() hook
 *
 * Key Characteristics:
 * - ⚠️ Emits on every write to `todos` table, even if filtered results unchanged
 * - ⚠️ Creates new array reference every emission
 * - ⚠️ All child components re-render even if their item didn't change
 * - ✅ Simple API with built-in loading states
 * - ✅ Built-in throttling support
 */
export function BasicWatchList({
  listId,
  throttleMs,
  watchId = "basic-watch",
  title = "Basic Watch",
  model,
}: BasicWatchListProps) {
  const metrics = useWatchMetrics(watchId);

  const { data: todos = [], isFetching } = useQuery<Todo>(
    getTodosWatchSql(model),
    [listId],
    {
      throttleMs,
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
        <p>Uses <code>db.watch()</code> with AsyncIterator</p>
        <ul>
          <li>Emits on every table write</li>
          <li>New array references</li>
          <li>All items re-render</li>
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
