export const ALERT_METRICS = ["cpl", "inversion", "sin_leads"] as const;
export type AlertMetric = (typeof ALERT_METRICS)[number];

export const ALERT_OPERATORS = [">", ">=", "<", "<="] as const;
export type AlertOperator = (typeof ALERT_OPERATORS)[number];

export const ALERT_METRIC_LABELS: Record<AlertMetric, string> = {
  cpl: "CPL acumulado",
  inversion: "Inversión del día",
  sin_leads: "Días sin leads",
};

export const ALERT_METRIC_HINTS: Record<AlertMetric, string> = {
  cpl: "CPL = inversión acumulada / leads acumulados (Meta+Google+TikTok)",
  inversion: "Spend del día más reciente con datos de ads cargados",
  sin_leads: "Días consecutivos sin leads desde el último día con actividad",
};

export interface AlertRuleRow {
  id: string;
  launch_id: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
