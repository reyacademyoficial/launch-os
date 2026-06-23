"use client";

import { useState, useTransition } from "react";

import { triggerSync } from "@/app/(app)/proyectos/[projectId]/launches/[launchId]/sync-actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import type { SyncProviderId } from "@/lib/integrations/sync";

/**
 * Botón "Sincronizar" para un provider puntual. Estado local: pending mientras
 * corre + último mensaje de la action (success o error textual).
 *
 * No tira toast — el feedback se ve en la sección de "Estado" del provider
 * card (que se rerenderiza via revalidatePath + Realtime).
 */
export function SyncButton({
  projectId,
  launchId,
  provider,
  disabled,
  disabledReason,
  label,
  pendingLabel,
  variant,
}: {
  readonly projectId: string;
  readonly launchId: string;
  readonly provider: SyncProviderId;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  /** Label custom — default "Sincronizar". Para sub-syncs (ej. "Sync mensajes"). */
  readonly label?: string;
  /** Label mientras corre — default "Sincronizando…". */
  readonly pendingLabel?: string;
  /** Variante visual — `secondary` para syncs auxiliares (ej. messages). */
  readonly variant?: "primary" | "secondary";
}) {
  const [isPending, startTransition] = useTransition();
  const [lastError, setLastError] = useState<string | null>(null);

  function handleClick() {
    setLastError(null);
    startTransition(async () => {
      const result = await triggerSync(projectId, launchId, provider);
      if (!result.ok) {
        setLastError(
          result.errorMessage ?? `Sync terminó con estado: ${result.status}`,
        );
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        onClick={handleClick}
        disabled={isPending || disabled}
        title={disabled ? disabledReason : undefined}
        variant={variant === "secondary" ? "secondary" : undefined}
      >
        {isPending
          ? (pendingLabel ?? "Sincronizando…")
          : (label ?? "Sincronizar")}
      </Button>
      {lastError && <FieldError>{lastError}</FieldError>}
    </div>
  );
}
