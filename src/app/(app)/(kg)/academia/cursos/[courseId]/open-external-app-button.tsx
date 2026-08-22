"use client";

import { useState } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// Botón "Abrir app externa" (Fase G · 0153).
//
// Al click:
//   1) fetch al endpoint /api/academia/external-app/sso?courseId=…
//   2) si devuelve { url }, abre en nueva pestaña con window.open(url, '_blank')
//   3) si devuelve error (403/404/500), lo muestra inline
//
// NOTA: window.open desde un handler async puede ser bloqueado por popup
// blockers. Para minimizarlo abrimos la ventana SINCRÓNAMENTE al inicio del
// click con about:blank y luego seteamos su .location cuando llega la URL.
// Si el fetch falla, cerramos la ventana.
// ═══════════════════════════════════════════════════════════════════════════

interface SsoResponse {
  readonly url?: string;
  readonly error?: string;
}

export function OpenExternalAppButton({
  courseId,
  appName,
}: {
  readonly courseId: string;
  readonly appName: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (loading) return;
    setError(null);
    setLoading(true);

    // Abrir ventana ya para no ser bloqueado — la rellenamos con la URL.
    const win = window.open("about:blank", "_blank", "noopener,noreferrer");

    try {
      const res = await fetch(
        `/api/academia/external-app/sso?courseId=${encodeURIComponent(courseId)}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
        },
      );
      const body = (await res.json().catch(() => ({}))) as SsoResponse;
      if (!res.ok || !body.url) {
        if (win) win.close();
        setError(
          body.error ??
            `No se pudo generar el enlace (HTTP ${res.status}).`,
        );
        return;
      }
      if (win) {
        win.location.href = body.url;
      } else {
        // Popup bloqueado — fallback: navegar en la pestaña actual
        window.location.href = body.url;
      }
    } catch (err) {
      if (win) win.close();
      const message = err instanceof Error ? err.message : "Error de red.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="kg-focus"
        style={{
          padding: "8px 16px",
          borderRadius: 999,
          background: "var(--kg-accent-500)",
          border: "none",
          color: "#fff",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
          opacity: loading ? 0.7 : 1,
          alignSelf: "flex-start",
        }}
      >
        {loading ? "Generando enlace…" : `Abrir ${appName}`}
      </button>
      {error && (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            borderRadius: "var(--kg-r-8)",
            background: "rgba(239,68,68,0.10)",
            border: "1px solid #EF4444",
            color: "#EF4444",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
