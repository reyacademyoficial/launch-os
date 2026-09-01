import { describe, expect, it } from "vitest";

import type { NotionDatabaseSchema } from "./client";
import type { NotionPropertyMap } from "./property-map";
import { buildNotionPatch, reverseLookup } from "./push-project";

/**
 * Tests del write-back KG → Notion (0176). Solo la parte pura: armar el body
 * `properties` del PATCH y traducir un valor KG a la etiqueta de Notion.
 */

function schema(
  props: Array<{ name: string; type: string; options?: string[] }>,
): NotionDatabaseSchema {
  return {
    id: "db-1",
    title_plain: "Tablero",
    properties: props.map((p) => ({
      name: p.name,
      type: p.type,
      options: (p.options ?? []).map((name) => ({ name })),
    })),
  };
}

const baseValues = {
  name: "Rediseño roadmap",
  description: "Detalle",
  status: "listo" as const,
  priority: "alta" as const,
  startsOn: "2026-08-01",
  dueOn: "2026-09-01",
  ownerNotionUserIds: [] as string[],
};

describe("reverseLookup", () => {
  it("invierte el map explícito del operador", () => {
    expect(
      reverseLookup("listo", { Terminado: "listo", Curso: "en_proceso" }, [
        "Terminado",
        "Curso",
      ]),
    ).toBe("Terminado");
  });

  it("auto-match contra las opciones reales cuando no hay map", () => {
    expect(reverseLookup("alerta_maxima", {}, ["Alerta Máxima", "Normal"])).toBe(
      "Alerta Máxima",
    );
  });

  it("prefiere una opción que exista de verdad antes que un mapeo viejo", () => {
    expect(
      reverseLookup("listo", { Viejo: "listo" }, ["Listo", "En proceso"]),
    ).toBe("Listo");
  });

  it("usa el mapeo explícito aunque la opción no figure en el schema leído", () => {
    expect(reverseLookup("listo", { Terminado: "listo" }, ["Otra"])).toBe(
      "Terminado",
    );
  });

  it("null cuando no hay forma de traducirlo", () => {
    expect(reverseLookup("bloqueado", {}, ["A", "B"])).toBeNull();
  });
});

describe("buildNotionPatch", () => {
  it("escribe título, descripción, status, prioridad y fechas", () => {
    const map: NotionPropertyMap = {
      title_prop: "Name",
      status_prop: "Estado",
      status_map: { Terminado: "listo" },
      priority_prop: "Prioridad",
      priority_map: { Alta: "alta" },
      due_prop: "Vence",
      start_prop: "Inicio",
      description_prop: "Detalle",
    };
    const patch = buildNotionPatch(
      baseValues,
      map,
      schema([
        { name: "Name", type: "title" },
        { name: "Estado", type: "status", options: ["Terminado", "En curso"] },
        { name: "Prioridad", type: "select", options: ["Alta", "Baja"] },
        { name: "Vence", type: "date" },
        { name: "Inicio", type: "date" },
        { name: "Detalle", type: "rich_text" },
      ]),
    );

    expect(patch).toEqual({
      Name: { title: [{ type: "text", text: { content: "Rediseño roadmap" } }] },
      Estado: { status: { name: "Terminado" } },
      Prioridad: { select: { name: "Alta" } },
      Vence: { date: { start: "2026-09-01" } },
      Inicio: { date: { start: "2026-08-01" } },
      Detalle: { rich_text: [{ type: "text", text: { content: "Detalle" } }] },
    });
  });

  it("tilda el checkbox cuando el proyecto está listo y lo destilda si no", () => {
    const map: NotionPropertyMap = { title_prop: "Name", done_prop: "Hecho" };
    const s = schema([
      { name: "Name", type: "title" },
      { name: "Hecho", type: "checkbox" },
    ]);

    expect(buildNotionPatch(baseValues, map, s).Hecho).toEqual({
      checkbox: true,
    });
    expect(
      buildNotionPatch({ ...baseValues, status: "en_proceso" }, map, s).Hecho,
    ).toEqual({ checkbox: false });
  });

  it("no toca columnas read-only (formula / rollup) ni las que ya no existen", () => {
    const map: NotionPropertyMap = {
      title_prop: "Name",
      status_prop: "Calculado",
      done_prop: "FormulaHecho",
      due_prop: "ColumnaBorrada",
    };
    const patch = buildNotionPatch(
      baseValues,
      map,
      schema([
        { name: "Name", type: "title" },
        { name: "Calculado", type: "formula" },
        { name: "FormulaHecho", type: "formula" },
      ]),
    );
    expect(Object.keys(patch)).toEqual(["Name"]);
  });

  it("omite el status en vez de mandar basura cuando no hay opción equivalente", () => {
    const map: NotionPropertyMap = { title_prop: "Name", status_prop: "Estado" };
    const patch = buildNotionPatch(
      baseValues,
      map,
      schema([
        { name: "Name", type: "title" },
        { name: "Estado", type: "select", options: ["Nope", "Nada"] },
      ]),
    );
    expect(patch.Estado).toBeUndefined();
  });

  it("limpia la fecha cuando el proyecto no tiene vencimiento", () => {
    const map: NotionPropertyMap = { title_prop: "Name", due_prop: "Vence" };
    const patch = buildNotionPatch(
      { ...baseValues, dueOn: null },
      map,
      schema([
        { name: "Name", type: "title" },
        { name: "Vence", type: "date" },
      ]),
    );
    expect(patch.Vence).toEqual({ date: null });
  });

  it("escribe responsables solo en columnas people", () => {
    const map: NotionPropertyMap = {
      title_prop: "Name",
      assignee_prop: "Owner",
      assignee_props: ["Equipo"],
    };
    const patch = buildNotionPatch(
      { ...baseValues, ownerNotionUserIds: ["nu-1", "nu-2"] },
      map,
      schema([
        { name: "Name", type: "title" },
        { name: "Owner", type: "people" },
        { name: "Equipo", type: "multi_select", options: ["Ana"] },
      ]),
    );
    expect(patch.Owner).toEqual({
      people: [
        { object: "user", id: "nu-1" },
        { object: "user", id: "nu-2" },
      ],
    });
    // multi_select con nombres se LEE pero no se escribe: crear opciones en
    // el tablero de otro equipo sería demasiado invasivo.
    expect(patch.Equipo).toBeUndefined();
  });

  it("vacía la columna people cuando el proyecto se queda sin responsables", () => {
    const map: NotionPropertyMap = { title_prop: "Name", assignee_prop: "Owner" };
    const patch = buildNotionPatch(
      baseValues,
      map,
      schema([
        { name: "Name", type: "title" },
        { name: "Owner", type: "people" },
      ]),
    );
    expect(patch.Owner).toEqual({ people: [] });
  });

  it("descripción vacía se escribe como rich_text vacío, no como null", () => {
    const map: NotionPropertyMap = {
      title_prop: "Name",
      description_prop: "Detalle",
    };
    const patch = buildNotionPatch(
      { ...baseValues, description: null },
      map,
      schema([
        { name: "Name", type: "title" },
        { name: "Detalle", type: "rich_text" },
      ]),
    );
    expect(patch.Detalle).toEqual({ rich_text: [] });
  });
});
