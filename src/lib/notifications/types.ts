/**
 * Notification row típica que la UI consume. Espejo del schema 0024 con los
 * campos que el panel necesita.
 *
 * `type` no es enum estricto: 7b/7c sumarán valores ('alert_crossed',
 * 'launch_started', 'ai_summary') sin migrar. La UI usa los tipos conocidos
 * para iconos y links; valores nuevos se muestran como genérico.
 */
export type NotificationSeverity = "info" | "warning" | "error";

export interface NotificationRow {
  id: string;
  project_id: string;
  launch_id: string | null;
  type: string;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  read_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
