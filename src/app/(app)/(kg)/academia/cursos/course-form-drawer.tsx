"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";

import {
  createCourse,
  deleteCourse,
  updateCourse,
  type CreateCourseState,
  type UpdateCourseState,
} from "./actions";
import { ParametersEditor, type ParameterRowData } from "./parameters-editor";

/**
 * Drawer para crear o editar un curso.
 *
 * En create: solo se listan products propios que TODAVÍA no son courses.
 * En edit: se lista el product actual + los disponibles (permite
 * remapear el curso a otro product si aplica).
 */

export interface ProductOptionForCourse {
  readonly id: string;
  readonly name: string;
  readonly projectName: string | null;
  readonly projectId: string;
  /** True si ya está asignado a otro curso — se muestra deshabilitado. */
  readonly alreadyCourse: boolean;
}

export interface ExternalAppOptionForCourse {
  readonly id: string;
  readonly name: string;
  readonly projectId: string;
  readonly active: boolean;
}

export interface CourseInitial {
  readonly id: string;
  readonly productId: string;
  readonly durationHours: number | null;
  readonly modulesCount: number | null;
  readonly active: boolean;
  readonly defaultAccessDays: number | null;
  readonly ghlExpirationWebhookUrl: string | null;
  readonly externalAppId: string | null;
}

export function CourseFormDrawer({
  mode,
  open,
  onClose,
  products,
  externalApps,
  initial,
  parameters,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly products: readonly ProductOptionForCourse[];
  readonly externalApps?: readonly ExternalAppOptionForCourse[];
  readonly initial?: CourseInitial;
  /** Solo aplica en mode='edit'. Se carga en el server para el course actual. */
  readonly parameters?: readonly ParameterRowData[];
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nuevo curso" : "Editar curso";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={560}>
      <CourseFormBody
        mode={mode}
        products={products}
        externalApps={externalApps ?? []}
        initial={initial}
        parameters={parameters}
        onClose={onClose}
      />
    </Drawer>
  );
}

