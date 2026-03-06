import { AbstractPowerSyncDatabase } from '@powersync/web';

/**
 * Set up metrics tracking using PowerSync database events.
 * This uses the proper event listener API instead of wrapping methods.
 */
export function setupMetricsTracking(
  db: AbstractPowerSyncDatabase,
  incrementWrites: () => void,
  recordMutationTime?: () => void
): () => void {
  // Listen to table updates via the database adapter
  // This is the proper way to track changes without modifying PowerSync internals
  const dispose = db.database.registerListener({
    tablesUpdated: () => {
      // Any table update means a write occurred
      incrementWrites();
      recordMutationTime?.();
    }
  });

  return dispose;
}
