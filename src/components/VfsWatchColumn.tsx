import { PowerSyncContext } from "@powersync/react";
import { type VFSInstance } from "../hooks/useVfsDatabases";
import { type QueryType } from "../queryTypeConfig";
import { BasicWatchList } from "./BasicWatchList";
import { IncrementalWatchList } from "./IncrementalWatchList";
import { DifferentialWatchList } from "./DifferentialWatchList";
import { TriggerBasedList } from "./TriggerBasedList";

interface VfsWatchColumnProps {
  instance: VFSInstance;
  listId: string;
  throttleMs: number;
  queryType: QueryType;
}

interface WatchProps {
  listId: string;
  throttleMs: number;
  watchId: string;
  title: string;
}

function WatchForType({ queryType, ...props }: WatchProps & { queryType: QueryType }) {
  switch (queryType) {
    case "basic":
      return <BasicWatchList {...props} />;
    case "incremental":
      return <IncrementalWatchList {...props} />;
    case "differential":
      return <DifferentialWatchList {...props} />;
    case "trigger":
      return <TriggerBasedList {...props} />;
  }
}

export function VfsWatchColumn({
  instance,
  listId,
  throttleMs,
  queryType,
}: VfsWatchColumnProps) {
  const watchId = `vfs-${instance.config.id}`;
  const { status, config, db, error } = instance;

  if (status === "error") {
    return (
      <div className="watch-container vfs-status">
        <div className="vfs-column-header">{config.label}</div>
        <p className="vfs-status-message warning">
          Failed to initialize: {error?.message ?? "Unknown error"}
        </p>
      </div>
    );
  }

  if (status !== "ready") {
    return (
      <div className="watch-container vfs-status">
        <div className="vfs-column-header">{config.label}</div>
        <div className="vfs-spinner-wrap">
          <span className="vfs-spinner" />
          <span className="vfs-status-message">
            {status === "initializing" ? "Initializing…" : "Pending…"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <PowerSyncContext value={db}>
      <WatchForType
        queryType={queryType}
        listId={listId}
        throttleMs={throttleMs}
        watchId={watchId}
        title={config.label}
      />
    </PowerSyncContext>
  );
}
