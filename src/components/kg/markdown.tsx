"use client";

import ReactMarkdown from "react-markdown";
import type { CSSProperties } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// KG · Markdown. Render de markdown con la tipografía y los tokens KG.
//
// POR QUÉ EXISTE
// El texto de los resúmenes de IA llega como markdown crudo desde el modelo.
// Hoy lo pinta `src/components/dashboard/launches/ai/summary-markdown.tsx`,
// que mapea cada nodo a clases Tailwind de los tokens VIEJOS (`text-fg`,
// `text-fg-muted`, `border-border`, `bg-bg-elevated`, `text-accent`). Este
// archivo es el mismo mapeo, nodo por nodo, pero contra la escala `kg-t*` y
// las CSS vars `--kg-*` — así el bloque de IA deja de ser la única isla con
// tipografía propia dentro del chasis KG.
//
// DECISIONES
//
//  1. `react-markdown` (^10.1.0, ya instalado) — no se escribe un parser.
//     Se usa el mismo prop `components` que el consumidor: se sobreescribe
//     cada elemento, nada queda con el estilo default del browser.
//  2. Sin plugins. El repo NO tiene `remark-gfm` y no se instalan
//     dependencias, así que el dialecto es CommonMark puro — igual que el
//     consumidor actual, que tampoco lo carga. Consecuencia real: **tablas,
//     tachado y task lists NO se parsean** (quedan como texto literal). Es
//     exactamente el comportamiento de hoy, no una regresión; si el módulo
//     de IA empieza a emitir tablas, la solución es agregar `remark-gfm`
//     acá, en un solo lugar.
//  3. `headingShift` en vez de hardcodear "h1/h2 → h3". El consumidor bumpea
//     los headings porque su sección padre ya tiene un `h2`; eso es una
//     decisión del CALLER, no del renderer. Se expone como prop con el
//     mismo default (3) para que el reemplazo sea 1:1.
//  4. "use client": los estilos son objetos y no hay handlers, así que
//     técnicamente podría ser RSC — pero se marca client para que un Server
//     Component (kpi, ia, cobros son todos servidor) lo pueda renderizar
//     pasando sólo `text: string`, sin depender de si `react-markdown`
//     usa hooks internamente.
//
// EJEMPLO DE LLAMADA REAL
// Mismo shape que el consumidor (`{ text: string }` — el markdown crudo de
// la corrida de IA, tal cual sale de `ai_runs.summary_md`):
//
//   <Panel title="Última corrida">
//     <KgMarkdown text={run.summary_md} />
//   </Panel>
//
//   // Historial expandido: la sección padre ya usa h3, así que los headings
//   // del markdown arrancan un nivel más abajo.
//   <KgMarkdown text={item.summary_md} headingShift={4} />
// ═══════════════════════════════════════════════════════════════════════════

/** Nivel HTML del heading más grande que se emite. Ver decisión 3. */
export type KgMarkdownHeadingShift = 3 | 4;

const CODE_FONT =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

/** h1 y h2 del markdown colapsan al mismo nivel visual (el consumidor ya lo hacía). */
const bigHeading: CSSProperties = {
  margin: "24px 0 12px",
  color: "var(--kg-text-1)",
  fontSize: 15,
  fontWeight: 700,
  lineHeight: 1.25,
};

const smallHeading: CSSProperties = {
  margin: "16px 0 8px",
  color: "var(--kg-text-1)",
  fontSize: 13,
  fontWeight: 700,
  lineHeight: 1.3,
};

const paragraph: CSSProperties = {
  margin: "0 0 12px",
  color: "var(--kg-text-2)",
  fontSize: 13,
  lineHeight: 1.6,
};

const list: CSSProperties = {
  margin: "0 0 12px",
  paddingLeft: 20,
  color: "var(--kg-text-2)",
  fontSize: 13,
  lineHeight: 1.6,
};

