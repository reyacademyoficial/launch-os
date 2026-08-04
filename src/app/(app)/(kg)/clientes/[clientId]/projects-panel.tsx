"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { EmptyState } from "@/components/kg/empty-state";
import { StatusPill } from "@/components/kg/status-pill";

import { detachProjectFromClient } from "./actions";
import {
  AttachProjectDrawer,
  type AvailableProject,
} from "./attach-project-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Panel de projects atados al cliente + drawer para atar más.
//
// Cliente porque maneja el estado del drawer y la acción de desatar. La
// data (attached + available) la trae la ficha server-side.
// ═══════════════════════════════════════════════════════════════════════════

export interface AttachedProject {
  readonly id: string;
  readonly name: string;
  readonly businessName: string | null;
  readonly ownership: "propia" | "externa";
}

export function ProjectsPanel({
  clientId,
  attached,
  available,
}: {
  readonly clientId: string;
  readonly attached: readonly AttachedProject[];
  readonly available: readonly AvailableProject[];
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [detachingId, setDetachingId] = useState<string | null>(null);

  function handleDetach(projectId: string, projectName: string) {
    const ok = window.confirm(
      `¿Desatar el project "${projectName}" del cliente? ` +
        "El project sigue existiendo en LaunchOS, solo se quita la referencia acá.",
    );
    if (!ok) return;
    setError(null);
    setDetachingId(projectId);
    startTransition(async () => {
      const result = await detachProjectFromClient(projectId);
      setDetachingId(null);
      if ("error" in result) setError(result.error);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
          {attached.length === 0
            ? "Sin projects atados"
            : `${attached.length} ${attached.length === 1 ? "project atado" : "projects atados"}`}
        </div>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="kg-focus"
          style={{
            padding: "6px 14px",
            borderRadius: 999,
            background: "var(--kg-accent-500)",
            border: "none",
            color: "#fff",
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          + Atar project
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "var(--kg-r-8)",
            background: "rgba(239,68,68,0.10)",
            border: "1px solid #EF4444",
            color: "#EF4444",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {attached.length === 0 ? (
        <EmptyState
          title="Sin projects atados a este cliente"
          hint="Los projects son unidades de trabajo de LaunchOS (launches, funnels, cursos gestionados). Atalos acá para que sus liquidaciones y facturas cuenten en el LTV del cliente."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {attached.map((p) => {
            const isDetaching = detachingId === p.id;
            return (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  borderRadius: "var(--kg-r-8)",
                  background: "var(--kg-surface-2-solid)",
                  border: "1px solid var(--kg-border-subtle)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link
                    href={`/proyectos/${p.id}`}
                    className="kg-focus"
                    style={{
                      color: "var(--kg-text-1)",
                      textDecoration: "none",
                      fontWeight: 600,
                      fontSize: 13,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      display: "block",
                    }}
                  >
                    {p.name}
                  </Link>
                  <div
                    className="kg-t7"
                    style={{
                      color: "var(--kg-text-3)",
                      marginTop: 2,
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <StatusPill
                      text={p.ownership === "propia" ? "Propio" : "Externo"}
                      tone={
                        p.ownership === "propia"
                          ? "var(--kg-accent-500)"
                          : "var(--kg-neutral-500)"
                      }
                    />
                    {p.businessName && (
                      <span style={{ color: "var(--kg-text-3)" }}>
                        {p.businessName}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDetach(p.id, p.name)}
                  disabled={pending}
                  className="kg-focus"
                  style={{
                    padding: "4px 12px",
                    borderRadius: 999,
                    background: "transparent",
                    border: "1px solid var(--kg-border-subtle)",
                    color: "var(--kg-text-2)",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: pending ? "wait" : "pointer",
                    opacity: pending && !isDetaching ? 0.4 : 1,
                  }}
                >
                  {isDetaching ? "Desatando…" : "Desatar"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <AttachProjectDrawer
        clientId={clientId}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        available={available}
      />
    </div>
  );
}
