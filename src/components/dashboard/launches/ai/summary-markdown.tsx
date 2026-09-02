"use client";

import { KgMarkdown } from "@/components/kg/markdown";

/**
 * Render del markdown de las corridas de IA.
 *
 * POR QUÉ AHORA ES UN WRAPPER
 * Este archivo tenía su propio mapeo nodo-por-nodo contra los tokens VIEJOS
 * (`text-fg`, `text-fg-muted`, `border-border`, `bg-bg-elevated`,
 * `text-accent`). `KgMarkdown` es exactamente ese mapeo pero contra la escala
 * `kg-t*` y las CSS vars `--kg-*` — de hecho su API se derivó de este archivo.
 * Duplicarlo sería mantener dos tipografías de markdown en el repo.
 *
 * La firma pública NO cambia (`{ text: string }`) porque este componente lo
 * consumen además `financiero/ia/chat-view.tsx` y el portal del cliente
 * (`client-portal/client-ai-trigger.tsx`), que quedan fuera de esta migración
 * y heredan el look KG sin tocar una línea.
 *
 * `headingShift` queda en su default (3): igual que antes, los `#`/`##` del
 * modelo salen como `<h3>` porque la sección padre ya trae su propio heading.
 */
export function SummaryMarkdown({ text }: { readonly text: string }) {
  return <KgMarkdown text={text} />;
}
