"use client";

import { useState, useTransition } from "react";

import { expireEnrollmentNow } from "../actions";

/**
 * Botón "Dar de baja ahora" para un enrollment activo. Confirma con el
 * usuario, invoca el server action y muestra el estado del webhook.
 * Visible solo si el caller es admin/coordinador (gate server-side en la
 * page + defensa dentro del action con `requireRole`).
 */
export function EnrollmentExpireButton({
  enrollmentId,
  studentId,
  cohortLabel,
}: {
  readonly enrollmentId: string;
  readonly studentId: string;
  readonly cohortLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function handleClick() {
    const confirmed = window.confirm(
      `¿Dar de baja ahora al alumno de "${cohortLabel}"? ` +
        "El enrollment queda 'expired' y se dispara el webhook GHL (si está configurado en el curso).",
    );
    if (!confirmed) return;
    setError(null);
    setOk(null);
    startTransition(async () => {
      const result = await expireEnrollmentNow(enrollmentId, studentId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      const label =
        result.webhookStatus === "sent"
          ? "Baja aplicada · webhook GHL enviado"
          : result.webhookStatus === "failed"
            ? "Baja aplicada · webhook GHL falló (se reintenta)"
            : result.webhookStatus === "skipped"
              ? "Baja aplicada · curso sin webhook configurado"
              : "Baja aplicada";
      setOk(label);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="kg-focus"
        style={{
          padding: "4px 10px",
          borderRadius: 999,
          background: "transparent",
          border: "1px solid #EF4444",
          color: "#EF4444",
          fontSize: 10,
          fontWeight: 700,
          cursor: "pointer",
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? "Dando de baja…" : "Dar de baja ahora"}
      </button>
      {error && (
        <span
          className="kg-t7"
          style={{ color: "#EF4444", fontSize: 10, maxWidth: 240, textAlign: "right" }}
        >
          {error}
        </span>
      )}
      {ok && (
        <span
          className="kg-t7"
          style={{ color: "var(--kg-positive-500)", fontSize: 10 }}
        >
          {ok}
        </span>
      )}
    </div>
  );
}