export function KgMarkdown({
  text,
  headingShift = 3,
  style,
}: {
  /** Markdown crudo. Si viene vacío no se renderiza nada. */
  readonly text: string;
  /**
   * Nivel del heading más grande. 3 = los `#`/`##` del markdown salen como
   * `<h3>` (default, igual que `summary-markdown.tsx`). 4 si el bloque ya
   * está anidado bajo un `h3`.
   */
  readonly headingShift?: KgMarkdownHeadingShift;
  /** Override del wrapper — ej. `{ fontSize: 12 }` para un card compacto. */
  readonly style?: CSSProperties;
}) {
  if (!text.trim()) return null;

  const Big = (headingShift === 4 ? "h4" : "h3") as "h3" | "h4";
  const Small = (headingShift === 4 ? "h5" : "h4") as "h4" | "h5";

  return (
    // `overflowWrap` para que una URL larga del modelo no rompa el ancho del
    // Panel en 390px. El último bloque no arrastra margen inferior.
    <div
      style={{
        color: "var(--kg-text-2)",
        overflowWrap: "anywhere",
        ...style,
      }}
    >
      <ReactMarkdown
        components={{
          h1: ({ children }) => <Big style={bigHeading}>{children}</Big>,
          h2: ({ children }) => <Big style={bigHeading}>{children}</Big>,
          h3: ({ children }) => <Small style={smallHeading}>{children}</Small>,
          h4: ({ children }) => <Small style={smallHeading}>{children}</Small>,
          p: ({ children }) => <p style={paragraph}>{children}</p>,
          ul: ({ children }) => (
            <ul style={{ ...list, listStyleType: "disc" }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ ...list, listStyleType: "decimal" }}>{children}</ol>
          ),
          li: ({ children }) => (
            <li style={{ marginBottom: 5, paddingLeft: 2 }}>{children}</li>
          ),
          strong: ({ children }) => (
            <strong style={{ color: "var(--kg-text-1)", fontWeight: 700 }}>
              {children}
            </strong>
          ),
          em: ({ children }) => <em style={{ fontStyle: "italic" }}>{children}</em>,
          blockquote: ({ children }) => (
            <blockquote
              style={{
                margin: "0 0 12px",
                paddingLeft: 12,
                borderLeft: "2px solid var(--kg-border-strong)",
                color: "var(--kg-text-3)",
              }}
            >
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code
              style={{
                background: "var(--kg-surface-2-solid)",
                border: "1px solid var(--kg-border-subtle)",
                borderRadius: 4,
                padding: "1px 5px",
                fontFamily: CODE_FONT,
                fontSize: 11,
                color: "var(--kg-text-1)",
              }}
            >
              {children}
            </code>
          ),
          // `pre` envuelve al `code` de un fence. Sin este override el bloque
          // hereda el estilo inline del `code` de arriba y se ve como un
          // chip gigante; acá el pre pone la caja y scrollea horizontal.
          pre: ({ children }) => (
            <pre
              style={{
                margin: "0 0 12px",
                padding: 12,
                borderRadius: "var(--kg-r-8)",
                background: "var(--kg-surface-2-solid)",
                border: "1px solid var(--kg-border-subtle)",
                overflowX: "auto",
                fontFamily: CODE_FONT,
                fontSize: 11,
                lineHeight: 1.5,
                color: "var(--kg-text-1)",
              }}
            >
              {children}
            </pre>
          ),
          hr: () => (
            <hr
              style={{
                margin: "16px 0",
                border: "none",
                borderTop: "1px solid var(--kg-border-subtle)",
              }}
            />
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="kg-focus"
              style={{ color: "var(--kg-accent-text)", textDecoration: "underline" }}
            >
              {children}
            </a>
          ),
          img: ({ src, alt }) => (
            // El modelo a veces referencia imágenes que no existen. Se renderiza
            // igual, pero acotada al ancho del contenedor.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={typeof src === "string" ? src : undefined}
              alt={alt ?? ""}
              style={{
                maxWidth: "100%",
                height: "auto",
                borderRadius: "var(--kg-r-8)",
              }}
            />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
