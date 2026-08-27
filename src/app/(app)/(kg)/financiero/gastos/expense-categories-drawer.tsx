"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { Drawer } from "@/components/kg/drawer";
import type { ExpenseBucket } from "@/lib/finance/expense-categories";

import {
  createExpenseCategory,
  toggleExpenseCategoryActive,
  updateExpenseCategory,
  type CreateCategoryState,
  type UpdateCategoryState,
} from "./category-actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer ABM de categorías de gastos.
//
// Shape que le llega (serializable — la page fetchea con listExpenseCategories):
export interface ExpenseCategoryItem {
  readonly id: string;
  readonly slug: string;
  readonly label: string;
  readonly bucket: ExpenseBucket;
  readonly sortOrder: number;
  readonly isActive: boolean;
}

const BUCKET_LABEL: Record<ExpenseBucket, string> = {
  direct: "Directo",
  tax: "Impuesto",
  operating: "Operativo",
};

const BUCKET_HELP =
  'Directo = costos atribuibles a un lanzamiento (ej: publicidad). Impuesto = Ganancias, IIBB, débitos y créditos (NO el IVA). Operativo = el resto (alquiler, servicios, software, etc.).';

export function ExpenseCategoriesDrawer({
  open,
  onClose,
  categories,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly categories: readonly ExpenseCategoryItem[];
}) {
  if (!open) return null;
  return (
    <Drawer open={open} onClose={onClose} title="Gestionar categorías" width={560}>
      <CategoriesBody categories={categories} />
    </Drawer>
  );
}

