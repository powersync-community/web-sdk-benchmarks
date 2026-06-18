import { usePowerSync } from "@powersync/react";
import { AbstractPowerSyncDatabase } from "@powersync/web";
import { useMetricsActions } from "../stores/metricsStore";
import { useDataModelStore } from "../stores/dataModelStore";
import { type DataModel } from "../schemas";
import { Tooltip } from "./Tooltip";

interface ControlPanelProps {
  listId: string;
  throttleMs: number;
  onThrottleChange: (value: number) => void;
  onToggleList: () => void;
  databases?: AbstractPowerSyncDatabase[];
  extraControls?: React.ReactNode;
  model: DataModel;
}

const COMPLEX_USER_COUNT = 5;
const COMPLEX_TAG_COUNT = 8;
const AVATAR_COLORS = ["#f87171", "#fbbf24", "#34d399", "#60a5fa", "#a78bfa"];
const TAG_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

interface SeededComplexRefs {
  userIds: string[];
  tagIds: string[];
}

/**
 * Ensure `n` users and `m` tags exist; reuse existing rows on repeat seeds so
 * todos keep referencing valid IDs and we don't bloat the demo dataset.
 */
async function ensureUsersAndTags(
  db: AbstractPowerSyncDatabase,
): Promise<SeededComplexRefs> {
  const existingUsers = await db.getAll<{ id: string }>(
    `SELECT id FROM users LIMIT ?`,
    [COMPLEX_USER_COUNT],
  );
  const existingTags = await db.getAll<{ id: string }>(
    `SELECT id FROM tags LIMIT ?`,
    [COMPLEX_TAG_COUNT],
  );
  const userIds = existingUsers.map((u) => u.id);
  const tagIds = existingTags.map((t) => t.id);

  await db.writeTransaction(async (tx) => {
    for (let i = userIds.length; i < COMPLEX_USER_COUNT; i++) {
      const id = crypto.randomUUID();
      await tx.execute(
        `INSERT INTO users (id, name, avatar_color) VALUES (?, ?, ?)`,
        [id, `User ${i + 1}`, AVATAR_COLORS[i % AVATAR_COLORS.length]],
      );
      userIds.push(id);
    }
    for (let i = tagIds.length; i < COMPLEX_TAG_COUNT; i++) {
      const id = crypto.randomUUID();
      await tx.execute(`INSERT INTO tags (id, name, color) VALUES (?, ?, ?)`, [
        id,
        `tag-${i + 1}`,
        TAG_COLORS[i % TAG_COLORS.length],
      ]);
      tagIds.push(id);
    }
  });

  return { userIds, tagIds };
}

/**
 * Seed N complex todos against `listId`. Each todo gets a random `assignee_id`
 * and 0–3 tag links via `todo_tags`. Runs inside a single writeTransaction.
 */
async function seedComplexData(
  db: AbstractPowerSyncDatabase,
  listId: string,
  n: number,
): Promise<void> {
  const { userIds, tagIds } = await ensureUsersAndTags(db);

  // Make sure the list itself exists in the lists table so the JOIN
  // produces non-empty list_name and complex JOINs match.
  const existingList = await db.getOptional<{ id: string }>(
    `SELECT id FROM lists WHERE id = ?`,
    [listId],
  );
  if (!existingList) {
    await db.execute(
      `INSERT INTO lists (id, name, created_at, owner_id) VALUES (?, ?, ?, ?)`,
      [
        listId,
        `List ${listId.slice(0, 8)}`,
        new Date().toISOString(),
        userIds[0] ?? null,
      ],
    );
  }

  await db.writeTransaction(async (tx) => {
    for (let i = 0; i < n; i++) {
      const todoId = crypto.randomUUID();
      const assigneeId = userIds[Math.floor(Math.random() * userIds.length)];
      await tx.execute(
        `INSERT INTO todos (id, description, list_id, completed, assignee_id) VALUES (?, ?, ?, ?, ?)`,
        [todoId, `Todo ${i + 1}`, listId, 0, assigneeId],
      );
      const tagCount = Math.floor(Math.random() * 4); // 0..3
      const shuffled = [...tagIds].sort(() => Math.random() - 0.5);
      for (let t = 0; t < tagCount; t++) {
        await tx.execute(
          `INSERT INTO todo_tags (id, todo_id, tag_id) VALUES (?, ?, ?)`,
          [crypto.randomUUID(), todoId, shuffled[t]],
        );
      }
    }
  });
}

