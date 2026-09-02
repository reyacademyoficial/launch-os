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
import { KgDataTable, type Column } from "@/components/kg/data-table";
import { Drawer } from "@/components/kg/drawer";
import { EmptyState } from "@/components/kg/empty-state";
import {
  ErrorBanner,
  inputStyle,
  primaryBtn,
  secondaryBtn,
} from "@/components/kg/form-primitives";
import { StateDot } from "@/components/kg/state-dot";
import { StatusPill } from "@/components/kg/status-pill";
import { TONE_VAR } from "@/components/kg/tone";

/**
 * Fila de la tabla de mapeo: un user de GHL. Se declara acá (en vez de
 * derivarla con `GhlUserMappingsData["ghlUsers"][number]`) porque con
 * `noUncheckedIndexedAccess` el indexed access mete `| undefined` en el tipo
 * de la fila y ensucia todos los `render`.
 */
interface GhlUserRow {
  readonly id: string;
  readonly name: string;
}

/**
 * Modal "Mapear vendedores GHL". Carga lazy on-open (fetch a GHL es lento).
 * Por cada GHL user del location del launch, dropdown para asignar un team_member
 * del proyecto. "—" deja el mapping vacío (lead que venga con ese assignedTo
 * no se asignará a nadie).
 *
 * El mapping vive a nivel proyecto (no launch): los GHL users son los mismos
 * entre launches del cliente, no tiene sentido repetir el laburo.
 *
 * MIGRACIÓN KG
 * El overlay `fixed inset-0` propio pasó a `Drawer` (Esc + click-outside ya
 * vienen adentro) y la `<table>` a mano a `KgDataTable`. Los botones de guardar
 * y cerrar bajaron al `footer` del Drawer, que es el slot pensado para eso:
 * quedan pegados al fondo y no se pierden cuando la lista de vendedores es
 * larga y el body scrollea.
 *
 * La máquina de estados (loading / loadError / edits / saving / saveOk) NO se
 * tocó: mismos setters, mismo effect, mismo payload al server action.
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

  const columns: ReadonlyArray<Column<GhlUserRow>> = [
    {
      key: "ghlUser",
      label: "GHL user",
      render: (u) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--kg-text-1)", fontWeight: 600 }}>
            {u.name}
          </div>
          <code
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", wordBreak: "break-all" }}
          >
            {u.id}
          </code>
        </div>
      ),
    },
    {
      key: "teamMember",
      label: "Team member",
      width: "45%",
      render: (u) => (
        <select
          value={edits.get(u.id) ?? ""}
          onChange={(e) => {
            const next = new Map(edits);
            next.set(u.id, e.target.value);
            setEdits(next);
          }}
          aria-label={`Team member para ${u.name}`}
          style={inputStyle}
        >
          <option value="">— Sin asignar —</option>
          {(data?.teamMembers ?? []).map((tm) => (
            <option key={tm.id} value={tm.id}>
              {tm.name}
            </option>
          ))}
        </select>
      ),
    },
  ];

  const canSave =
    !saving &&
    data !== null &&
    data.ghlUsers.length > 0 &&
    data.teamMembers.length > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="kg-focus"
        style={secondaryBtn}
      >
        Mapear vendedores
      </button>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Mapear vendedores GHL"
        subtitle="Vinculá cada usuario de GHL con un miembro de tu equipo. Vale para todos los lanzamientos del proyecto."
        width={640}
        footer={
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            {saveOk && (
              <StatusPill text="Mappings guardados" tone={TONE_VAR.positive} />
            )}
            {saveError && (
              // Techo de ancho: el error del server puede ser largo y no
              // debería empujar los botones fuera del footer.
              <div style={{ maxWidth: 300 }}>
                <ErrorBanner message={saveError} />
              </div>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="kg-focus"
              style={secondaryBtn}
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="kg-focus"
              style={{
                ...primaryBtn,
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                opacity: canSave ? 1 : 0.5,
                cursor: canSave ? "pointer" : "not-allowed",
              }}
            >
              {saving && <StateDot tone="accent" />}
              {saving ? "Guardando…" : "Guardar mappings"}
            </button>
          </div>
        }
      >
        {loading && (
          <div
            className="kg-t6"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "var(--kg-text-3)",
            }}
          >
            <StateDot tone="accent" />
            Cargando usuarios de GHL…
          </div>
        )}

        {loadError && <ErrorBanner message={loadError} />}

        {!loading && !loadError && data && (
          <>
            {data.ghlUsers.length === 0 ? (
              <EmptyState
                title="Sin usuarios en GHL"
                hint="GHL no devolvió users para este location. Revisá el Location ID en la configuración del provider."
              />
            ) : data.teamMembers.length === 0 ? (
              <EmptyState
                title="Sin team members"
                hint="No tenés team members activos en este proyecto. Creá al menos uno desde la sección Equipo antes de mapear."
              />
            ) : (
              <KgDataTable
                columns={columns}
                rows={data.ghlUsers}
                rowKey={(u) => u.id}
                emptyTitle="Sin usuarios en GHL"
              />
            )}
          </>
        )}
      </Drawer>
    </>
  );
}
