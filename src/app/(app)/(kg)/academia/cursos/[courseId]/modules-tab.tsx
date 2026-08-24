"use client";

import { useState, useTransition } from "react";

import {
  createCourseModuleAction,
  deleteCourseModuleAction,
  reorderCourseModulesAction,
  runManualTagSyncAction,
  setModuleGhlTagAction,
  updateCourseModuleAction,
  type ManualSyncResult,
} from "./modules-actions";

// ═══════════════════════════════════════════════════════════════════════════
// Pestaña "Módulos" del detalle del curso (Fase C).
//
// Solo visible si `progress_source='ghl_tags'`. Alternativa mínima al
// drag&drop: botones "↑ / ↓" para reordenar (evita dependencia de librerías
// externas). Nombre + descripción editables inline. Input para asociar tag GHL
// y botón que dispara el sync manual del curso.
//
// Escritura: los actions ya gatean por rol; la UI muestra los controles
// desde el server ya con canEdit resuelto.
// ═══════════════════════════════════════════════════════════════════════════

export interface ModuleRowData {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly orderIndex: number;
  readonly ghlTag: string | null;
  readonly views: {
    readonly total: number;
    readonly completed: number;
    readonly rate: number;
  } | null;
}

export function ModulesTab({
  courseId,
  modules,
  canEdit,
  showTagCol,
}: {
  readonly courseId: string;
  readonly modules: readonly ModuleRowData[];
  /** true → admin/coordinador; false → solo lectura. */
  readonly canEdit: boolean;
  /** true → curso con progress_source='ghl_tags'. */
  readonly showTagCol: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const runSync = () => {
    setSyncMsg(null);
    startTransition(async () => {
      const result: ManualSyncResult = await runManualTagSyncAction(courseId);
      if ("error" in result) {
        setSyncMsg(`Error: ${result.error}`);
        return;
      }
      const s = result.summary;
      if (s.skippedReason) {
        setSyncMsg(`Salteado: ${s.skippedReason}`);
      } else {
        setSyncMsg(
          `Tags consultadas: ${s.tagsChecked} · Contactos match: ${s.contactsMatched} · Progresos upsert: ${s.progressUpserted}`,
        );
      }
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
          {modules.length} {modules.length === 1 ? "módulo" : "módulos"}
        </div>
        {canEdit && showTagCol && (
          <button
            type="button"
            onClick={runSync}
            disabled={isPending}
            className="kg-focus"
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              background: "var(--kg-accent-500)",
              border: "none",
              color: "#fff",
              fontSize: 11,
              fontWeight: 700,
              cursor: isPending ? "wait" : "pointer",
              opacity: isPending ? 0.6 : 1,
            }}
          >
            {isPending ? "Sincronizando…" : "Sincronizar ahora"}
          </button>
        )}
      </div>

      {syncMsg && (
        <div
          role="status"
          style={{
            padding: "8px 12px",
            borderRadius: "var(--kg-r-8)",
            background: syncMsg.startsWith("Error")
              ? "rgba(255,80,80,0.08)"
              : "rgba(0,180,120,0.08)",
            border: `1px solid ${syncMsg.startsWith("Error") ? "rgba(255,80,80,0.4)" : "rgba(0,180,120,0.4)"}`,
            color: "var(--kg-text-1)",
            fontSize: 12,
          }}
        >
          {syncMsg}
        </div>
      )}

      {modules.length === 0 && (
        <div
          className="kg-t7"
          style={{
            color: "var(--kg-text-3)",
            padding: 20,
            textAlign: "center",
            fontStyle: "italic",
          }}
        >
          Sin módulos cargados. Usá el formulario de abajo para agregar el
          primero.
        </div>
      )}

      {modules.map((m, idx) => (
        <ModuleRow
          key={m.id}
          module={m}
          courseId={courseId}
          canEdit={canEdit}
          showTagCol={showTagCol}
          canMoveUp={idx > 0}
          canMoveDown={idx < modules.length - 1}
          allModuleIds={modules.map((x) => x.id)}
          index={idx}
        />
      ))}

      {canEdit && (
        <CreateModuleForm courseId={courseId} nextIndex={modules.length} />
      )}
    </div>
  );
}

// ─── Row ────────────────────────────────────────────────────────────────────

function ModuleRow({
  module,
  courseId,
  canEdit,
  showTagCol,
  canMoveUp,
  canMoveDown,
  allModuleIds,
  index,
}: {
  readonly module: ModuleRowData;
  readonly courseId: string;
  readonly canEdit: boolean;
  readonly showTagCol: boolean;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly allModuleIds: readonly string[];
  readonly index: number;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(module.name);
  const [description, setDescription] = useState(module.description ?? "");
  const [tag, setTag] = useState(module.ghlTag ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const move = (delta: -1 | 1) => {
    const newIds = [...allModuleIds];
    const target = index + delta;
    if (target < 0 || target >= newIds.length) return;
    const [item] = newIds.splice(index, 1);
    newIds.splice(target, 0, item!);
    startTransition(async () => {
      const res = await reorderCourseModulesAction(courseId, newIds);
      if ("error" in res) setError(res.error);
    });
  };

  const save = () => {
    setError(null);
    const fd = new FormData();
    fd.set("name", name);
    fd.set("description", description);
    startTransition(async () => {
      const res = await updateCourseModuleAction(courseId, module.id, fd);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setEditing(false);
    });
  };

  const remove = () => {
    if (!confirm(`¿Eliminar módulo "${module.name}"?`)) return;
    startTransition(async () => {
      const res = await deleteCourseModuleAction(courseId, module.id);
      if ("error" in res) setError(res.error);
    });
  };

  const saveTag = () => {
    setError(null);
    const cleaned = tag.trim();
    startTransition(async () => {
      const res = await setModuleGhlTagAction(
        courseId,
        module.id,
        cleaned.length === 0 ? null : cleaned,
      );
      if ("error" in res) setError(res.error);
    });
  };

  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: "var(--kg-r-8)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            background: "var(--kg-surface-1-solid)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--kg-text-3)",
            fontWeight: 700,
            fontSize: 12,
            fontVariantNumeric: "tabular-nums",
            flexShrink: 0,
          }}
        >
          {index + 1}
        </div>

        <div style={{ flex: 1, minWidth: 200 }}>
          {editing ? (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="kg-focus"
              style={inputStyle}
              placeholder="Nombre del módulo"
              disabled={isPending}
            />
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  color: "var(--kg-text-1)",
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                {module.name}
              </div>
              {module.views != null && <ViewsBadge views={module.views} />}
            </div>
          )}
          {editing ? (
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="kg-focus"
              style={{ ...inputStyle, marginTop: 6, minHeight: 48 }}
              placeholder="Descripción (opcional)"
              disabled={isPending}
            />
          ) : module.description ? (
            <div
              className="kg-t7"
              style={{ color: "var(--kg-text-3)", marginTop: 4 }}
            >
              {module.description}
            </div>
          ) : null}
        </div>

        {canEdit && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => move(-1)}
              disabled={!canMoveUp || isPending}
              className="kg-focus"
              style={iconBtn}
              title="Mover arriba"
              aria-label="Mover arriba"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(1)}
              disabled={!canMoveDown || isPending}
              className="kg-focus"
              style={iconBtn}
              title="Mover abajo"
              aria-label="Mover abajo"
            >
              ↓
            </button>
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={save}
                  disabled={isPending}
                  className="kg-focus"
                  style={smallPrimaryBtn}
                >
                  Guardar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setName(module.name);
                    setDescription(module.description ?? "");
                    setError(null);
                  }}
                  disabled={isPending}
                  className="kg-focus"
                  style={smallBtn}
                >
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  disabled={isPending}
                  className="kg-focus"
                  style={smallBtn}
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={remove}
                  disabled={isPending}
                  className="kg-focus"
                  style={{ ...smallBtn, color: "var(--kg-negative-500)" }}
                >
                  Eliminar
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {showTagCol && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <label
            className="kg-t7"
            style={{
              color: "var(--kg-text-3)",
              fontWeight: 600,
              minWidth: 80,
            }}
          >
            Tag GHL
          </label>
          <input
            type="text"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="ej. mod-fundamentos-completo"
            className="kg-focus"
            style={{ ...inputStyle, flex: 1, minWidth: 200 }}
            disabled={!canEdit || isPending}
          />
          {canEdit && (
            <button
              type="button"
              onClick={saveTag}
              disabled={isPending || (tag.trim() === (module.ghlTag ?? ""))}
              className="kg-focus"
              style={smallBtn}
            >
              Guardar tag
            </button>
          )}
        </div>
      )}

      {error && (
        <div
          className="kg-t7"
          style={{ color: "var(--kg-negative-500)", marginTop: 2 }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

// ─── Create ─────────────────────────────────────────────────────────────────

function CreateModuleForm({
  courseId,
  nextIndex,
}: {
  readonly courseId: string;
  readonly nextIndex: number;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    const fd = new FormData();
    fd.set("name", name);
    fd.set("description", description);
    startTransition(async () => {
      const res = await createCourseModuleAction(courseId, fd);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setName("");
      setDescription("");
    });
  };

  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: "var(--kg-r-8)",
        background: "var(--kg-surface-1-solid)",
        border: "1px dashed var(--kg-border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        className="kg-t7"
        style={{ color: "var(--kg-text-3)", fontWeight: 600 }}
      >
        Nuevo módulo (posición {nextIndex + 1})
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nombre del módulo"
        className="kg-focus"
        style={inputStyle}
        disabled={isPending}
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Descripción (opcional)"
        className="kg-focus"
        style={{ ...inputStyle, minHeight: 48 }}
        disabled={isPending}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          onClick={submit}
          disabled={isPending || name.trim().length === 0}
          className="kg-focus"
          style={smallPrimaryBtn}
        >
          + Agregar módulo
        </button>
        {error && (
          <div
            className="kg-t7"
            style={{ color: "var(--kg-negative-500)" }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Views badge ────────────────────────────────────────────────────────────

function ViewsBadge({
  views,
}: {
  readonly views: {
    readonly total: number;
    readonly completed: number;
    readonly rate: number;
  };
}) {
  if (views.total === 0) {
    return (
      <span
        className="kg-t7"
        style={{
          padding: "2px 8px",
          borderRadius: 999,
          background: "var(--kg-surface-1-solid)",
          border: "1px solid var(--kg-border-subtle)",
          color: "var(--kg-text-3)",
          fontSize: 10,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
        }}
        title="Sin inscriptos activos en el curso"
      >
        sin inscriptos
      </span>
    );
  }
  const pct = formatPct(views.rate);
  return (
    <span
      className="kg-t7"
      style={{
        padding: "2px 8px",
        borderRadius: 999,
        background: "rgba(0,180,120,0.10)",
        border: "1px solid rgba(0,180,120,0.35)",
        color: "var(--kg-text-1)",
        fontSize: 10,
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
      }}
      title={`${views.completed} de ${views.total} inscriptos vieron este módulo`}
    >
      {views.completed}/{views.total} · {pct}
    </span>
  );
}

function formatPct(v: number): string {
  const rounded = Math.round(v * 10) / 10;
  if (Number.isInteger(rounded)) return `${rounded}%`;
  return `${rounded.toFixed(1)}%`;
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-1-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 12,
  outline: "none",
  width: "100%",
  fontFamily: "inherit",
};

const smallBtn: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
};

const smallPrimaryBtn: React.CSSProperties = {
  padding: "4px 12px",
  borderRadius: 999,
  background: "var(--kg-accent-500)",
  border: "none",
  color: "#fff",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};

const iconBtn: React.CSSProperties = {
  ...smallBtn,
  minWidth: 28,
  padding: "4px 8px",
  fontWeight: 700,
};
