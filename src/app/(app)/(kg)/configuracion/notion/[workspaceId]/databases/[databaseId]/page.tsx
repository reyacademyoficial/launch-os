import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { parsePropertyMap } from "@/lib/notion/property-map";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { retrieveNotionDatabaseSchema } from "../../../actions";

import { MappingForm } from "./mapping-form";

export const metadata: Metadata = { title: "Mapeo Notion · Configuración" };
export const dynamic = "force-dynamic";

export default async function NotionDatabaseMappingPage({
  params,
}: {
  readonly params: Promise<{ workspaceId: string; databaseId: string }>;
}) {
  await requireRole("superadmin");
  const { workspaceId, databaseId } = await params;

  const supabase = await createClient();
  const dbRes = await supabase
    .from("notion_databases")
    .select("id, name, property_map")
    .eq("id", databaseId)
    .maybeSingle();
  const db = dbRes.data as
    | { id: string; name: string; property_map: unknown }
    | null;
  if (!db) notFound();

  // Fetch schema desde la API Notion — necesario para poblar los dropdowns
  // con los nombres reales de las columnas + los option values de select/status.
  const schemaRes = await retrieveNotionDatabaseSchema(databaseId);

  const existingMap = parsePropertyMap(db.property_map);

  return (
    <section
      style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 780 }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Link
          href={`/configuracion/notion/${workspaceId}/databases`}
          className="kg-focus"
          style={{
            color: "var(--kg-text-3)",
            fontSize: 11,
            textDecoration: "none",
            width: "fit-content",
          }}
        >
          ← Volver a databases
        </Link>
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 700,
            color: "var(--kg-text-1)",
          }}
        >
          Mapeo de {db.name}
        </h2>
        <p
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", lineHeight: 1.5, margin: 0 }}
        >
          Decile a Kingrow qué columna de esta database representa cada
          campo de un proyecto interno. Solo el título es obligatorio —
          el resto es opcional. Los valores de status/priority requieren
          además un mapeo de los option values de Notion a los valores
          fijos del schema KG.
        </p>
      </header>

      {schemaRes.ok ? (
        <MappingForm
          databaseId={databaseId}
          schema={schemaRes.schema}
          initialMap={existingMap}
        />
      ) : (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: "var(--kg-r-8)",
            background: "rgba(239,68,68,0.10)",
            border: "1px solid #EF4444",
            color: "#EF4444",
            fontSize: 12,
          }}
        >
          No pudimos traer el schema de esta database: {schemaRes.error}
        </div>
      )}
    </section>
  );
}
