"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StatusPill } from "@/components/kg/status-pill";
import type {
  ExternalAppAuthStrategy,
  ExternalAppConfig,
} from "@/lib/academia/external-apps";

import {
  createExternalAppAction,
  deleteExternalAppAction,
  updateExternalAppAction,
  type UpsertExternalAppState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de external_apps (Fase G · 0153).
//
// El row muestra name / proyecto / strategy / active. El overlay permite
// editar/crear con todos los campos de config. secret se muestra oculto
// tras un toggle "mostrar" para evitar exposición accidental.
// ═══════════════════════════════════════════════════════════════════════════

export interface ProjectOption {
  readonly id: string;
  readonly name: string;
}

export interface AppRow {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly authStrategy: ExternalAppAuthStrategy;
  readonly active: boolean;
  readonly config: ExternalAppConfig;
}

const STRATEGY_LABEL: Record<ExternalAppAuthStrategy, string> = {
  jwt: "JWT (HS256)",
  shared_secret: "Shared secret (HMAC)",
  magic_link: "Magic link (backend)",
  oauth2: "OAuth2 (TODO)",
};

export function AppsExternasView({
  rows,
  projectOptions,
}: {
  readonly rows: readonly AppRow[];
  readonly projectOptions: readonly ProjectOption[];
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;

  const columns: Column<AppRow>[] = [
    {
      key: "name",
      label: "App",
      render: (r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span
            style={{
              color: "var(--kg-text-1)",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {r.name}
          </span>
          <span
            className="kg-t7"
            style={{ color: "var(--kg-text-3)" }}
          >
            {r.baseUrl}
          </span>
        </div>
      ),
    },
    {
      key: "project",
      label: "Proyecto",
      render: (r) => (
        <span style={{ color: "var(--kg-text-2)", fontSize: 12 }}>
          {r.projectName}
        </span>
      ),
    },
    {
      key: "strategy",
      label: "Auth",
      render: (r) => (
        <span style={{ color: "var(--kg-text-2)", fontSize: 12 }}>
          {STRATEGY_LABEL[r.authStrategy]}
        </span>
      ),
    },
    {
      key: "status",
      label: "Estado",
      render: (r) => (
        <StatusPill
          text={r.active ? "Activa" : "Inactiva"}
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
        <button
          type="button"
          onClick={() => setEditingId(r.id)}
          className="kg-focus"
          style={rowBtn}
        >
          Editar
        </button>
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
          Apps externas conectadas al ecosistema (ej: Nitro tiene una app de
          agenda de turnos con expertos). El link app↔curso se hace desde el
          formulario del curso (campo &ldquo;App externa&rdquo;).
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          disabled={projectOptions.length === 0}
          className="kg-focus"
          style={{ ...primaryBtn, opacity: projectOptions.length === 0 ? 0.5 : 1 }}
        >
          + Nueva app
        </button>
      </div>

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={rows.length}
        emptyTitle="Sin apps externas"
        emptyHint="No hay apps externas registradas. Creá la primera para vincular un curso con una plataforma externa."
      />

      {creating && (
        <AppFormOverlay
          mode="create"
          projectOptions={projectOptions}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && (
        <AppFormOverlay
          mode="edit"
          projectOptions={projectOptions}
          initial={editing}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}

function AppFormOverlay({
  mode,
  initial,
  projectOptions,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly initial?: AppRow;
  readonly projectOptions: readonly ProjectOption[];
  readonly onClose: () => void;
}) {
  const isEdit = mode === "edit" && initial != null;

  const boundCreate = useMemo(
    () => async (prev: UpsertExternalAppState, fd: FormData) =>
      createExternalAppAction(prev, fd),
    [],
  );
  const boundUpdate = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpsertExternalAppState, fd: FormData) =>
      updateExternalAppAction(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createAction, createPending] = useActionState<
    UpsertExternalAppState,
    FormData
  >(boundCreate, null);
  const [updateState, updateAction, updatePending] = useActionState<
    UpsertExternalAppState,
    FormData
  >(
    boundUpdate ??
      (async () => ({ error: "Modo edit sin id" as string }) as never),
    null,
  );

  const state = isEdit ? updateState : createState;
  const formAction = isEdit ? updateAction : createAction;
  const pending = isEdit ? updatePending : createPending;

  const [strategy, setStrategy] = useState<ExternalAppAuthStrategy>(
    initial?.authStrategy ?? "jwt",
  );
  const [showSecret, setShowSecret] = useState(false);
  const [deletePending, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (state && "ok" in state && state.ok) onClose();
  }, [state, onClose]);

  function handleDelete() {
    if (!isEdit || !initial) return;
    const ok = window.confirm(
      `¿Eliminar la app "${initial.name}"? Los cursos que la usaban quedarán sin app asociada.`,
    );
    if (!ok) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteExternalAppAction(initial.id);
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
        overflowY: "auto",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 620,
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
            {isEdit ? "Editar app externa" : "Nueva app externa"}
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
          {!isEdit && (
            <Field label="Proyecto" htmlFor="project_id" required>
              <select
                id="project_id"
                name="project_id"
                required
                defaultValue=""
                style={inputStyle}
              >
                <option value="" disabled>
                  — Elegí un proyecto —
                </option>
                {projectOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Nombre" htmlFor="name" required>
            <input
              id="name"
              name="name"
              type="text"
              required
              maxLength={120}
              defaultValue={initial?.name ?? ""}
              placeholder="Ej. Nitro Agenda"
              style={inputStyle}
            />
          </Field>

          <Field label="URL base" htmlFor="base_url" required>
            <input
              id="base_url"
              name="base_url"
              type="url"
              required
              defaultValue={initial?.baseUrl ?? ""}
              placeholder="https://agenda.nitro.reyacademy.com"
              style={inputStyle}
            />
          </Field>

          <Field label="Estrategia de auth" htmlFor="auth_strategy" required>
            <select
              id="auth_strategy"
              name="auth_strategy"
              value={strategy}
              onChange={(e) =>
                setStrategy(e.target.value as ExternalAppAuthStrategy)
              }
              style={inputStyle}
            >
              {(Object.keys(STRATEGY_LABEL) as ExternalAppAuthStrategy[]).map(
                (s) => (
                  <option key={s} value={s}>
                    {STRATEGY_LABEL[s]}
                  </option>
                ),
              )}
            </select>
          </Field>

          <div
            style={{
              padding: 12,
              borderRadius: "var(--kg-r-8)",
              background: "var(--kg-surface-2-solid)",
              border: "1px solid var(--kg-border-subtle)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              className="kg-t7"
              style={{ color: "var(--kg-text-3)", fontWeight: 700 }}
            >
              Config ({strategy})
            </div>

            {(strategy === "jwt" ||
              strategy === "shared_secret" ||
              strategy === "magic_link") && (
              <Field label="Secret" htmlFor="config_secret" required>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    id="config_secret"
                    name="config_secret"
                    type={showSecret ? "text" : "password"}
                    defaultValue={initial?.config?.secret ?? ""}
                    placeholder="Shared secret (mín. 32 chars recomendado)"
                    style={{ ...inputStyle, flex: 1 }}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((s) => !s)}
                    className="kg-focus"
                    style={secondaryBtn}
                  >
                    {showSecret ? "Ocultar" : "Mostrar"}
                  </button>
                </div>
              </Field>
            )}

            {strategy === "magic_link" && (
              <Field
                label="Magic link endpoint"
                htmlFor="config_magic_link_endpoint"
                required
              >
                <input
                  id="config_magic_link_endpoint"
                  name="config_magic_link_endpoint"
                  type="url"
                  defaultValue={initial?.config?.magic_link_endpoint ?? ""}
                  placeholder="https://backend.nitro.reyacademy.com/api/sso/magic-link"
                  style={inputStyle}
                />
              </Field>
            )}

            {strategy === "jwt" && (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                  }}
                >
                  <Field label="Issuer (iss)" htmlFor="config_issuer">
                    <input
                      id="config_issuer"
                      name="config_issuer"
                      type="text"
                      defaultValue={initial?.config?.issuer ?? ""}
                      placeholder="kingrow"
                      style={inputStyle}
                    />
                  </Field>
                  <Field label="Audience (aud)" htmlFor="config_audience">
                    <input
                      id="config_audience"
                      name="config_audience"
                      type="text"
                      defaultValue={initial?.config?.audience ?? ""}
                      placeholder="nitro"
                      style={inputStyle}
                    />
                  </Field>
                </div>
              </>
            )}

            {(strategy === "jwt" || strategy === "shared_secret") && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 10,
                }}
              >
                <Field label="Token param" htmlFor="config_token_param">
                  <input
                    id="config_token_param"
                    name="config_token_param"
                    type="text"
                    defaultValue={initial?.config?.token_param ?? ""}
                    placeholder="token"
                    style={inputStyle}
                  />
                </Field>
                <Field
                  label="Placement"
                  htmlFor="config_token_placement"
                >
                  <select
                    id="config_token_placement"
                    name="config_token_placement"
                    defaultValue={
                      initial?.config?.token_placement ?? "query"
                    }
                    style={inputStyle}
                  >
                    <option value="query">query (?token=)</option>
                    <option value="hash">hash (#token=)</option>
                  </select>
                </Field>
                <Field
                  label="Validez (s)"
                  htmlFor="config_expires_in_seconds"
                >
                  <input
                    id="config_expires_in_seconds"
                    name="config_expires_in_seconds"
                    type="number"
                    min={30}
                    max={3600}
                    defaultValue={
                      initial?.config?.expires_in_seconds ?? 300
                    }
                    style={inputStyle}
                  />
                </Field>
              </div>
            )}

            {strategy === "oauth2" && (
              <div
                className="kg-t7"
                style={{
                  color: "#F59E0B",
                  padding: 8,
                  border: "1px solid rgba(245,158,11,0.4)",
                  borderRadius: "var(--kg-r-8)",
                  background: "rgba(245,158,11,0.08)",
                }}
              >
                OAuth2 aún no está implementado. Elegí otra estrategia por
                ahora.
              </div>
            )}
          </div>

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
              Activa
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
};
