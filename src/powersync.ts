import {
  PowerSyncDatabase,
  WASQLiteVFS,
  type CommonPowerSyncDatabase,
} from "@powersync/web";
import { getSchema, type DataModel } from "./schemas";

const BACKEND_URL = "http://localhost:6060";
const POWERSYNC_URL = "http://localhost:8080";

export const DEFAULT_VFS = WASQLiteVFS.OPFSCoopSyncVFS;

/**
 * Per-model DB filenames. Giving each schema its own file means a Simple ↔
 * Complex swap opens a fresh DB instead of migrating the previous one in
 * place, so every model starts from its own clean, independently seeded data.
 */
export function defaultDbFilename(model: DataModel): string {
  return `exampleVFS-${model}.db`;
}

export interface CreateDatabaseOptions {
  model: DataModel;
  dbFilename?: string;
  vfs?: WASQLiteVFS;
}

export function createDatabase({
  model,
  dbFilename = defaultDbFilename(model),
  vfs = DEFAULT_VFS,
}: CreateDatabaseOptions): PowerSyncDatabase {
  return new PowerSyncDatabase({
    schema: getSchema(model),
    database: { dbFilename, vfs },
  });
}

export const connector = {
  async fetchCredentials() {
    const token = await fetch(`${BACKEND_URL}/api/auth/token`)
      .then((response) => response.json())
      .then((data) => data.token);
    return {
      endpoint: POWERSYNC_URL,
      token,
    };
  },
  async uploadData(database: CommonPowerSyncDatabase) {
    const transaction = await database.getNextCrudTransaction();

    if (!transaction) {
      return;
    }

    try {
      const batch = [];
      for (const operation of transaction.crud) {
        const payload = {
          op: operation.op,
          table: operation.table,
          id: operation.id,
          data: operation.opData,
        };
        batch.push(payload);
      }

      const response = await fetch(`${BACKEND_URL}/api/data`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ batch }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Received ${response.status} from /api/data: ${text}`);
      }

      console.log("Uploaded batch of size ", batch.length);
      await transaction.complete();
    } catch (ex) {
      console.debug(ex);
      throw ex;
    }
  },
};

export async function initPowerSync(powerSyncDatabase: PowerSyncDatabase) {
  // await powerSyncDatabase.connect(connector);
  await powerSyncDatabase.init();

  // await powerSyncDatabase.waitForFirstSync();

  console.log("PowerSync is ready");
}
