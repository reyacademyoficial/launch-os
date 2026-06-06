import type { Database } from "@/lib/types/database";
import type { ForwardInput, ForwardOutput } from "@/lib/calculator/forward";
import type { ReverseInput, ReverseOutput } from "@/lib/calculator/reverse";

export type ProjectionRow = Database["public"]["Tables"]["projections"]["Row"];

export type ProjectionMode = "reverse" | "forward";

/**
 * Discriminated shape stored in `inputs` + `outputs`. Persisted as jsonb, so
 * runtime callers must validate before trusting (mode + shape can drift if a
 * past save survives a calculator math change).
 */
export type ProjectionSnapshot =
  | { mode: "reverse"; inputs: ReverseInput; outputs: ReverseOutput }
  | { mode: "forward"; inputs: ForwardInput; outputs: ForwardOutput };

export interface ProjectionListItem {
  id: string;
  name: string;
  mode: ProjectionMode;
  project_id: string;
  project_name: string;
  created_at: string;
  inputs: ReverseInput | ForwardInput;
}
