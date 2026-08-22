"use client";

import { useState, useTransition } from "react";

import { exportCohortAttendanceCsv } from "./classes/actions";

// ═══════════════════════════════════════════════════════════════════════════
// Botón "Exportar asistencia CSV" — Fase H · task #5.
//
// Llama server action, arma un Blob con el CSV y dispara un <a download>
// programático. Simple y sin dependencias (nada de papaparse).
// ═══════════════════════════════════════════════════════════════════════════

export function ExportAttendanceButton({
  cohortId,
}: {
  readonly cohortId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const res = await exportCohortAttendanceCsv(cohortId);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      // Prepend BOM para que Excel abra el CSV en UTF-8 sin romper acentos.
      const blob = new Blob(["﻿", res.csv], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Liberar el objectURL en el próximo tick para que el download se
      // complete en Safari/Firefox antes del revoke.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="kg-focus"
        style={{
          padding: "6px 14px",
          borderRadius: 999,
          background: "transparent",
          border: "1px solid var(--kg-border-subtle)",
          color: "var(--kg-text-2)",
          fontSize: 11,
          fontWeight: 700,
          cursor: pending ? "not-allowed" : "pointer",
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? "Generando…" : "Exportar asistencia CSV"}
      </button>
      {error && (
        <span
          className="kg-t7"
          style={{ color: "#EF4444", fontSize: 10 }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
