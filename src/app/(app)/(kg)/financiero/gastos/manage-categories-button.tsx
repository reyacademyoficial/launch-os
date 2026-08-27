"use client";

import { useState } from "react";

import {
  ExpenseCategoriesDrawer,
  type ExpenseCategoryItem,
} from "./expense-categories-drawer";

/**
 * Botón "Gestionar categorías" del panel de Gastos. Abre el drawer de ABM
 * de `expense_categories` (0167). Vive suelto para poder ponerse junto a
 * los otros botones del header del Panel (Exportar / Importar / Nuevo).
 */
export function ManageCategoriesButton({
  categories,
}: {
  readonly categories: readonly ExpenseCategoryItem[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="kg-focus"
        style={{
          padding: "6px 14px",
          borderRadius: 999,
          background: "transparent",
          border: "1px solid var(--kg-border-subtle)",
          color: "var(--kg-text-2)",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
        }}
        title="Alta / baja / edición de categorías de gastos"
      >
        Categorías
      </button>
      <ExpenseCategoriesDrawer
        open={open}
        onClose={() => setOpen(false)}
        categories={categories}
      />
    </>
  );
}
