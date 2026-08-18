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
        "In progress": "active",
        Done: "done",
      },
      priority_prop: "Priority",
      priority_map: { Alta: "high" },
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
    expect(res.payload).toEqual({
      organization_id: ORG,
      name: "Rediseño roadmap",
      description: "Detalle largo del proyecto.",
      status: "active",
      priority: "high",
      owner_id: "kg-person-1",
      starts_on: "2026-08-01",
      due_on: "2026-09-01",
      notion_page_id: "page-1",
      notion_database_id: DB,
      notion_workspace_id: WS,
      notion_synced_at: NOW,
    });
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

  it("sin status_prop configurado → cae a 'backlog' silencioso", () => {
    // Escenario: el humano no configuró el mapping de status. Todos los
    // pages entran como backlog para que el operador triage después.
    const map: NotionPropertyMap = { title_prop: "Name" };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "Tarea suelta" }] },
    });
    const res = mapNotionPageToInternalProject(page, map, makeCtx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.status).toBe("backlog");
    expect(res.payload.priority).toBe("med");
  });

  it("status en Notion no está en el map → fallback 'backlog'", () => {
    // El operador configuró map con "In progress"→"active" pero la page
    // tiene "Blocked" que no está mapeado. Cae a backlog en vez de meter
    // un valor que rompa el CHECK del schema.
    const map: NotionPropertyMap = {
      title_prop: "Name",
      status_prop: "Status",
      status_map: { "In progress": "active" },
    };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "X" }] },
      Status: { type: "select", select: { name: "Blocked" } },
    });
    const res = mapNotionPageToInternalProject(page, map, makeCtx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.status).toBe("backlog");
  });

  it("assignee sin mapping a KG persona → owner_id null", () => {
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
    expect(res.payload.owner_id).toBeNull();
  });

  it("assignee con múltiples people → toma el primero mapeado", () => {
    // Notion permite múltiples people; nosotros tomamos el primer notion
    // user que esté mapeado a una KG persona. Los demás se ignoran.
    const map: NotionPropertyMap = {
      title_prop: "Name",
      assignee_prop: "Owner",
    };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "X" }] },
      Owner: {
        type: "people",
        people: [
          { id: "no-mapea-1" },
          { id: "mapea" },
          { id: "no-mapea-2" },
        ],
      },
    });
    const res = mapNotionPageToInternalProject(
      page,
      map,
      makeCtx({ mapea: "kg-1" }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.owner_id).toBe("kg-1");
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
    expect(res.payload.due_on).toBeNull();
    expect(res.payload.starts_on).toBeNull();
  });

  it("preserva metadata de trazabilidad (page_id, db_id, workspace_id, synced_at)", () => {
    const map: NotionPropertyMap = { title_prop: "Name" };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "X" }] },
    });
    const res = mapNotionPageToInternalProject(page, map, makeCtx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.notion_page_id).toBe("page-1");
    expect(res.payload.notion_database_id).toBe(DB);
    expect(res.payload.notion_workspace_id).toBe(WS);
    expect(res.payload.notion_synced_at).toBe(NOW);
  });
});
