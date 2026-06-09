"use client";

import { useActionState, useEffect, useState } from "react";

import {
  saveIntegrationConfig,
  saveLaunchSecret,
  type SyncActionState,
} from "@/app/(app)/proyectos/[projectId]/launches/[launchId]/sync-actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SyncProviderId } from "@/lib/integrations/sync";

/**
 * Modal de configuración por provider. Tres pasos en un mismo modal:
 *   1) Pegar el token (`saveLaunchSecret`).
 *   2) Cargar ad_account_id + campaign_ids (`saveIntegrationConfig`).
 *
 * Las dos forms son independientes — el usuario puede guardar el token sin
 * tocar la config (útil para reconectar) y viceversa.
 */
export function ConfigModal({
  projectId,
  launchId,
  provider,
  providerLabel,
  hasSecret,
  initialAdAccountId,
  initialCampaignIds,
}: {
  readonly projectId: string;
  readonly launchId: string;
  readonly provider: SyncProviderId;
  readonly providerLabel: string;
  readonly hasSecret: boolean;
  readonly initialAdAccountId: string;
  readonly initialCampaignIds: readonly string[];
}) {
  const [open, setOpen] = useState(false);

  const boundConfig = saveIntegrationConfig.bind(null, projectId, launchId, provider);
  const [configState, configAction, configPending] = useActionState<
    SyncActionState,
    FormData
  >(boundConfig, null);

  const boundSecret = saveLaunchSecret.bind(null, projectId, launchId, provider);
  const [secretState, secretAction, secretPending] = useActionState<
    SyncActionState,
    FormData
  >(boundSecret, null);

  // Cerrar modal solo cuando AMBOS pasos saliero ok al menos una vez. En la
  // práctica el usuario tipea token, guarda, después config, guarda, listo.
  const configOk = configState && "ok" in configState && configState.ok;
  const secretOk = secretState && "ok" in secretState && secretState.ok;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (configOk && (secretOk || hasSecret)) setOpen(false);
  }, [configOk, secretOk, hasSecret]);

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen(true)}
        className="!px-3 !py-1.5 !text-xs"
      >
        {hasSecret ? "Editar conexión" : "Conectar"}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="config-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-md border border-border bg-bg-elevated shadow-card">
            <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div>
                <h3
                  id="config-modal-title"
                  className="text-lg font-bold text-fg"
                >
                  Conectar {providerLabel}
                </h3>
                <p className="mt-1 text-xs text-fg-subtle">
                  Necesitás el access token + el ad_account_id + al menos una campaña.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="text-fg-subtle hover:text-fg"
              >
                ×
              </button>
            </header>
            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
              {/* Paso 1: token */}
              <form action={secretAction} className="space-y-3">
                <div>
                  <Label htmlFor="secret">
                    Access token (System User) {hasSecret && (
                      <span className="ml-2 text-xs text-success">· guardado</span>
                    )}
                  </Label>
                  <Input
                    id="secret"
                    name="secret"
                    type="password"
                    autoComplete="off"
                    placeholder={
                      hasSecret
                        ? "Dejá vacío para no cambiarlo · pegá uno nuevo para reconectar"
                        : "EAAB... (pegá el token completo)"
                    }
                  />
                  <p className="mt-1 text-xs text-fg-subtle">
                    Nunca lo vamos a mostrar de nuevo. Si lo perdés, generás uno nuevo desde Meta Business Manager.
                  </p>
                </div>
                <div className="flex items-center justify-end gap-3">
                  {secretState && "error" in secretState && (
                    <FieldError>{secretState.error}</FieldError>
                  )}
                  <Button type="submit" disabled={secretPending}>
                    {secretPending ? "Guardando…" : "Guardar token"}
                  </Button>
                </div>
              </form>

              <div className="h-px bg-border" />

              {/* Paso 2: ad account + campaigns */}
              <form action={configAction} className="space-y-3">
                <div>
                  <Label htmlFor="ad_account_id">Ad Account ID</Label>
                  <Input
                    id="ad_account_id"
                    name="ad_account_id"
                    type="text"
                    autoComplete="off"
                    placeholder="act_1234567890"
                    defaultValue={initialAdAccountId}
                  />
                  <p className="mt-1 text-xs text-fg-subtle">
                    Arranca con <code className="text-fg">act_</code>.
                  </p>
                </div>
                <div>
                  <Label htmlFor="campaign_ids">
                    Campaign IDs <span className="text-xs text-fg-subtle">(al menos 1)</span>
                  </Label>
                  <Input
                    id="campaign_ids"
                    name="campaign_ids"
                    type="text"
                    autoComplete="off"
                    placeholder="120203456789 120204567891"
                    defaultValue={initialCampaignIds.join(" ")}
                  />
                  <p className="mt-1 text-xs text-fg-subtle">
                    Separados por coma o espacio. Sin esto no podemos atribuir el gasto a este lanzamiento.
                  </p>
                </div>
                <div className="flex items-center justify-end gap-3">
                  {configState && "error" in configState && (
                    <FieldError>{configState.error}</FieldError>
                  )}
                  <Button type="submit" disabled={configPending}>
                    {configPending ? "Guardando…" : "Guardar config"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
