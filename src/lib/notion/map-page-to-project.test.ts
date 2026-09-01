import { describe, expect, it } from "vitest";

import type { NotionPage } from "./client";
import {
  mapNotionPageToInternalProject,
  resolveStatus,
  type MapContext,
} from "./map-page-to-project";
import type { NotionPropertyMap } from "./property-map";

const NOW = "2026-08-18T15:00:00.000Z";
const ORG = "org-1";
const WS = "ws-1";
const DB = "db-1";

function makeCtx(
  assigneeMap: Record<string, string | null> = {},
  labelMap?: Record<string, string | null>,
): MapContext {
  return {
    organizationId: ORG,
    workspaceId: WS,
    databaseId: DB,
    assigneeToKgPerson: (nu) => assigneeMap[nu] ?? null,
    assigneeLabelToKgPerson: labelMap
      ? (label) => labelMap[label.toLowerCase()] ?? null
      : undefined,
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

// ═══════════════════════════════════════════════════════════════════════════
// Tableros con checkbox en vez de estado "Listo" (0176)
// ═══════════════════════════════════════════════════════════════════════════

describe("resolveStatus — tableros con tilde de 'listo'", () => {
  it("checkbox tildado → listo, aunque no haya columna de status", () => {
    const map: NotionPropertyMap = { title_prop: "Name", done_prop: "Hecho" };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "X" }] },
      Hecho: { type: "checkbox", checkbox: true },
    });
    expect(resolveStatus(page, map)).toBe("listo");
  });

  it("checkbox destildado → sin_empezar por default", () => {
    const map: NotionPropertyMap = { title_prop: "Name", done_prop: "Hecho" };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "X" }] },
      Hecho: { type: "checkbox", checkbox: false },
    });
    expect(resolveStatus(page, map)).toBe("sin_empezar");
  });

  it("checkbox destildado respeta el estado del select cuando no es 'listo'", () => {
    const map: NotionPropertyMap = {
      title_prop: "Name",
      status_prop: "Estado",
      status_map: { "En curso": "en_proceso" },
      done_prop: "Hecho",
    };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "X" }] },
      Estado: { type: "select", select: { name: "En curso" } },
      Hecho: { type: "checkbox", checkbox: false },
    });
    expect(resolveStatus(page, map)).toBe("en_proceso");
  });

  it("checkbox destildado gana sobre un select que dice 'listo' (contradicción)", () => {
    const map: NotionPropertyMap = {
      title_prop: "Name",
      status_prop: "Estado",
      status_map: { Terminado: "listo" },
      done_prop: "Hecho",
      undone_status: "en_proceso",
    };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "X" }] },
      Estado: { type: "select", select: { name: "Terminado" } },
      Hecho: { type: "checkbox", checkbox: false },
    });
    expect(resolveStatus(page, map)).toBe("en_proceso");
  });

  it("done_prop configurado pero ausente en la page → cae al select, no inventa 'listo'", () => {
    const map: NotionPropertyMap = {
      title_prop: "Name",
      status_prop: "Estado",
      status_map: { Bloqueado: "bloqueado" },
      done_prop: "Hecho",
    };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "X" }] },
      Estado: { type: "select", select: { name: "Bloqueado" } },
    });
    expect(resolveStatus(page, map)).toBe("bloqueado");
  });

  it("formula de tipo checkbox también sirve como tilde", () => {
    const map: NotionPropertyMap = { title_prop: "Name", done_prop: "Completa" };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "X" }] },
      Completa: { type: "formula", formula: { type: "boolean", boolean: true } },
    });
    expect(resolveStatus(page, map)).toBe("listo");
  });

  it("estado en multi_select se resuelve por auto-normalización", () => {
    const map: NotionPropertyMap = { title_prop: "Name", status_prop: "Tags" };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "X" }] },
      Tags: { type: "multi_select", multi_select: [{ name: "En proceso" }] },
    });
    expect(resolveStatus(page, map)).toBe("en_proceso");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Responsables en columnas que no son type='people' (0176)
// ═══════════════════════════════════════════════════════════════════════════

describe("mapNotionPageToInternalProject — responsables multi-tipo", () => {
  it("multi_select con nombres resuelve vía el índice de etiquetas", () => {
    const map: NotionPropertyMap = {
      title_prop: "Name",
      assignee_prop: "Equipo",
    };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "X" }] },
      Equipo: {
        type: "multi_select",
        multi_select: [{ name: "Ana Gómez" }, { name: "Luis" }],
      },
    });
    const res = mapNotionPageToInternalProject(
      page,
      map,
      makeCtx({}, { "ana gómez": "kg-ana", luis: "kg-luis" }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.ownerIds).toEqual(["kg-ana", "kg-luis"]);
  });

  it("texto libre con separadores y @menciones", () => {
    const map: NotionPropertyMap = {
      title_prop: "Name",
      assignee_prop: "Responsable",
    };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "X" }] },
      Responsable: {
        type: "rich_text",
        rich_text: [
          {
            type: "mention",
            plain_text: "@Ana",
            mention: { type: "user", user: { id: "nu-ana" } },
          },
          { type: "text", plain_text: ", Luis / Pedro" },
        ],
      },
    });
    const res = mapNotionPageToInternalProject(
      page,
      map,
      makeCtx({ "nu-ana": "kg-ana" }, { luis: "kg-luis", pedro: "kg-pedro" }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.ownerIds).toEqual(["kg-ana", "kg-luis", "kg-pedro"]);
  });

  it("junta varias columnas de responsables y dedupea", () => {
    const map: NotionPropertyMap = {
      title_prop: "Name",
      assignee_prop: "Owner",
      assignee_props: ["Apoyo"],
    };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "X" }] },
      Owner: { type: "people", people: [{ id: "nu-ana" }] },
      Apoyo: { type: "multi_select", multi_select: [{ name: "Ana" }, { name: "Luis" }] },
    });
    const res = mapNotionPageToInternalProject(
      page,
      map,
      makeCtx({ "nu-ana": "kg-ana" }, { ana: "kg-ana", luis: "kg-luis" }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.ownerIds).toEqual(["kg-ana", "kg-luis"]);
  });

  it("sin resolver de etiquetas, una columna de texto no aporta dueños", () => {
    const map: NotionPropertyMap = {
      title_prop: "Name",
      assignee_prop: "Responsable",
    };
    const page = makePage({
      Name: { type: "title", title: [{ plain_text: "X" }] },
      Responsable: { type: "select", select: { name: "Ana" } },
    });
    const res = mapNotionPageToInternalProject(page, map, makeCtx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.ownerIds).toEqual([]);
  });
});
