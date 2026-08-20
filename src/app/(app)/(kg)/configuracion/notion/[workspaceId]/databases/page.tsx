import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { DatabasesView, type DatabaseRow } from "./databases-view";

export const metadata: Metadata = { title: "Databases Notion · Configuración" };
export const dynamic = "force-dynamic";

export default async function NotionDatabasesPage({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}) {
  await requireRole("superadmin");
  const { workspaceId } = await params;

  const supabase = await createClient();
  const wsRes = await supabase
    .from("notion_workspaces")
    .select("id, name")
    .eq("id", workspaceId)
    .maybeSingle();
  const ws = wsRes.data as { id: string; name: string } | null;
  if (!ws) notFound();

  const dbsRes = await supabase
    .from("notion_databases")
    .select(
      "id, notion_id, name, enabled, property_map, updated_at, notion_url, icon, parent_type, parent_title",
    )
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });

  const rows: DatabaseRow[] = (
    (dbsRes.data ?? []) as Array<{
      id: string;
      notion_id: string;
      name: string;
      enabled: boolean;
      property_map: Record<string, unknown> | null;
      updated_at: string;
      notion_url: string | null;
      icon: string | null;
      parent_type: string | null;
      parent_title: string | null;
    }>
  ).map((r) => ({
    id: r.id,
    notionId: r.notion_id,
    name: r.name,
    enabled: r.enabled,
    hasMapping: !!(r.property_map && (r.property_map as { title_prop?: string }).title_prop),
    updatedAt: r.updated_at,
    notionUrl: r.notion_url,
    icon: r.icon,
    parentType: r.parent_type,
    parentTitle: r.parent_title,
  }));

  return (
    <section
      style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 900 }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Link
          href="/configuracion/notion"
          className="kg-focus"
          style={{
            color: "var(--kg-text-3)",
            fontSize: 11,
            textDecoration: "none",
            width: "fit-content",
          }}
        >
          ← Volver a workspaces
        </Link>
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 700,
            color: "var(--kg-text-1)",
          }}
        >
          Databases de {ws.name}
        </h2>
        <p
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", lineHeight: 1.5, margin: 0 }}
        >
          Cada database sincronizada aterriza sus pages como proyectos
          internos de Operaciones. Configurá el mapeo de propiedades por
          database antes de habilitarla — sin mapping el sync no sabe qué
          columna es el título, status, etc.
        </p>
      </header>

      <DatabasesView workspaceId={workspaceId} rows={rows} />
    </section>
  );
}
