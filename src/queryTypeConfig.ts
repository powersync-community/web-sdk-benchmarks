export type QueryType = "basic" | "incremental" | "differential" | "trigger";

export interface QueryTypeConfig {
  id: QueryType;
  label: string;
}

export const QUERY_TYPE_CONFIGS: QueryTypeConfig[] = [
  { id: "basic", label: "Basic (useQuery)" },
  { id: "incremental", label: "Incremental (rowComparator)" },
  { id: "differential", label: "Differential (differentialWatch)" },
  { id: "trigger", label: "Trigger-Based (trackTableDiff)" },
];
