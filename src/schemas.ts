import { column, Schema, Table } from "@powersync/web";

export type DataModel = "simple" | "complex";

// `assignee_id` is present in both schemas so the column shape of `todos`
// is identical across modes (avoids on-disk migrations on toggle).
// In Simple mode it is always NULL and never read.
const simpleTables = {
  lists: new Table({
    name: column.text,
    created_at: column.text,
    owner_id: column.text,
  }),
  todos: new Table({
    description: column.text,
    list_id: column.text,
    completed: column.integer,
    assignee_id: column.text,
  }),
};

export const simpleSchema = new Schema(simpleTables);

export const complexSchema = new Schema({
  ...simpleTables,
  users: new Table({
    name: column.text,
    avatar_color: column.text,
  }),
  tags: new Table({
    name: column.text,
    color: column.text,
  }),
  todo_tags: new Table({
    todo_id: column.text,
    tag_id: column.text,
  }),
});

export function getSchema(model: DataModel): Schema {
  return model === "complex" ? complexSchema : simpleSchema;
}

const SIMPLE_TODOS_SQL = "SELECT * FROM todos WHERE list_id = ?";

// ORDER BY tg.name inside GROUP_CONCAT is load-bearing: without it SQLite's
// concat order is unspecified, which causes differentialWatch's
// JSON.stringify rowComparator to report spurious `updated` rows for
// unchanged tag sets. The wider-row cost is the signal we want to expose;
// ordering churn is not.
const COMPLEX_TODOS_SQL = `SELECT t.*,
       u.name AS assignee_name,
       l.name AS list_name,
       GROUP_CONCAT(tg.name, ',' ORDER BY tg.name) AS tag_names
FROM todos t
LEFT JOIN users u      ON u.id = t.assignee_id
JOIN      lists l      ON l.id = t.list_id
LEFT JOIN todo_tags tt ON tt.todo_id = t.id
LEFT JOIN tags tg      ON tg.id = tt.tag_id
WHERE t.list_id = ?
GROUP BY t.id`;

export function getTodosWatchSql(model: DataModel): string {
  return model === "complex" ? COMPLEX_TODOS_SQL : SIMPLE_TODOS_SQL;
}
