import type { Metadata } from "next";

import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { AddWorkspaceForm } from "./add-workspace-form";
import { WorkspaceRow } from "./workspace-row";

export const metadata: Metadata = { title: "Notion · Configuración" };
export const dynamic = "force-dynamic";

interface WorkspaceRowData {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly lastVerifiedAt: string | null;
  readonly lastVerifyOk: boolean | null;
  readonly databasesCount: number;
  readonly databasesEnabledCount: number;
}

export default async function ConfiguracionNotionPage() {
  // Superadmin + dev bypass. La UI de config expone tokens de integrations,
  // no queremos que otros roles la vean ni por URL directa.
  await requireRole("superadmin");

  const supabase = await createClient();
  const wsRes = await supabase
    .from("notion_workspaces")
    .select("id, name, enabled, last_verified_at, last_verify_ok")
    .order("created_at", { ascending: true });

  const workspaces = (wsRes.data ?? []) as Array<{
    id: string;
    name: string;
    enabled: boolean;
    last_verified_at: string | null;
    last_verify_ok: boolean | null;
  }>;

  // Contamos DBs por workspace en una query aparte — la cardinalidad es baja
  // (workspaces del orden de 1-5, DBs < 20 c/u) así que un solo select y
  // agregado en JS es más simple que un aggregate del lado Postgrest.
  const wsIds = workspaces.map((w) => w.id);
  const dbCounts = new Map<string, { total: number; enabled: number }>();
  if (wsIds.length > 0) {
    const dbsRes = await supabase
      .from("notion_databases")
      .select("workspace_id, enabled")
      .in("workspace_id", wsIds);
    const rows = (dbsRes.data ?? []) as Array<{
      workspace_id: string;
      enabled: boolean;
    }>;
    for (const r of rows) {
      const cur = dbCounts.get(r.workspace_id) ?? { total: 0, enabled: 0 };
      cur.total += 1;
      if (r.enabled) cur.enabled += 1;
      dbCounts.set(r.workspace_id, cur);
    }
  }

  const rows: WorkspaceRowData[] = workspaces.map((w) => {
    const c = dbCounts.get(w.id) ?? { total: 0, enabled: 0 };
    return {
      id: w.id,
      name: w.name,
      enabled: w.enabled,
      lastVerifiedAt: w.last_verified_at,
      lastVerifyOk: w.last_verify_ok,
      databasesCount: c.total,
      databasesEnabledCount: c.enabled,
    };
  });

  return (
    <section
      style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 780 }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 700,
            color: "var(--kg-text-1)",
          }}
        >
          Sincronización con Notion
        </h2>
      </header>

      {rows.length === 0 ? (
        <div
          className="kg-glass"
          style={{
            padding: 20,
            borderRadius: "var(--kg-r-12)",
            border: "1px dashed var(--kg-border-subtle)",
            color: "var(--kg-text-3)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          Todavía no conectaste ningún Espacio de Notion. Usá el formulario
          de abajo con el token de tu integración para arrancar.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h3
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 700,
              color: "var(--kg-text-2)",
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            Espacios conectados
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((w) => (
              <WorkspaceRow key={w.id} workspace={w} />
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h3
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 700,
            color: "var(--kg-text-2)",
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          Agregar nuevo espacio
        </h3>
        <AddWorkspaceForm />
      </div>
    </section>
  );
}
