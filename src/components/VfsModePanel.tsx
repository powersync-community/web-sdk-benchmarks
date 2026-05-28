import { VFS_CONFIGS } from "../vfsConfig";

interface VfsModePanelProps {
  activeVfsIds: Set<string>;
  onToggle: (id: string) => void;
}

export function VfsModePanel({ activeVfsIds, onToggle }: VfsModePanelProps) {
  return (
    <div className="control-section">
      <h3>VFS Backends</h3>
      <div className="vfs-checkbox-list">
        {VFS_CONFIGS.map((config) => {
          const isLastActive =
            activeVfsIds.size === 1 && activeVfsIds.has(config.id);
          return (
            <label key={config.id} className="vfs-checkbox-label">
              <input
                type="checkbox"
                checked={activeVfsIds.has(config.id)}
                onChange={() => onToggle(config.id)}
                disabled={isLastActive}
              />
              {config.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}
