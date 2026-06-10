export interface AiRunRow {
  id: string;
  launch_id: string;
  project_id: string;
  user_id: string | null;
  model: string;
  status: "success" | "error";
  output_text: string | null;
  error_detail: unknown;
  created_at: string;
}
