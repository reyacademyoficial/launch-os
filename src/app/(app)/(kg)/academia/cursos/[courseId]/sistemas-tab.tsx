"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StatusPill } from "@/components/kg/status-pill";

import {
  createSystemAction,
  deleteSystemAction,
  updateSystemAction,
  type UpsertSystemState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Sistemas del curso — CRUD inline. Visible solo si course.has_systems=true
// (el padre no renderiza esta pestaña si no lo está).
// ═══════════════════════════════════════════════════════════════════════════

export interface SystemRowData {
  readonly id: string;
  readonly name: string;
  readonly color: string | null;
  readonly expertTeamMemberId: string | null;
  readonly active: boolean;
}

export interface TeamMemberOption {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly active: boolean;
}

const DEFAULT_COLORS: readonly string[] = [
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
  "#14B8A6",
  "#F97316",
];

export function SistemasTab({
  courseId,
  rows,
  teamMembers,
}: {
  readonly courseId: string;
  readonly rows: readonly SystemRowData[];
  readonly teamMembers: readonly TeamMemberOption[];
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;

  const memberNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const tm of teamMembers) m.set(tm.id, tm.name);
    return m;
  }, [teamMembers]);

  const columns: Column<SystemRowData>[] = [
    {
      key: "name",
      label: "Sistema",
      render: (r) => (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 12,
              height: 12,
              borderRadius: 3,
              background: r.color ?? "var(--kg-neutral-500)",
              border: "1px solid var(--kg-border-subtle)",
            }}
          />
          <span
            style={{
              color: "var(--kg-text-1)",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {r.name}
          </span>
        </div>
      ),
    },
    {
      key: "expert",
      label: "Experto",
      render: (r) => (
        <span style={{ color: "var(--kg-text-2)", fontSize: 12 }}>
          {r.expertTeamMemberId
            ? memberNameById.get(r.expertTeamMemberId) ?? "—"
            : "—"}
        </span>
      ),
    },
    {
      key: "status",
      label: "Estado",
      render: (r) => (
        <StatusPill
          text={r.active ? "Activo" : "Archivado"}
          tone={
            r.active ? "var(--kg-positive-500)" : "var(--kg-neutral-500)"
          }
        />
      ),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (r) => (
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <Link
            href={`/academia/cursos/${courseId}/sistemas/${r.id}/reporte-mensual`}
            className="kg-focus"
            style={rowBtn}
          >
            Reporte
          </Link>
          <button
            type="button"
            onClick={() => setEditingId(r.id)}
            className="kg-focus"
            style={rowBtn}
          >
            Editar
          </button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", lineHeight: 1.55 }}
        >
          Un sistema es una sub-división del curso (ej: Nitro → Producto,
          Talento, Ventas, Admin&Finanzas). Cada cohorte puede asignarse a un
          sistema; los reportes mensuales agregan asistencia por sistema.
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="kg-focus"
          style={primaryBtn}
        >
          + Nuevo sistema
        </button>
      </div>

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={rows.length}
        emptyTitle="Sin sistemas cargados"
        emptyHint="Creá el primer sistema del curso. Nitro típicamente tiene 4: Producto, Talento, Ventas, Admin&Finanzas."
      />

      {creating && (
        <SystemFormOverlay
          courseId={courseId}
          mode="create"
          teamMembers={teamMembers}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && (
        <SystemFormOverlay
          courseId={courseId}
          mode="edit"
          initial={editing}
          teamMembers={teamMembers}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}

function SystemFormOverlay({
  courseId,
  mode,
  initial,
  teamMembers,
  onClose,
}: {
  readonly courseId: string;
  readonly mode: "create" | "edit";
  readonly initial?: SystemRowData;
  readonly teamMembers: readonly TeamMemberOption[];
  readonly onClose: () => void;
}) {
  const isEdit = mode === "edit" && initial != null;

  const boundCreate = useMemo(
    () => async (prev: UpsertSystemState, fd: FormData) =>
      createSystemAction(courseId, prev, fd),
    [courseId],
  );
  const boundUpdate = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpsertSystemState, fd: FormData) =>
      updateSystemAction(courseId, id, prev, fd);
  }, [courseId, isEdit, initial]);

  const [createState, createAction, createPending] = useActionState<
    UpsertSystemState,
    FormData
  >(boundCreate, null);
  const [updateState, updateAction, updatePending] = useActionState<
    UpsertSystemState,
    FormData
  >(
    boundUpdate ??
      (async () => ({ error: "Modo edit sin id" as string }) as never),
    null,
  );

  const state = isEdit ? updateState : createState;
  const formAction = isEdit ? updateAction : createAction;
  const pending = isEdit ? updatePending : createPending;

  const [color, setColor] = useState<string>(
    initial?.color ?? DEFAULT_COLORS[0]!,
  );
  const [deletePending, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (state && "ok" in state && state.ok) onClose();
  }, [state, onClose]);

  function handleDelete() {
    if (!isEdit || !initial) return;
    const ok = window.confirm(
      `¿Eliminar el sistema "${initial.name}"? Las cohortes asignadas quedarán sin sistema.`,
    );
    if (!ok) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteSystemAction(courseId, initial.id);
      if ("error" in result) {
        setDeleteError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          background: "var(--kg-surface-1-solid)",
          border: "1px solid var(--kg-border-subtle)",
          borderRadius: "var(--kg-r-12)",
          padding: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <div
            style={{
              color: "var(--kg-text-1)",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {isEdit ? "Editar sistema" : "Nuevo sistema"}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="kg-focus"
            aria-label="Cerrar"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--kg-text-3)",
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <form
          action={formAction}
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          <Field label="Nombre" htmlFor="name" required>
            <input
              id="name"
              name="name"
              type="text"
              required
              maxLength={120}
              defaultValue={initial?.name ?? ""}
              placeholder="Ej. Producto"
              style={inputStyle}
            />
          </Field>

          <Field label="Color" htmlFor="color">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                id="color"
                name="color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                style={{
                  width: 42,
                  height: 30,
                  padding: 2,
                  borderRadius: "var(--kg-r-8)",
                  background: "transparent",
                  border: "1px solid var(--kg-border-subtle)",
                  cursor: "pointer",
                }}
              />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {DEFAULT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`Color ${c}`}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 4,
                      background: c,
                      border:
                        color.toLowerCase() === c.toLowerCase()
                          ? "2px solid var(--kg-text-1)"
                          : "1px solid var(--kg-border-subtle)",
                      cursor: "pointer",
                    }}
                  />
                ))}
              </div>
            </div>
          </Field>

          <Field label="Experto asignado" htmlFor="expert_team_member_id">
            <select
              id="expert_team_member_id"
              name="expert_team_member_id"
              defaultValue={initial?.expertTeamMemberId ?? ""}
              style={inputStyle}
            >
              <option value="">— Sin asignar —</option>
              {teamMembers.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name}
                  {tm.role ? ` · ${tm.role}` : ""}
                  {tm.active ? "" : " (inactivo)"}
                </option>
              ))}
            </select>
          </Field>

          {isEdit && (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "var(--kg-text-2)",
                fontSize: 12,
              }}
            >
              <input
                type="checkbox"
                name="active"
                defaultChecked={initial?.active ?? true}
              />
              Activo
            </label>
          )}

          {state && "error" in state && <ErrorBanner text={state.error} />}
          {deleteError && <ErrorBanner text={deleteError} />}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 4,
            }}
          >
            {isEdit ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={pending || deletePending}
                className="kg-focus"
                style={{ ...dangerBtn, opacity: deletePending ? 0.7 : 1 }}
              >
                {deletePending ? "Eliminando…" : "Eliminar"}
              </button>
            ) : (
              <div />
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={onClose}
                disabled={pending || deletePending}
                className="kg-focus"
                style={secondaryBtn}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={pending || deletePending}
                className="kg-focus"
                style={{ ...primaryBtn, opacity: pending ? 0.7 : 1 }}
              >
                {pending
                  ? isEdit
                    ? "Guardando…"
                    : "Creando…"
                  : isEdit
                    ? "Guardar"
                    : "Crear"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  readonly label: string;
  readonly htmlFor: string;
  readonly required?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="kg-t7"
        style={{ display: "block", color: "var(--kg-text-3)", marginBottom: 6 }}
      >
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: "#EF4444", marginLeft: 4 }}>
            *
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

function ErrorBanner({ text }: { readonly text: string }) {
  return (
    <div
      style={{
        padding: "10px 14px",
        borderRadius: "var(--kg-r-8)",
        background: "rgba(239,68,68,0.10)",
        border: "1px solid #EF4444",
        color: "#EF4444",
        fontSize: 12,
      }}
    >
      {text}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 13,
  colorScheme: "dark",
};

const primaryBtn: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 999,
  background: "var(--kg-accent-500)",
  border: "none",
  color: "#fff",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

const dangerBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid #EF4444",
  color: "#EF4444",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};

const rowBtn: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-block",
};
