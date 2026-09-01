import type { CSSProperties, ReactNode } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// Primitives compartidas de drawers de formulario (KG).
//
// Antes vivían copiadas en cada `*-form-drawer.tsx` de financiero y marketing.
// El estilo ya era idéntico entre módulos — este archivo es la sola fuente.
//
// Uso típico:
//
//   import { Field, inputStyle, primaryBtn, secondaryBtn, dangerBtn, ErrorBanner }
//     from "@/components/kg/form-primitives";
//
//   <Field label="Título" htmlFor="title" required>
//     <input id="title" name="title" style={inputStyle} />
//   </Field>
//
// Los estilos son objetos `React.CSSProperties` (no clases Tailwind) porque
// el resto de los drawers ya los consume así y los inputs mezclan `style`
// con overrides puntuales (ej: `{ ...inputStyle, resize: 'vertical' }`).
// ═══════════════════════════════════════════════════════════════════════════

export function Field({
  label,
  htmlFor,
  required,
  hint,
  children,
}: {
  readonly label: string;
  readonly htmlFor: string;
  readonly required?: boolean;
  /** Explicación corta bajo el input. Se linkea al control con aria-describedby. */
  readonly hint?: string;
  readonly children: ReactNode;
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
      {hint && (
        <div
          id={`${htmlFor}_hint`}
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 5 }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

export function ErrorBanner({ message }: { readonly message: string }) {
  return (
    <div
      role="alert"
      style={{
        padding: "10px 14px",
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

export const inputStyle: CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 13,
  colorScheme: "dark",
};

export const primaryBtn: CSSProperties = {
  padding: "8px 16px",
  borderRadius: 999,
  background: "var(--kg-accent-500)",
  border: "none",
  color: "#fff",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

export const secondaryBtn: CSSProperties = {
  padding: "8px 16px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

export const dangerBtn: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid #EF4444",
  color: "#EF4444",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};

export const smallBtn: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
};

/**
 * Botón "+ Nuevo X" para usarse como `actions` del Panel. Padding chico
 * (6/14) — el de dentro del cuerpo del form (`primaryBtn`) es más grande.
 */
export const panelActionPrimaryBtn: CSSProperties = {
  padding: "6px 14px",
  borderRadius: 999,
  background: "var(--kg-accent-500)",
  color: "#fff",
  border: "none",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

/**
 * Botón secundario en el header del Panel — equivalente al "Exportar Excel"
 * de financiero. Mismo padding chico.
 */
export const panelActionSecondaryBtn: CSSProperties = {
  padding: "6px 14px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};