function CourseFormBody({
  mode,
  products,
  externalApps,
  initial,
  parameters,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly products: readonly ProductOptionForCourse[];
  readonly externalApps: readonly ExternalAppOptionForCourse[];
  readonly initial?: CourseInitial;
  readonly parameters?: readonly ParameterRowData[];
  readonly onClose: () => void;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdateCourseState, fd: FormData) =>
      updateCourse(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateCourseState,
    FormData
  >(createCourse, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateCourseState,
    FormData
  >(
    updateBound ??
      (async () => ({ error: "Modo edit sin id" as string }) as never),
    null,
  );

  const state = isEdit ? updateState : createState;
  const formAction = isEdit ? updateFormAction : createFormAction;
  const pending = isEdit ? updatePending : createPending;

  useEffect(() => {
    if (state && "ok" in state && state.ok) onClose();
  }, [state, onClose]);

  const [active, setActive] = useState(initial?.active ?? true);
  const [selectedProductId, setSelectedProductId] = useState<string>(
    initial?.productId ?? "",
  );
  const [externalAppId, setExternalAppId] = useState<string>(
    initial?.externalAppId ?? "",
  );
  const [deletePending, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleDelete() {
    if (!isEdit || !initial) return;
    const productName =
      products.find((p) => p.id === initial.productId)?.name ?? "";
    const ok = window.confirm(
      `¿Eliminar el curso ${productName ? `"${productName}"` : ""}? Si tiene cohortes asociadas va a rebotar — archivalo destildando "Activo" en su lugar.`,
    );
    if (!ok) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteCourse(initial.id);
      if ("error" in result) {
        setDeleteError(result.error);
        return;
      }
      onClose();
    });
  }

  // En create: mostrar solo products no-course. En edit: mostrar el
  // product actual + no-course. Filtramos aunque el schema y el server
  // ya validan (defensa).
  const productOptions = products.filter((p) => {
    if (!isEdit) return !p.alreadyCourse;
    return !p.alreadyCourse || p.id === initial?.productId;
  });

  const effectiveProductId =
    selectedProductId || initial?.productId || productOptions[0]?.id || "";
  const effectiveProjectId =
    products.find((p) => p.id === effectiveProductId)?.projectId ?? null;
  const filteredExternalApps = effectiveProjectId
    ? externalApps.filter(
        (a) => a.projectId === effectiveProjectId && (a.active || a.id === externalAppId),
      )
    : [];

  if (productOptions.length === 0) {
    return (
      <div style={{ padding: 12 }}>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", lineHeight: 1.55 }}
        >
          No hay productos disponibles para convertir en curso. Todos los
          productos de proyectos propios ya están registrados como cursos.
          Andá a{" "}
          <a
            href="/comercial/productos"
            style={{ color: "var(--kg-accent-500)" }}
          >
            Comercial → Productos
          </a>{" "}
          para dar de alta uno nuevo.
        </div>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <Field label="Producto" htmlFor="product_id" required>
        <select
          id="product_id"
          name="product_id"
          value={effectiveProductId}
          onChange={(e) => {
            setSelectedProductId(e.target.value);
            // Al cambiar el product cambia el project. Reseteamos el
            // external_app_id para no quedar apuntando a una app de otro
            // proyecto.
            setExternalAppId("");
          }}
          required
          style={inputStyle}
        >
          {productOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.projectName ? ` · ${p.projectName}` : ""}
            </option>
          ))}
        </select>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          Solo se listan productos de proyectos con ownership='propia'. Un
          producto es a lo sumo 1 curso.
        </div>
      </Field>

      <Field label="App externa asociada" htmlFor="external_app_id">
        <select
          id="external_app_id"
          name="external_app_id"
          value={externalAppId}
          onChange={(e) => setExternalAppId(e.target.value)}
          disabled={filteredExternalApps.length === 0}
          style={inputStyle}
        >
          <option value="">— Sin app externa —</option>
          {filteredExternalApps.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.active ? "" : " · archivada"}
            </option>
          ))}
        </select>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          {filteredExternalApps.length === 0
            ? "No hay apps externas cargadas en el proyecto del producto elegido. Gestionalas desde Academia → Apps externas."
            : "El curso mostrará un botón 'Abrir app' con SSO si se elige una app activa."}
        </div>
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Duración (horas)" htmlFor="duration_hours">
          <input
            id="duration_hours"
            name="duration_hours"
            type="number"
            min={1}
            step={1}
            defaultValue={initial?.durationHours ?? ""}
            placeholder="Opcional"
            style={inputStyle}
          />
        </Field>
        <Field label="Módulos" htmlFor="modules_count">
          <input
            id="modules_count"
            name="modules_count"
            type="number"
            min={1}
            step={1}
            defaultValue={initial?.modulesCount ?? ""}
            placeholder="Opcional"
            style={inputStyle}
          />
        </Field>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: "12px 14px",
          borderRadius: "var(--kg-r-8)",
          background: "var(--kg-surface-1-solid)",
          border: "1px solid var(--kg-border-subtle)",
        }}
      >
        <div
          className="kg-t7"
          style={{
            color: "var(--kg-text-1)",
            fontWeight: 700,
            fontSize: 12,
          }}
        >
          Vigencia y baja automática
        </div>
        <Field label="Vigencia fija (opcional, en días)" htmlFor="default_access_days">
          <input
            id="default_access_days"
            name="default_access_days"
            type="number"
            min={1}
            step={1}
            defaultValue={initial?.defaultAccessDays ?? ""}
            placeholder="Ej: 365"
            style={inputStyle}
          />
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginTop: 6, lineHeight: 1.5 }}
          >
            Si lo dejás vacío, la vigencia se calcula automáticamente por el
            método de pago de la venta:
            <br />
            <strong>· Pago único</strong> → sin vencimiento
            <br />
            <strong>· En cuotas</strong> → 1 año desde la fecha de compra
            <br />
            Si ponés un número acá, ese valor gana siempre (para cursos como
            Nitro que duran un plazo fijo sin importar cómo se pagaron).
          </div>
        </Field>
        <Field
          label="URL webhook GHL (baja por vencimiento)"
          htmlFor="ghl_expiration_webhook_url"
        >
          <input
            id="ghl_expiration_webhook_url"
            name="ghl_expiration_webhook_url"
            type="url"
            defaultValue={initial?.ghlExpirationWebhookUrl ?? ""}
            placeholder="https://services.leadconnectorhq.com/hooks/…"
            style={inputStyle}
          />
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginTop: 6 }}
          >
            El cron diario llama a esta URL cuando vence una inscripción de
            este curso. Si queda vacío, el enrollment se marca
            {" "}
            <code style={codeStyle}>expired</code> sin disparar webhook.
          </div>
        </Field>
      </div>

      {isEdit && (
        <>
          <label
            htmlFor="__active_toggle"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderRadius: "var(--kg-r-8)",
              background: "var(--kg-surface-2-solid)",
              border: "1px solid var(--kg-border-subtle)",
              cursor: "pointer",
            }}
          >
            <input
              id="__active_toggle"
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            <div style={{ flex: 1 }}>
              <div
                className="kg-t7"
                style={{ color: "var(--kg-text-1)", fontWeight: 600 }}
              >
                Curso activo
              </div>
              <div
                className="kg-t7"
                style={{ color: "var(--kg-text-3)", marginTop: 2 }}
              >
                Los cursos archivados no aparecen por defecto en el
                listado y no se pueden asignar a nuevas cohortes.
              </div>
            </div>
          </label>
          <input type="hidden" name="active" value={active ? "on" : "off"} />
        </>
      )}

      {isEdit && initial && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "12px 14px",
            borderRadius: "var(--kg-r-8)",
            background: "var(--kg-surface-1-solid)",
            border: "1px solid var(--kg-border-subtle)",
          }}
        >
          <div
            className="kg-t7"
            style={{
              color: "var(--kg-text-1)",
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            Parámetros del curso
          </div>
          <ParametersEditor
            courseId={initial.id}
            parameters={parameters ?? []}
          />
        </div>
      )}

      {!isEdit && (
        <div
          className="kg-t7"
          style={{
            padding: "10px 14px",
            borderRadius: "var(--kg-r-8)",
            background: "var(--kg-surface-1-solid)",
            border: "1px dashed var(--kg-border-subtle)",
            color: "var(--kg-text-3)",
          }}
        >
          Podés configurar los parámetros del curso (diagnóstico, sesiones,
          etc.) una vez creado.
        </div>
      )}

      {state && "error" in state && <ErrorBanner text={state.error} />}
      {deleteError && <ErrorBanner text={deleteError} />}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
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
            {deletePending ? "Eliminando…" : "Eliminar curso"}
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
                ? "Guardar cambios"
                : "Crear curso"}
          </button>
        </div>
      </div>
    </form>
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

const codeStyle: React.CSSProperties = {
  padding: "1px 5px",
  borderRadius: 4,
  background: "var(--kg-surface-2-solid)",
  fontFamily: "ui-monospace, monospace",
  fontSize: 11,
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
