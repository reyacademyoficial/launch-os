"use client";

import { useState, useTransition } from "react";

import { triggerSync } from "@/app/(app)/(kg)/proyectos/[projectId]/launches/[launchId]/sync-actions";
import {
  ErrorBanner,
  primaryBtn,
  secondaryBtn,
} from "@/components/kg/form-primitives";
import { StateDot } from "@/components/kg/state-dot";
import type { SyncProviderId } from "@/lib/integrations/sync";

/**
 * Botón "Sincronizar" para un provider puntual. Estado local: pending mientras
 * corre + último mensaje de la action (success o error textual).
 *
 * No tira toast — el feedback se ve en la sección de "Estado" del provider
 * card (que se rerenderiza via revalidatePath + Realtime).
 *
 * El "está corriendo" se comunica con un `StateDot` de acento adelante del
 * label, no pintando el texto del botón: el color semántico vive en el dot
 * (regla del design system), el botón se queda con su tono de jerarquía.
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

  const isBlocked = isPending || disabled === true;
  const base = variant === "secondary" ? secondaryBtn : primaryBtn;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 6,
        minWidth: 0,
      }}
    >
      <button
        type="button"
        onClick={handleClick}
        disabled={isBlocked}
        title={disabled ? disabledReason : undefined}
        className="kg-focus"
        style={{
          ...base,
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          whiteSpace: "nowrap",
          opacity: isBlocked ? 0.5 : 1,
          cursor: isBlocked ? "not-allowed" : "pointer",
        }}
      >
        {isPending && <StateDot tone="accent" />}
        {isPending
          ? (pendingLabel ?? "Sincronizando…")
          : (label ?? "Sincronizar")}
      </button>
      {lastError && (
        // El error del sync puede ser una respuesta larga del provider; se le
        // pone techo para que no estire la columna de acciones del card.
        <div style={{ maxWidth: 280 }}>
          <ErrorBanner message={lastError} />
        </div>
      )}
    </div>
  );
}
