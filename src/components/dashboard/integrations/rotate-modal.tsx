"use client";

import { useActionState, useEffect, useState } from "react";

import type { IntegrationActionState } from "@/app/(app)/proyectos/[projectId]/integraciones/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProviderConfig } from "@/lib/integrations/types";

type FormAction = (
  prev: IntegrationActionState,
  formData: FormData,
) => Promise<IntegrationActionState>;

export function RotateModal({
  provider,
  action,
}: {
  readonly provider: ProviderConfig;
  readonly action: FormAction;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<IntegrationActionState, FormData>(
    action,
    null,
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (state && "ok" in state && state.ok) setOpen(false);
  }, [state]);

  function close() {
    if (!pending) setOpen(false);
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Rotar
      </Button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="rotate-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="w-full max-w-md rounded-md border border-border bg-bg-elevated p-6 shadow-card">
            <header className="mb-4 flex items-center justify-between">
              <h3 id="rotate-title" className="text-lg font-bold text-fg">
                Rotar credencial — {provider.name}
              </h3>
              <button
                type="button"
                onClick={close}
                disabled={pending}
                aria-label="Cerrar"
                className="text-fg-subtle hover:text-fg"
              >
                ×
              </button>
            </header>

            <p className="mb-4 text-xs text-fg-muted">
              La credencial actual se reemplaza por la nueva. La cuenta asociada
              ({provider.accountLabel}) no cambia.
            </p>

            <form action={formAction} className="space-y-4">
              <input type="hidden" name="provider" value={provider.id} />
              <div>
                <Label htmlFor="rotate-secret">Nueva {provider.secretLabel.toLowerCase()}</Label>
                <Input
                  id="rotate-secret"
                  name="secret"
                  type="password"
                  required
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={close}
                  disabled={pending}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Rotando…" : "Guardar"}
                </Button>
              </div>

              {state && "error" in state && <FieldError>{state.error}</FieldError>}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
