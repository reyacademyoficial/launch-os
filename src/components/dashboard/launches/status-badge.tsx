import { Badge } from "@/components/ui/badge";
import type { LaunchStatus } from "@/lib/launches/types";

const STATUS_VARIANT: Record<LaunchStatus, "success" | "warning" | "info" | "neutral"> = {
  Activo: "success",
  Escalando: "warning",
  Evergreen: "info",
  Finalizado: "neutral",
};

export function StatusBadge({ status }: { readonly status: LaunchStatus | string | null }) {
  if (!status) return <span className="text-fg-subtle">—</span>;
  const variant = STATUS_VARIANT[status as LaunchStatus] ?? "neutral";
  return <Badge variant={variant}>{status}</Badge>;
}
