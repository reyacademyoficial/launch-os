import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { UsersMappingView, type OrgPersonOption, type NotionUserRow } from "./users-mapping-view";

export const metadata: Metadata = { title: "Usuarios Notion · Configuración" };
export const dynamic = "force-dynamic";

export default async function NotionUsersPage({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}) {
  await requireRole("superadmin");

  const { workspaceId } = await params;
  const supabase = await createClient();

  // ─── Workspace exists + name ──────────────────────────────────────────
  const wsRes = await supabase
    .from("notion_workspaces")
    .select("id, name, organization_id, enabled")
    .eq("id", workspaceId)
    .maybeSingle();
  const ws = wsRes.data as
    | { id: string; name: string; organization_id: string; enabled: boolean }
    | null;
  if (!ws) notFound();

  // ─── Notion users cacheados + personas de la org (para el dropdown) ───
  const [notionUsersRes, peopleRes] = await Promise.all([
    supabase
      .from("notion_users")
      .select("notion_user_id, email, name, avatar_url, kg_person_id")
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true }),
    supabase
      .from("organization_people")
      .select("id, full_name, email, active")
      .eq("organization_id", ws.organization_id)
      .order("full_name", { ascending: true }),
  ]);

  const rows: NotionUserRow[] = (
    (notionUsersRes.data ?? []) as Array<{
      notion_user_id: string;
      email: string | null;
      name: string | null;
      avatar_url: string | null;
      kg_person_id: string | null;
    }>
  ).map((r) => ({
    notionUserId: r.notion_user_id,
    email: r.email,
    name: r.name,
    avatarUrl: r.avatar_url,
    kgPersonId: r.kg_person_id,
  }));

  const people: OrgPersonOption[] = (
    (peopleRes.data ?? []) as Array<{
      id: string;
      full_name: string;
      email: string | null;
      active: boolean;
    }>
  ).map((p) => ({
    id: p.id,
    fullName: p.full_name,
    email: p.email,
    active: p.active,
  }));

  const mapped = rows.filter((r) => r.kgPersonId != null).length;
  const unmapped = rows.length - mapped;

  return (
    <section
      style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 900 }}
    >
      <header
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
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
          Usuarios de {ws.name}
        </h2>
        <p
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", lineHeight: 1.5, margin: 0 }}
        >
          Los usuarios de Notion se traen con "Sincronizar" y se matchean
          automáticamente por email con personas de la organización. Los que
          no coincidan se pueden mapear manualmente con el dropdown de la
          derecha. El mapping se usa después para resolver el "owner" al
          importar proyectos desde Notion.
        </p>
      </header>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Stat label="Total Notion" value={rows.length} />
        <Stat label="Mapeados" value={mapped} tone="ok" />
        <Stat
          label="Sin mapear"
          value={unmapped}
          tone={unmapped > 0 ? "warning" : "muted"}
        />
      </div>

      <UsersMappingView
        workspaceId={workspaceId}
        rows={rows}
        people={people}
      />
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: "ok" | "warning" | "muted";
}) {
  const color =
    tone === "ok"
      ? "#00D084"
      : tone === "warning"
        ? "#FFB800"
        : "var(--kg-text-1)";
  return (
    <div
      style={{
        padding: "8px 14px",
        borderRadius: "var(--kg-r-8)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
        display: "flex",
        gap: 10,
        alignItems: "baseline",
      }}
    >
      <span
        style={{
          fontSize: 20,
          fontWeight: 700,
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
      <span
        className="kg-t7"
        style={{
          color: "var(--kg-text-3)",
          textTransform: "uppercase",
          letterSpacing: 0.3,
        }}
      >
        {label}
      </span>
    </div>
  );
}
