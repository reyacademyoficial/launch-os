import { describe, expect, it } from "vitest";

import type { NotionPage } from "./client";
import { mapNotionPageToInternalProject, type MapContext } from "./map-page-to-project";
import type { NotionPropertyMap } from "./property-map";

const NOW = "2026-08-18T15:00:00.000Z";
const ORG = "org-1";
const WS = "ws-1";
const DB = "db-1";

function makeCtx(
  assigneeMap: Record<string, string | null> = {},
): MapContext {
  return {
    organizationId: ORG,
    workspaceId: WS,
    databaseId: DB,
    assigneeToKgPerson: (nu) => assigneeMap[nu] ?? null,
    nowIso: NOW,
  };
}

function makePage(properties: Record<string, unknown>): NotionPage {
  return {
    id: "page-1",
    url: "https://notion.so/x/page-1",
    last_edited_time: "2026-08-18T14:00:00.000Z",
    created_time: "2026-08-01T10:00:00.000Z",
    properties,
  };
}

describe("mapNotionPageToInternalProject", () => {
  it("mapping completo — todos los campos configurados y presentes", () => {
    const map: NotionPropertyMap = {
      title_prop: "Name",
      status_prop: "Status",
      status_map: {
        "In progress": "en_proceso",
        Done: "listo",
      },
      priority_prop: "Priority",
      priority_map: { Alta: "alta" },
      assignee_prop: "Owner",
      due_prop: "Due",
      start_prop: "Start",
      description_prop: "Descripción",
    };
    const page = makePage({
      Name: {
        type: "title",
        title: [{ plain_text: "Rediseño roadmap" }],
      },
      Status: { type: "select", select: { name: "In progress" } },
      Priority: { type: "select", select: { name: "Alta" } },
      Owner: { type: "people", people: [{ id: "notion-user-abc" }] },
      Due: { type: "date", date: { start: "2026-09-01" } },
      Start: { type: "date", date: { start: "2026-08-01" } },
      Descripción: {
        type: "rich_text",
        rich_text: [{ plain_text: "Detalle largo del proyecto." }],
      },
    });

    const res = mapNotionPageToInternalProject(
      page,
      map,
      makeCtx({ "notion-user-abc": "kg-person-1" }),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.payload).toEqual({
      organization_id: ORG,
      name: "Rediseño roadmap",
      description: "Detalle largo del proyecto.",
      status: "en_proceso",
      priority: "alta",
      starts_on: "2026-08-01",
      due_on: "2026-09-01",
      notion_page_id: "page-1",
      notion_database_id: DB,
      notion_workspace_id: WS,
      notion_synced_at: NOW,
    });
    expect(res.result.ownerIds).toEqual(["kg-person-1"]);
  });

  it("falta el título → rechaza con reason='missing-title'", () => {
    // internal_projects.name es NOT NULL. Un page sin título no puede
    // aterrizar como project — el sync lo skippea y sigue con el resto.
    const map: NotionPropertyMap = { title_prop: "Name" };
    const page = makePage({
      Name: { type: "title", title: [] },
    });
    const res = mapNotionPageToInternalProject(page, map, makeCtx());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("missing-title");
  });

  it("sin status_prop configurado → cae a 'sin_empezar' silencioso", () => {
    // Escenario: el humano no configuró el mapping de status. Todos los
    // pages entran como sin_empezar para que el operador triage después.
    const map: NotionPropertyMap = { title_prop: "Name" };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "Tarea suelta" }] },
    });
    const res = mapNotionPageToInternalProject(page, map, makeCtx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.payload.status).toBe("sin_empezar");
    expect(res.result.payload.priority).toBe("media");
    expect(res.result.ownerIds).toEqual([]);
  });

  it("auto-normalización: 'En proceso' de Notion → 'en_proceso' sin map explícito", () => {
    // Si el operador no llenó el status_map pero los labels de Notion
    // matchean el enum KG (mismo texto, ignorando case/tildes/espacios),
    // el mapper resuelve solo via applyValueMap + KG_STATUSES.
    const map: NotionPropertyMap = {
      title_prop: "Name",
      status_prop: "Status",
      // Sin status_map explícito.
    };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "X" }] },
      Status: { type: "status", status: { name: "En proceso" } },
    });
    const res = mapNotionPageToInternalProject(page, map, makeCtx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.payload.status).toBe("en_proceso");
  });

  it("auto-normalización con tildes: 'Alerta máxima' → 'alerta_maxima'", () => {
    const map: NotionPropertyMap = {
      title_prop: "Name",
      priority_prop: "Priority",
      status_prop: "Status",
    };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "X" }] },
      Status: { type: "status", status: { name: "Alerta máxima" } },
      Priority: { type: "select", select: { name: "Alta" } },
    });
    const res = mapNotionPageToInternalProject(page, map, makeCtx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.payload.status).toBe("alerta_maxima");
    expect(res.result.payload.priority).toBe("alta");
  });

  it("status Notion no está en enum KG ni en map → fallback 'sin_empezar'", () => {
    // "Custom X" ni matchea el auto-normalizador ni tiene entry explícita.
    // Cae al fallback en vez de reventar el CHECK del schema.
    const map: NotionPropertyMap = {
      title_prop: "Name",
      status_prop: "Status",
    };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "X" }] },
      Status: { type: "select", select: { name: "Custom X" } },
    });
    const res = mapNotionPageToInternalProject(page, map, makeCtx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.payload.status).toBe("sin_empezar");
  });

  it("assignee sin mapping a KG persona → ownerIds vacío", () => {
    const map: NotionPropertyMap = {
      title_prop: "Name",
      assignee_prop: "Owner",
    };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "X" }] },
      Owner: { type: "people", people: [{ id: "notion-user-no-mapea" }] },
    });
    const res = mapNotionPageToInternalProject(page, map, makeCtx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.ownerIds).toEqual([]);
  });

  it("assignee con múltiples people → devuelve TODOS los mapeados sin duplicar", () => {
    // Cambio de 0140: ahora Notion permite N responsables y los persistimos
    // TODOS en la junction internal_project_owners. Los no-mapeados se
    // filtran; los duplicados (misma persona mapeada 2 veces) se dedupean.
    const map: NotionPropertyMap = {
      title_prop: "Name",
      assignee_prop: "Owner",
    };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "X" }] },
      Owner: {
        type: "people",
        people: [
          { id: "nu-a" },
          { id: "no-mapea" },
          { id: "nu-b" },
          { id: "nu-a" }, // duplicado — mismo notion user
        ],
      },
    });
    const res = mapNotionPageToInternalProject(
      page,
      map,
      makeCtx({ "nu-a": "kg-a", "nu-b": "kg-b" }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.ownerIds).toEqual(["kg-a", "kg-b"]);
  });

  it("dos notion users mapeados a la MISMA kg person → dedup en ownerIds", () => {
    // Caso poco frecuente pero posible: dos cuentas Notion apuntan a la
    // misma persona KG (después de una migración de email, por ejemplo).
    // La junction tiene PK (project, person) — no toleraría el duplicado.
    const map: NotionPropertyMap = {
      title_prop: "Name",
      assignee_prop: "Owner",
    };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "X" }] },
      Owner: {
        type: "people",
        people: [{ id: "nu-old" }, { id: "nu-new" }],
      },
    });
    const res = mapNotionPageToInternalProject(
      page,
      map,
      makeCtx({ "nu-old": "kg-1", "nu-new": "kg-1" }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.ownerIds).toEqual(["kg-1"]);
  });

  it("fechas ausentes → starts_on / due_on null", () => {
    const map: NotionPropertyMap = {
      title_prop: "Name",
      due_prop: "Due",
      start_prop: "Start",
    };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "X" }] },
      Due: { type: "date", date: null },
      Start: { type: "date", date: null },
    });
    const res = mapNotionPageToInternalProject(page, map, makeCtx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.payload.due_on).toBeNull();
    expect(res.result.payload.starts_on).toBeNull();
  });

  it("preserva metadata de trazabilidad (page_id, db_id, workspace_id, synced_at)", () => {
    const map: NotionPropertyMap = { title_prop: "Name" };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "X" }] },
    });
    const res = mapNotionPageToInternalProject(page, map, makeCtx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.payload.notion_page_id).toBe("page-1");
    expect(res.result.payload.notion_database_id).toBe(DB);
    expect(res.result.payload.notion_workspace_id).toBe(WS);
    expect(res.result.payload.notion_synced_at).toBe(NOW);
  });
});
