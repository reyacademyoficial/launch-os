"use client";

/* eslint-disable react-hooks/set-state-in-effect */
// Disable a nivel archivo: este modal usa el patrón clásico "fetch on open" —
// cuando `open` pasa a true, reseteo el state de UI a "loading" y disparo el
// fetch. La regla nueva de React 19 desincentiva setState sincrónico dentro
// de effects para evitar render cascades; acá el cascade es deseado (loading
// → data) y reorganizar con useReducer sería overengineering. La alternativa
// natural (derivar loading del data) tampoco aplica porque hay error states
// independientes (loadError vs saveError vs saveOk).

import { useEffect, useState, useTransition } from "react";

import {
  listGhlUserMappings,
  saveGhlUserMappings,
  type GhlUserMappingsData,
} from "@/app/(app)/(kg)/proyectos/[projectId]/launches/[launchId]/sync-actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";

/**
 * Modal "Mapear vendedores GHL". Carga lazy on-open (fetch a GHL es lento).
 * Por cada GHL user del location del launch, dropdown para asignar un team_member
 * del proyecto. "—" deja el mapping vacío (lead que venga con ese assignedTo
 * no se asignará a nadie).
 *
 * El mapping vive a nivel proyecto (no launch): los GHL users son los mismos
 * entre launches del cliente, no tiene sentido repetir el laburo.
 */
export function GhlMappingModal({
  projectId,
  launchId,
}: {
  readonly projectId: string;
  readonly launchId: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [data, setData] = useState<GhlUserMappingsData | null>(null);
  /** Estado editable: ghlUserId → teamMemberId (string vacío = sin asignar). */
  const [edits, setEdits] = useState<Map<string, string>>(new Map());
  const [saving, startSaving] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  // Lazy load al abrir. Ver disable a nivel archivo arriba.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setLoadError(null);
    setSaveOk(false);
    setSaveError(null);
    listGhlUserMappings(projectId, launchId)
      .then((r) => {
        if ("error" in r) {
          setLoadError(r.error);
          setData(null);
        } else {
          setData(r.data);
          const seed = new Map<string, string>();
          for (const m of r.data.currentMappings) seed.set(m.ghlUserId, m.teamMemberId);
          setEdits(seed);
        }
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Error inesperado"))
      .finally(() => setLoading(false));
  }, [open, projectId, launchId]);

  function handleSave() {
    if (!data) return;
    setSaveError(null);
    setSaveOk(false);
    // Mandamos TODOS los GHL users — el backend distingue upsert vs delete.
    const payload = data.ghlUsers.map((u) => ({
      ghlUserId: u.id,
      teamMemberId: edits.get(u.id) || null,
    }));
    startSaving(async () => {
      const result = await saveGhlUserMappings(projectId, launchId, payload);
      if (!result.ok) setSaveError(result.error ?? "Error guardando");
      else setSaveOk(true);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen(true)}
        className="!px-3 !py-1.5 !text-xs"
      >
        Mapear vendedores
      </Button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ghl-mapping-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-md border border-border bg-bg-elevated shadow-card">
            <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div>
                <h3
                  id="ghl-mapping-modal-title"
                  className="text-lg font-bold text-fg"
                >
                  Mapear vendedores GHL
                </h3>
                <p className="mt-1 text-xs text-fg-subtle">
                  Vinculá cada usuario de GHL con un miembro de tu equipo. Vale
                  para todos los lanzamientos del proyecto.
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

            <div className="flex-1 overflow-y-auto px-6 py-6">
              {loading && (
                <p className="text-sm text-fg-subtle">Cargando usuarios de GHL…</p>
              )}
              {loadError && (
                <div className="rounded-md border border-error/40 bg-error/10 p-3 text-sm text-error">
                  {loadError}
                </div>
              )}
              {!loading && !loadError && data && (
                <>
                  {data.ghlUsers.length === 0 ? (
                    <p className="text-sm text-fg-subtle">
                      GHL no devolvió users para este location.
                    </p>
                  ) : data.teamMembers.length === 0 ? (
                    <p className="text-sm text-fg-subtle">
                      No tenés team members activos en este proyecto. Creá al
                      menos uno desde la sección Equipo antes de mapear.
                    </p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs uppercase tracking-wide text-fg-subtle">
                        <tr>
                          <th scope="col" className="pb-2 font-medium">
                            GHL user
                          </th>
                          <th scope="col" className="pb-2 font-medium">
                            Team member
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.ghlUsers.map((u) => {
                          const value = edits.get(u.id) ?? "";
                          return (
                            <tr key={u.id} className="border-t border-border">
                              <td className="py-2 pr-2 text-fg">
                                {u.name}
                                <div className="text-[10px] text-fg-subtle">
                                  <code>{u.id}</code>
                                </div>
                              </td>
                              <td className="py-2">
                                <select
                                  value={value}
                                  onChange={(e) => {
                                    const next = new Map(edits);
                                    next.set(u.id, e.target.value);
                                    setEdits(next);
                                  }}
                                  className="w-full rounded-md border border-border bg-bg-elevated p-1.5 text-sm text-fg"
                                >
                                  <option value="">— Sin asignar —</option>
                                  {data.teamMembers.map((tm) => (
                                    <option key={tm.id} value={tm.id}>
                                      {tm.name}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>

            <footer className="flex items-center justify-end gap-3 border-t border-border px-6 py-3">
              {saveOk && (
                <span className="text-xs text-success">Mappings guardados</span>
              )}
              {saveError && <FieldError>{saveError}</FieldError>}
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOpen(false)}
                className="!px-3 !py-1.5"
              >
                Cerrar
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={saving || !data || data.ghlUsers.length === 0 || data.teamMembers.length === 0}
              >
                {saving ? "Guardando…" : "Guardar mappings"}
              </Button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
