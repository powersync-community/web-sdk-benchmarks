import { usePowerSync } from "@powersync/react";
import { AbstractPowerSyncDatabase } from "@powersync/web";
import { useMetricsActions } from "../stores/metricsStore";

interface ControlPanelProps {
  listId: string;
  throttleMs: number;
  onThrottleChange: (value: number) => void;
  onToggleList: () => void;
  databases?: AbstractPowerSyncDatabase[];
  extraControls?: React.ReactNode;
}

export function ControlPanel({
  listId,
  throttleMs,
  onThrottleChange,
  onToggleList,
  databases,
  extraControls,
}: ControlPanelProps) {
  const contextDb = usePowerSync();
  const { resetAllMetrics } = useMetricsActions();
  const activeDatabases =
    databases && databases.length > 0
      ? databases
      : contextDb
        ? [contextDb]
        : [];

  const seedData = async () => {
    if (activeDatabases.length === 0) return;
    await Promise.all(
      activeDatabases.map((db) =>
        db.writeTransaction(async (tx) => {
          for (let i = 0; i < 100; i++) {
            const id = crypto.randomUUID();
            await tx.execute(
              `INSERT INTO todos (id, description, list_id, completed) VALUES (?, ?, ?, ?)`,
              [id, `Todo ${i + 1}`, listId, 0],
            );
          }
        }),
      ),
    );
  };

  const seedLargeDataset = async () => {
    if (activeDatabases.length === 0) return;
    await Promise.all(
      activeDatabases.map((db) =>
        db.writeTransaction(async (tx) => {
          for (let i = 0; i < 500; i++) {
            const id = crypto.randomUUID();
            await tx.execute(
              `INSERT INTO todos (id, description, list_id, completed) VALUES (?, ?, ?, ?)`,
              [id, `Large dataset todo ${i + 1}`, listId, 0],
            );
          }
        }),
      ),
    );
  };

  const rapidUpdates = async () => {
    if (activeDatabases.length === 0) return;
    // For rapid updates, broadcast per-DB independently (each has its own data)
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
    await Promise.all(activeDatabases.map((db) => db.execute(`DELETE FROM todos`)));
    resetAllMetrics();
  };

  return (
    <aside className="control-panel">
      <div className="control-section">
        <h3>Test Scenarios</h3>
        <p className="section-description">
          Run different operations to observe watch query behavior
        </p>

        <div className="control-group">
          <h4>Data Operations</h4>
          <button onClick={seedData} className="control-button">
            <span className="button-label">Seed 100</span>
            <span className="button-description">
              Creates 100 todos. Tests medium datasets - Incremental &amp;
              Differential should prevent unnecessary emissions.
            </span>
          </button>

          <button onClick={seedLargeDataset} className="control-button">
            <span className="button-label">Seed 500</span>
            <span className="button-description">
              Creates 500 todos. Large dataset where Trigger-Based shines (O(1)
              overhead vs O(n) for Differential).
            </span>
          </button>

          <button onClick={cleanData} className="control-button danger">
            <span className="button-label">Clean Data</span>
            <span className="button-description">
              Deletes all todos. All watches emit with empty results.
            </span>
          </button>
        </div>

        <div className="control-group">
          <h4>Update Patterns</h4>
          <button onClick={singleUpdate} className="control-button">
            <span className="button-label">Single Update</span>
            <span className="button-description">
              Updates 1 todo. Minimal change - Differential preserves references
              for other rows, enabling React.memo optimization.
            </span>
          </button>

          <button onClick={rapidUpdates} className="control-button">
            <span className="button-label">Rapid Updates (25)</span>
            <span className="button-description">
              25 updates in ~1 second. Shows throttling in action - watch
              emissions are batched (default 30ms trailing edge).
            </span>
          </button>

          <button onClick={updateUnrelatedTable} className="control-button">
            <span className="button-label">Update Unrelated List</span>
            <span className="button-description">
              Updates a different list. Basic Watch emits unnecessarily.
              Incremental/Differential/Trigger-Based filter this out.
            </span>
          </button>
        </div>

        <div className="control-group">
          <h4>View Control</h4>
          <button onClick={onToggleList} className="control-button">
            <span className="button-label">Toggle List</span>
            <span className="button-description">
              Switches between two different lists. All watches re-query with
              new list_id parameter.
            </span>
          </button>
        </div>
      </div>

      <div className="control-section">
        <h3>Settings</h3>
        <div className="throttle-control">
          <label htmlFor="throttle">
            Throttle: <strong>{throttleMs}ms</strong>
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
          <p className="setting-description">
            Trailing-edge throttle delay. Higher values reduce query frequency
            during rapid writes but decrease UI responsiveness.
          </p>
        </div>
      </div>

      {extraControls}

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
          <dd>Records changes at write time (O(writes) vs O(result set))</dd>
        </dl>
      </div>
    </aside>
  );
}
