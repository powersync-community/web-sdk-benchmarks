import { memo, useEffect } from "react";
import { usePowerSync } from "@powersync/react";
import { useFlashEffect } from "../hooks/useFlashEffect";

interface Todo {
  id: string;
  description: string;
  completed: number;
  list_id: string;
  // Complex-mode JOIN fields (optional)
  assignee_name?: string;
  list_name?: string;
  /** GROUP_CONCAT(tag.name ORDER BY tag.name) — comma-separated string */
  tag_names?: string;
}

interface TodoItemProps {
  todo: Todo;
  isNew?: boolean;
  isUpdated?: boolean;
  onRender?: () => void;
}

function TodoMeta({ todo }: { todo: Todo }) {
  const hasAssignee = !!todo.assignee_name;
  const hasList = !!todo.list_name;
  const tags = todo.tag_names ? todo.tag_names.split(",").filter(Boolean) : [];
  if (!hasAssignee && !hasList && tags.length === 0) return null;
  return (
    <span className="todo-meta">
      {hasAssignee && (
        <span className="assignee-chip">@{todo.assignee_name}</span>
      )}
      {tags.map((t) => (
        <span key={t} className="tag-pill">
          {t}
        </span>
      ))}
      {hasList && <span className="list-name">{todo.list_name}</span>}
    </span>
  );
}

/**
 * Basic TodoItem component - always re-renders when parent re-renders
 */
export function BasicTodoItem({ todo, onRender }: TodoItemProps) {
  const db = usePowerSync();
  const flash = useFlashEffect([todo]);

  // Track item render
  useEffect(() => {
    onRender?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todo]);

  const toggleTodo = async () => {
    const newCompleted = todo.completed === 0 ? 1 : 0;
    await db?.execute(
      `UPDATE todos SET completed = ? WHERE id = ?`,
      [newCompleted, todo.id],
    );
  };

  return (
    <li className={flash ? "flash" : ""}>
      <input
        type="checkbox"
        checked={todo.completed === 1}
        onChange={toggleTodo}
      />
      <span
        style={{
          textDecoration: todo.completed === 1 ? "line-through" : "none",
        }}
      >
        {todo.description}
      </span>
      <TodoMeta todo={todo} />
    </li>
  );
}

/**
 * Memoized TodoItem component - only re-renders when props change
 * Works best with differential watch's reference preservation
 */
const TodoItemComponent = ({
  todo,
  isNew,
  isUpdated,
  onRender,
}: TodoItemProps) => {
  const db = usePowerSync();
  const flash = useFlashEffect([todo]);

  // Track item render
  useEffect(() => {
    onRender?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todo]);

  const toggleTodo = async () => {
    const newCompleted = todo.completed === 0 ? 1 : 0;
    await db?.execute(
      `UPDATE todos SET completed = ? WHERE id = ?`,
      [newCompleted, todo.id],
    );
  };

  return (
    <li className={flash ? "flash" : ""}>
      <input
        type="checkbox"
        checked={todo.completed === 1}
        onChange={toggleTodo}
      />
      <span
        style={{
          textDecoration: todo.completed === 1 ? "line-through" : "none",
        }}
      >
        {todo.description}
      </span>
      <TodoMeta todo={todo} />
      {isNew && <span className="badge new">New</span>}
      {isUpdated && <span className="badge updated">Updated</span>}
    </li>
  );
};

// Custom comparator that only checks todo reference for memoization.
// With differentialWatch, unchanged items keep the same object reference,
// so reference equality is sufficient and enables maximum memo benefit.
export const MemoizedTodoItem = memo(TodoItemComponent, (prev, next) => {
  return prev.todo === next.todo;
});
