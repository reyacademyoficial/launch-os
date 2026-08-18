"use client";

import { useActionState, useState, useTransition } from "react";

import {
  createNotionWorkspace,
  testNotionConnection,
  type CreateWorkspaceState,
  type TestConnectionResult,
} from "./actions";

/**
 * Form para agregar un workspace de Notion.
 *
 * FLUJO
 *   1. Usuario ingresa nombre + token.
 *   2. Click "Probar conexión" (opcional pero recomendado) — llama
 *      `testNotionConnection` sin escribir. Muestra el workspace_name que
 *      Notion reporta para confirmar que es el correcto.
 *   3. Click "Guardar" — llama `createNotionWorkspace` que RE-testea y
 *      guarda solo si pasa. Idempotencia contra tokens rotados.
 *
 * El botón "Guardar" no requiere haber testeado antes — la action lo hace
 * igual. "Probar" es feedback UX previo al submit para evitar guardar un
 * token roto.
 */
export function AddWorkspaceForm() {
  const [state, formAction, pending] = useActionState<
    CreateWorkspaceState,
    FormData
  >(createNotionWorkspace, null);

  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(
    null,
  );
  const [testing, startTest] = useTransition();

  function handleTest() {
    setTestResult(null);
    startTest(async () => {
      const res = await testNotionConnection(token);
      setTestResult(res);
    });
  }

  const isSaved = state && "ok" in state && state.ok;

  return (
    <form
      action={formAction}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: 16,
        borderRadius: "var(--kg-r-12)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
      }}
    >
      <div>
        <label htmlFor="ws_name" style={labelStyle}>
          Nombre <span style={{ color: "#EF4444" }}>*</span>
        </label>
        <input
          id="ws_name"
          name="name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: Personal, Equipo Rey Academy…"
          autoComplete="off"
          style={inputStyle}
        />
        <div style={hintStyle}>
          Solo para identificarlo en Kingrow — no tiene que matchear el
          nombre en Notion.
        </div>
      </div>

      <div>
        <label htmlFor="ws_token" style={labelStyle}>
          Internal Integration Secret{" "}
          <span style={{ color: "#EF4444" }}>*</span>
        </label>
        <input
          id="ws_token"
          name="secret_token"
          type="password"
          required
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            // Un cambio de token invalida el test previo — evita guardar
            // pensando que ya se validó cuando en realidad se editó.
            setTestResult(null);
          }}
          placeholder="secret_..."
          autoComplete="off"
          spellCheck={false}
          style={inputStyle}
        />
        <div style={hintStyle}>
          Lo generás en{" "}
          <a
            href="https://www.notion.so/my-integrations"
            target="_blank"
            rel="noreferrer noopener"
            style={{ color: "var(--kg-accent-500)" }}
          >
            notion.so/my-integrations
          </a>{" "}
          → New integration → Internal → Copiar el "Internal Integration
          Secret".
        </div>
      </div>

      {testResult && testResult.ok && (
        <Callout tone="positive">
          Conexión OK
          {testResult.workspaceName
            ? ` — workspace de Notion: ${testResult.workspaceName}`
            : ""}
          . Ya podés guardar.
        </Callout>
      )}

      {testResult && !testResult.ok && (
        <Callout tone="negative">{testResult.error}</Callout>
      )}

      {state && "error" in state && !isSaved && (
        <Callout tone="negative">{state.error}</Callout>
      )}

      {isSaved && (
        <Callout tone="positive">
          Workspace guardado. Descubrí sus databases desde la card de arriba
          para configurar cuáles sincronizar.
        </Callout>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={handleTest}
          disabled={testing || pending || !token || !name}
          className="kg-focus"
          style={secondaryBtn}
        >
          {testing ? "Probando…" : "Probar conexión"}
        </button>
        <button
          type="submit"
          disabled={pending || !token || !name}
          className="kg-focus"
          style={{ ...primaryBtn, opacity: pending ? 0.7 : 1 }}
        >
          {pending ? "Guardando…" : "Guardar workspace"}
        </button>
      </div>
    </form>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-componentes de UI
// ═══════════════════════════════════════════════════════════════════════════

function Callout({
  tone,
  children,
}: {
  readonly tone: "positive" | "negative";
  readonly children: React.ReactNode;
}) {
  const map = {
    positive: { bg: "rgba(0,208,132,0.10)", border: "#00D084", fg: "#00D084" },
    negative: { bg: "rgba(239,68,68,0.10)", border: "#EF4444", fg: "#EF4444" },
  } as const;
  const s = map[tone];
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: "var(--kg-r-8)",
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.fg,
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  color: "var(--kg-text-3)",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.3,
  marginBottom: 5,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-bg-base)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 13,
  fontFamily: "inherit",
};

const hintStyle: React.CSSProperties = {
  color: "var(--kg-text-3)",
  fontSize: 11,
  marginTop: 5,
  lineHeight: 1.5,
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