export function ControlPanel({
  listId,
  throttleMs,
  onThrottleChange,
  onToggleList,
  databases,
  extraControls,
  model,
}: ControlPanelProps) {
  const contextDb = usePowerSync();
  const { resetAllMetrics } = useMetricsActions();
  const setModel = useDataModelStore((s) => s.setModel);
  const activeDatabases =
    databases && databases.length > 0
      ? databases
      : contextDb
        ? [contextDb]
        : [];

  const seedData = async () => {
    if (activeDatabases.length === 0) return;
    await Promise.all(
      activeDatabases.map(async (db) => {
        if (model === "complex") {
          await seedComplexData(db, listId, 100);
          return;
        }
        await db.writeTransaction(async (tx) => {
          for (let i = 0; i < 100; i++) {
            const id = crypto.randomUUID();
            await tx.execute(
              `INSERT INTO todos (id, description, list_id, completed) VALUES (?, ?, ?, ?)`,
              [id, `Todo ${i + 1}`, listId, 0],
            );
          }
        });
      }),
    );
  };

  const seedLargeDataset = async () => {
    if (activeDatabases.length === 0) return;
    await Promise.all(
      activeDatabases.map(async (db) => {
        if (model === "complex") {
          await seedComplexData(db, listId, 500);
          return;
        }
        await db.writeTransaction(async (tx) => {
          for (let i = 0; i < 500; i++) {
            const id = crypto.randomUUID();
            await tx.execute(
              `INSERT INTO todos (id, description, list_id, completed) VALUES (?, ?, ?, ?)`,
              [id, `Large dataset todo ${i + 1}`, listId, 0],
            );
          }
        });
      }),
    );
  };

  const rapidUpdates = async () => {
    if (activeDatabases.length === 0) return;
    await Promise.all(
      activeDatabases.map(async (db) => {
        const todos = await db.getAll<{ id: string }>(
          `SELECT id FROM todos WHERE list_id = ? LIMIT 25`,
          [listId],
        );
        for (const todo of todos) {
          await db.execute(`UPDATE todos SET completed = ? WHERE id = ?`, [
            Math.random() > 0.5 ? 1 : 0,
            todo.id,
          ]);
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
      }),
    );
  };

  const singleUpdate = async () => {
    if (activeDatabases.length === 0) return;
    await Promise.all(
      activeDatabases.map(async (db) => {
        const todos = await db.getAll<{ id: string; completed: number }>(
          `SELECT id, completed FROM todos WHERE list_id = ? LIMIT 1`,
          [listId],
        );
        if (todos.length > 0) {
          const todo = todos[0];
          await db.execute(`UPDATE todos SET completed = ? WHERE id = ?`, [
            todo.completed === 0 ? 1 : 0,
            todo.id,
          ]);
        }
      }),
    );
  };

  const updateUnrelatedTable = async () => {
    if (activeDatabases.length === 0) return;
    const otherListId =
      listId === "75f89104-d95a-4f16-8309-5363f1bb377a"
        ? "c1e2f3a4-5678-90ab-cdef-1234567890ab"
        : "75f89104-d95a-4f16-8309-5363f1bb377a";

    await Promise.all(
      activeDatabases.map(async (db) => {
        const todos = await db.getAll<{ id: string; completed: number }>(
          `SELECT id, completed FROM todos WHERE list_id = ? LIMIT 1`,
          [otherListId],
        );
        if (todos.length > 0) {
          const todo = todos[0];
          await db.execute(`UPDATE todos SET completed = ? WHERE id = ?`, [
            todo.completed === 0 ? 1 : 0,
            todo.id,
          ]);
        } else {
          const id = crypto.randomUUID();
          await db.execute(
            `INSERT INTO todos (id, description, list_id, completed) VALUES (?, ?, ?, ?)`,
            [id, "Unrelated todo", otherListId, 0],
          );
        }
      }),
    );
  };

  const cleanData = async () => {
    if (activeDatabases.length === 0) return;
    await Promise.all(
      activeDatabases.map(async (db) => {
        if (model === "complex") {
          // FK-respecting order even though PowerSync doesn't enforce them — readable.
          await db.execute(`DELETE FROM todo_tags`);
          await db.execute(`DELETE FROM todos`);
          await db.execute(`DELETE FROM tags`);
          await db.execute(`DELETE FROM users`);
          await db.execute(`DELETE FROM lists`);
          return;
        }
        await db.execute(`DELETE FROM todos`);
      }),
    );
    resetAllMetrics();
  };

  return (
    <aside className="control-panel">
      <div className="control-section">
        <h3>
          Data Model
          <Tooltip
            content={
              <>
                Switches the PowerSync schema used by all watch and VFS
                columns. The DB closes and re-opens with the new schema;
                existing tables stay on disk as residual storage.
              </>
            }
          />
        </h3>
        <div className="data-model-toggle" role="radiogroup">
          <label className="data-model-option">
            <span className="data-model-option-main">
              <input
                type="radio"
                name="data-model"
                value="simple"
                checked={model === "simple"}
                onChange={() => setModel("simple")}
              />
              <span>Simple</span>
            </span>
            <span className="data-model-hint">
              <code>todos</code> + <code>lists</code>
            </span>
          </label>
          <label className="data-model-option">
            <span className="data-model-option-main">
              <input
                type="radio"
                name="data-model"
                value="complex"
                checked={model === "complex"}
                onChange={() => setModel("complex")}
              />
              <span>Complex</span>
              <Tooltip
                content={
                  <>
                    Simple ↔ Complex timings are <strong>not</strong> directly
                    comparable — complex seeds write ~2.5× the rows and the
                    watch reactor is heavier. Compare <em>within</em> Complex
                    across strategies/VFS instead.
                  </>
                }
              />
            </span>
            <span className="data-model-hint">
              5 tables, JOIN-heavy watch
            </span>
          </label>
        </div>
      </div>

      {extraControls}

      <div className="control-section">
        <h3>
          Test Scenarios
          <Tooltip content="Run different operations to observe watch query behavior." />
        </h3>

        <div className="control-group">
          <h4>Data Operations</h4>
          <button onClick={seedData} className="control-button">
            <span className="button-label">Seed 100</span>
            <Tooltip
              variant="corner"
              content={
                model === "complex"
                  ? "Creates 100 todos with random assignees and 0–3 tags each. Also seeds ~5 users + ~8 tags on first run."
                  : "Creates 100 todos. Tests medium datasets — Incremental & Differential should prevent unnecessary emissions."
              }
            />
          </button>

          <button onClick={seedLargeDataset} className="control-button">
            <span className="button-label">Seed 500</span>
            <Tooltip
              variant="corner"
              content={
                model === "complex"
                  ? "Creates 500 todos plus their tag links. Large dataset stress-tests the JOIN-heavy watch."
                  : "Creates 500 todos. Large dataset where Trigger-Based shines (O(1) overhead vs O(n) for Differential)."
              }
            />
          </button>

          <button onClick={cleanData} className="control-button danger">
            <span className="button-label">Clean Data</span>
            <Tooltip
              variant="corner"
              content={
                model === "complex"
                  ? "Deletes todo_tags → todos → tags → users → lists. All watches emit with empty results."
                  : "Deletes all todos. All watches emit with empty results."
              }
            />
          </button>
        </div>

        <div className="control-group">
          <h4>Update Patterns</h4>
          <button onClick={singleUpdate} className="control-button">
            <span className="button-label">Single Update</span>
            <Tooltip
              variant="corner"
              content="Updates 1 todo. Minimal change — Differential preserves references for other rows, enabling React.memo optimization."
            />
          </button>

          <button onClick={rapidUpdates} className="control-button">
            <span className="button-label">Rapid Updates (25)</span>
            <Tooltip
              variant="corner"
              content="25 updates in ~1 second. Shows throttling in action — watch emissions are batched (default 30ms trailing edge)."
            />
          </button>

          <button onClick={updateUnrelatedTable} className="control-button">
            <span className="button-label">Update Unrelated List</span>
            <Tooltip
              variant="corner"
              content="Updates a different list. Basic Watch emits unnecessarily. Incremental/Differential/Trigger-Based filter this out."
            />
          </button>
        </div>

        <div className="control-group">
          <h4>View Control</h4>
          <button onClick={onToggleList} className="control-button">
            <span className="button-label">Toggle List</span>
            <Tooltip
              variant="corner"
              content="Switches between two different lists. All watches re-query with new list_id parameter."
            />
          </button>
        </div>
      </div>

      <div className="control-section">
        <h3>Settings</h3>
        <div className="throttle-control">
          <label htmlFor="throttle">
            Throttle: <strong>{throttleMs}ms</strong>
            <Tooltip content="Trailing-edge throttle delay. Higher values reduce query frequency during rapid writes but decrease UI responsiveness." />
          </label>
          <input
            id="throttle"
            type="range"
            min="0"
            max="1000"
            step="50"
            value={throttleMs}
            onChange={(e) => onThrottleChange(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="control-section legend">
        <h3>Watch Types</h3>
        <dl>
          <dt>Basic</dt>
          <dd>Re-queries on any table change, even if results unchanged</dd>

          <dt>Incremental</dt>
          <dd>Adds equality checking to prevent unnecessary emissions</dd>

          <dt>Differential</dt>
          <dd>Preserves object references for unchanged rows</dd>

          <dt>Trigger-Based</dt>
          <dd>
            {model === "complex"
              ? "Triggered re-execution of the JOIN over affected rows. The O(writes) framing only applies in Simple mode."
              : "Records changes at write time (O(writes) vs O(result set))"}
          </dd>
        </dl>
      </div>
    </aside>
  );
}
