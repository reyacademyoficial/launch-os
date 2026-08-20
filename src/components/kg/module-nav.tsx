"use client";

import { useMemo } from "react";

import { useRegisterModuleTabs, type ModuleTabItem } from "./page-menu";
import type { TabItem } from "./tabs-bar";

/**
 * KG · Module nav. YA NO renderiza inline — registra las tabs en el context
 * de PageMenu y las tabs se pintan pegadas al Topbar. Esto libera 50-60px
 * verticales que antes ocupaba una franja separada, dejando más lugar para
 * la tabla de la página.
 *
 * El layout de cada módulo la sigue usando igual (no hay cambios para el
 * consumer). Los tabs aparecen ahora en el header.
 */
export function KgModuleNav({ items }: { readonly items: readonly TabItem[] }) {
  // Referencia estable para el effect — evita bucles al re-registrar en
  // cada render si el layout construye el array inline.
  const stable = useMemo<readonly ModuleTabItem[]>(
    () =>
      items.map((t) => ({ href: t.href, label: t.label })),
    [items],
  );
  useRegisterModuleTabs(stable);
  return null;
}