function CategoriesBody({
  categories,
}: {
  readonly categories: readonly ExpenseCategoryItem[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const active = categories.filter((c) => c.isActive);
  const inactive = categories.filter((c) => !c.isActive);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CreateCategoryForm />

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <SectionTitle>Activas ({active.length})</SectionTitle>
        {active.length === 0 && (
          <EmptyHint text="No hay categorías activas. Creá una arriba." />
        )}
        {active.map((c) => (
          <CategoryRow
            key={c.id}
            category={c}
            isEditing={editingId === c.id}
            onEdit={() => setEditingId(c.id)}
            onCancelEdit={() => setEditingId(null)}
          />
        ))}
      </div>

      {inactive.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <SectionTitle>Inactivas ({inactive.length})</SectionTitle>
          <div className="kg-t7" style={{ color: "var(--kg-text-3)", fontSize: 11 }}>
            No aparecen al crear un gasto nuevo, pero los gastos históricos con
            este rubro siguen mostrando el nombre.
          </div>
          {inactive.map((c) => (
            <CategoryRow
              key={c.id}
              category={c}
              isEditing={editingId === c.id}
              onEdit={() => setEditingId(c.id)}
              onCancelEdit={() => setEditingId(null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Crear ───────────────────────────────────────────────────────────────

function CreateCategoryForm() {
  const [state, formAction, pending] = useActionState<
    CreateCategoryState,
    FormData
  >(createExpenseCategory, null);
  // Form uncontrolled: al éxito llamamos formRef.reset() en el effect. Evita
  // el "setState in effect" que react-hooks/strict castiga.
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state && "ok" in state && state.ok) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 14,
        borderRadius: "var(--kg-r-12)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
      }}
    >
      <SectionTitle>Añadir nueva</SectionTitle>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 140px",
          gap: 10,
        }}
      >
        <div>
          <Label htmlFor="new_category_label">Nombre</Label>
          <input
            id="new_category_label"
            name="label"
            type="text"
            required
            defaultValue=""
            placeholder="Ej. Capacitación"
            autoComplete="off"
            style={inputStyle}
          />
        </div>
        <div>
          <Label htmlFor="new_category_bucket" title={BUCKET_HELP}>
            Tipo P&amp;L
          </Label>
          <select
            id="new_category_bucket"
            name="bucket"
            defaultValue="operating"
            style={inputStyle}
          >
            <option value="operating">Operativo</option>
            <option value="direct">Directo</option>
            <option value="tax">Impuesto</option>
          </select>
        </div>
      </div>
      <input type="hidden" name="sort_order" value="100" />

      {state && "error" in state && <ErrorBox message={state.error} />}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="submit"
          disabled={pending}
          className="kg-focus"
          style={{ ...primaryBtn, opacity: pending ? 0.6 : 1 }}
        >
          {pending ? "Creando…" : "Añadir"}
        </button>
      </div>
    </form>
  );
}

// ─── Fila (view / edit) ──────────────────────────────────────────────────

function CategoryRow({
  category,
  isEditing,
  onEdit,
  onCancelEdit,
}: {
  readonly category: ExpenseCategoryItem;
  readonly isEditing: boolean;
  readonly onEdit: () => void;
  readonly onCancelEdit: () => void;
}) {
  if (isEditing) {
    return (
      <EditCategoryRow category={category} onDone={onCancelEdit} />
    );
  }
  return <ViewCategoryRow category={category} onEdit={onEdit} />;
}

function ViewCategoryRow({
  category,
  onEdit,
}: {
  readonly category: ExpenseCategoryItem;
  readonly onEdit: () => void;
}) {
  const [togglePending, startToggle] = useTransition();
  const [toggleError, setToggleError] = useState<string | null>(null);

  function handleToggle() {
    setToggleError(null);
    const msg = category.isActive
      ? `¿Dar de baja "${category.label}"? No va a aparecer al crear nuevos gastos. Los gastos históricos con esta categoría siguen intactos y podés reactivarla cuando quieras.`
      : `¿Reactivar "${category.label}"? Va a volver a aparecer al crear gastos.`;
    if (!confirm(msg)) return;
    startToggle(async () => {
      const r = await toggleExpenseCategoryActive(
        category.id,
        !category.isActive,
      );
      if ("error" in r) setToggleError(r.error);
    });
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 90px 160px",
        gap: 10,
        alignItems: "center",
        padding: "8px 12px",
        borderRadius: "var(--kg-r-8)",
        background: category.isActive
          ? "var(--kg-surface-2-solid)"
          : "transparent",
        border: "1px solid var(--kg-border-subtle)",
        opacity: category.isActive ? 1 : 0.6,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--kg-text-1)" }}>
          {category.label}
        </div>
        <div className="kg-t7" style={{ color: "var(--kg-text-3)", fontSize: 10 }}>
          slug: {category.slug}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--kg-text-2)" }}>
        {BUCKET_LABEL[category.bucket]}
      </div>
      <div
        style={{
          display: "inline-flex",
          gap: 6,
          justifyContent: "flex-end",
          alignItems: "center",
        }}
      >
        {toggleError && (
          <span
            style={{ color: "#EF4444", fontSize: 10 }}
            title={toggleError}
          >
            ⚠
          </span>
        )}
        <button
          type="button"
          onClick={onEdit}
          className="kg-focus"
          style={ghostBtn}
        >
          Editar
        </button>
        <button
          type="button"
          onClick={handleToggle}
          disabled={togglePending}
          className="kg-focus"
          style={{
            ...ghostBtn,
            color: category.isActive ? "#EF4444" : "var(--kg-accent-text)",
            cursor: togglePending ? "wait" : "pointer",
            opacity: togglePending ? 0.6 : 1,
          }}
          title={
            category.isActive
              ? "Dar de baja (soft-delete)"
              : "Reactivar"
          }
        >
          {togglePending
            ? "…"
            : category.isActive
              ? "Dar de baja"
              : "Reactivar"}
        </button>
      </div>
    </div>
  );
}

function EditCategoryRow({
  category,
  onDone,
}: {
  readonly category: ExpenseCategoryItem;
  readonly onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    UpdateCategoryState,
    FormData
  >(async (prev, fd) => updateExpenseCategory(category.id, prev, fd), null);

  useEffect(() => {
    if (state && "ok" in state && state.ok) onDone();
  }, [state, onDone]);

  return (
    <form
      action={formAction}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 130px 80px 160px",
        gap: 10,
        alignItems: "end",
        padding: "10px 12px",
        borderRadius: "var(--kg-r-8)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-accent-500)",
      }}
    >
      <div>
        <Label htmlFor={`edit_label_${category.id}`}>Nombre</Label>
        <input
          id={`edit_label_${category.id}`}
          name="label"
          type="text"
          required
          defaultValue={category.label}
          style={inputStyle}
        />
      </div>
      <div>
        <Label htmlFor={`edit_bucket_${category.id}`} title={BUCKET_HELP}>
          Tipo P&amp;L
        </Label>
        <select
          id={`edit_bucket_${category.id}`}
          name="bucket"
          defaultValue={category.bucket}
          style={inputStyle}
        >
          <option value="operating">Operativo</option>
          <option value="direct">Directo</option>
          <option value="tax">Impuesto</option>
        </select>
      </div>
      <div>
        <Label htmlFor={`edit_sort_${category.id}`}>Orden</Label>
        <input
          id={`edit_sort_${category.id}`}
          name="sort_order"
          type="number"
          min="0"
          max="9999"
          defaultValue={category.sortOrder}
          style={inputStyle}
        />
      </div>
      <div
        style={{
          display: "inline-flex",
          gap: 6,
          justifyContent: "flex-end",
          alignItems: "center",
          gridColumn: "1 / -1",
        }}
      >
        {state && "error" in state && (
          <span style={{ color: "#EF4444", fontSize: 11 }} title={state.error}>
            ⚠ {state.error}
          </span>
        )}
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          className="kg-focus"
          style={ghostBtn}
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={pending}
          className="kg-focus"
          style={{ ...primaryBtn, opacity: pending ? 0.6 : 1 }}
        >
          {pending ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </form>
  );
}

// ─── Bits ────────────────────────────────────────────────────────────────

function SectionTitle({ children }: { readonly children: React.ReactNode }) {
  return (
    <div
      className="kg-t7"
      style={{
        color: "var(--kg-text-3)",
        textTransform: "uppercase",
        letterSpacing: 0.6,
        fontSize: 10,
        fontWeight: 700,
      }}
    >
      {children}
    </div>
  );
}

function Label({
  htmlFor,
  title,
  children,
}: {
  readonly htmlFor: string;
  readonly title?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="kg-t7"
      title={title}
      style={{
        display: "block",
        color: "var(--kg-text-3)",
        marginBottom: 4,
        fontSize: 11,
      }}
    >
      {children}
    </label>
  );
}

function ErrorBox({ message }: { readonly message: string }) {
  return (
    <div
      style={{
        padding: "8px 12px",
        borderRadius: "var(--kg-r-8)",
        background: "rgba(239,68,68,0.10)",
        border: "1px solid #EF4444",
        color: "#EF4444",
        fontSize: 12,
      }}
    >
      {message}
    </div>
  );
}

function EmptyHint({ text }: { readonly text: string }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        color: "var(--kg-text-3)",
        fontSize: 12,
        fontStyle: "italic",
      }}
    >
      {text}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-1-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 12,
};

const primaryBtn: React.CSSProperties = {
  padding: "7px 14px",
  borderRadius: 999,
  background: "var(--kg-accent-500)",
  border: "none",
  color: "#fff",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};
