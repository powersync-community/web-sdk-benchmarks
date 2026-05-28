import { QUERY_TYPE_CONFIGS, type QueryType } from "../queryTypeConfig";

interface VfsQueryTypePanelProps {
  queryType: QueryType;
  onChange: (type: QueryType) => void;
}

export function VfsQueryTypePanel({ queryType, onChange }: VfsQueryTypePanelProps) {
  return (
    <div className="control-section">
      <h3>Query Type</h3>
      <div className="vfs-checkbox-list">
        {QUERY_TYPE_CONFIGS.map((config) => (
          <label key={config.id} className="vfs-checkbox-label">
            <input
              type="radio"
              name="vfs-query-type"
              value={config.id}
              checked={queryType === config.id}
              onChange={() => onChange(config.id)}
            />
            {config.label}
          </label>
        ))}
      </div>
    </div>
  );
}
