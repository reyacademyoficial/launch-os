"use client";

import { useMemo, useState, useTransition } from "react";

import type { NotionDatabaseSchema } from "@/lib/notion/client";
import {
  KG_PRIORITIES,
  KG_STATUSES,
  type KgPriority,
  type KgStatus,
  type NotionPropertyMap,
} from "@/lib/notion/property-map";

import { saveNotionDatabaseMapping } from "../../../actions";

/**
 * Form de configuración de mapeo Notion → internal_projects para una DB.
 *
 * ESTRUCTURA
 *   - Dropdowns "cuál columna es X" filtradas por type esperado:
 *     · title_prop: type='title' (siempre existe una y solo una en cada DB)
 *     · status_prop: 'select' | 'status' | 'multi_select' | 'formula' | 'rollup'
 *     · done_prop: 'checkbox' | 'formula' — el tilde de "terminado"
 *     · priority_prop: igual que status
 *     · assignee_prop (+ extras): 'people' y también 'multi_select', 'select',
 *       'rich_text', 'created_by'/'last_edited_by', 'formula', 'rollup'
 *     · due/start_prop: type='date'
 *     · description_prop: type='rich_text'
 *   - Cuando se elige un status_prop o priority_prop, aparecen los options
 *     de esa columna con un dropdown al lado para elegir el KG value.
 *   - Al submit se guarda con `saveNotionDatabaseMapping`; feedback OK/error.
 *
 * POR QUÉ TANTOS TIPOS
 *   Cada equipo arma su tablero distinto: unos marcan "Listo" con un select,
 *   otros con un tilde; unos ponen al responsable en una columna `people`,
 *   otros en un multi_select con nombres. Antes solo contemplábamos el primer
 *   caso de cada par y los otros tableros llegaban a KG sin estado ni dueños.
 */
export function MappingForm({
  databaseId,
  schema,
  initialMap,
}: {
  readonly databaseId: string;
  readonly schema: NotionDatabaseSchema;
  readonly initialMap: NotionPropertyMap | null;
}) {
  // Índice por type para filtrar los dropdowns.
  const propsByType = useMemo(() => {
    const map: Record<string, ReadonlyArray<NotionDatabaseSchema["properties"][number]>> =
      {};
    for (const p of schema.properties) {
      const list = map[p.type] ?? [];
      map[p.type] = [...list, p];
    }
    return map;
  }, [schema]);

  const of = (...types: string[]) =>
    types.flatMap((t) => propsByType[t] ?? []);

  const titleProps = of("title");
  // Aceptamos multi_select/formula/rollup además de select/status: hay
  // tableros que derivan el estado por fórmula o lo taggean.
  const selectishProps = of("select", "status", "multi_select", "formula", "rollup");
  // El schema de Notion no dice a qué tipo resuelve una formula, así que las
  // ofrecemos también acá; si no resuelve a booleano el parser devuelve null
  // y el estado cae al select.
  const checkboxProps = of("checkbox", "formula", "rollup");
  const assigneeCandidates = of(
    "people",
    "multi_select",
    "select",
    "rich_text",
    "created_by",
    "last_edited_by",
    "email",
    "formula",
    "rollup",
  );
  const dateProps = of("date");
  const richTextProps = of("rich_text");

  const defaultTitle =
    initialMap?.title_prop ?? titleProps[0]?.name ?? "";

  // ─── State del form ──────────────────────────────────────────────────
  const [titleProp, setTitleProp] = useState<string>(defaultTitle);
  const [statusProp, setStatusProp] = useState<string>(
    initialMap?.status_prop ?? "",
  );
  const [statusMap, setStatusMap] = useState<Record<string, KgStatus>>(
    initialMap?.status_map ?? {},
  );
  const [priorityProp, setPriorityProp] = useState<string>(
    initialMap?.priority_prop ?? "",
  );
  const [priorityMap, setPriorityMap] = useState<Record<string, KgPriority>>(
    initialMap?.priority_map ?? {},
  );
  const [doneProp, setDoneProp] = useState<string>(initialMap?.done_prop ?? "");
  const [doneStatus, setDoneStatus] = useState<KgStatus>(
    initialMap?.done_status ?? "listo",
  );
  const [undoneStatus, setUndoneStatus] = useState<KgStatus>(
    initialMap?.undone_status ?? "sin_empezar",
  );
  const [assigneeProp, setAssigneeProp] = useState<string>(
    initialMap?.assignee_prop ?? "",
  );
  const [extraAssignees, setExtraAssignees] = useState<readonly string[]>(
    initialMap?.assignee_props ?? [],
  );
  const [writeBack, setWriteBack] = useState<boolean>(
    initialMap?.write_back !== false,
  );
  const [dueProp, setDueProp] = useState<string>(initialMap?.due_prop ?? "");
  const [startProp, setStartProp] = useState<string>(
    initialMap?.start_prop ?? "",
  );
  const [descriptionProp, setDescriptionProp] = useState<string>(
    initialMap?.description_prop ?? "",
  );

  const [pending, startAction] = useTransition();
  const [message, setMessage] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);

  const statusOptions =
    selectishProps.find((p) => p.name === statusProp)?.options ?? [];
  const priorityOptions =
    selectishProps.find((p) => p.name === priorityProp)?.options ?? [];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!titleProp) {
      setMessage({ kind: "error", text: "Elegí la columna de título." });
      return;
    }
    const extras = extraAssignees.filter((p) => p && p !== assigneeProp);
    const map: NotionPropertyMap = {
      title_prop: titleProp,
      status_prop: statusProp || undefined,
      status_map:
        statusProp && Object.keys(statusMap).length > 0 ? statusMap : undefined,
      done_prop: doneProp || undefined,
      done_status: doneProp ? doneStatus : undefined,
      undone_status: doneProp ? undoneStatus : undefined,
      priority_prop: priorityProp || undefined,
      priority_map:
        priorityProp && Object.keys(priorityMap).length > 0
          ? priorityMap
          : undefined,
      assignee_prop: assigneeProp || undefined,
      assignee_props: extras.length > 0 ? extras : undefined,
      due_prop: dueProp || undefined,
      start_prop: startProp || undefined,
      description_prop: descriptionProp || undefined,
      write_back: writeBack,
    };
    startAction(async () => {
      const res = await saveNotionDatabaseMapping(databaseId, map);
      if (res.ok) {
        setMessage({ kind: "ok", text: "Mapping guardado." });
      } else {
        setMessage({ kind: "error", text: res.error });
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        padding: 18,
        borderRadius: "var(--kg-r-12)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
      }}
    >
      <PropField
        label="Columna de título"
        required
        value={titleProp}
        options={titleProps.map((p) => p.name)}
        onChange={setTitleProp}
        hint="Notion siempre tiene UNA columna type='title' — es el nombre del page."
      />

      <PropField
        label="Columna de status (opcional)"
        value={statusProp}
        options={selectishProps.map((p) => p.name)}
        onChange={(v) => {
          setStatusProp(v);
          // Al cambiar de columna, reset del map — los options son distintos.
          setStatusMap({});
        }}
        hint="Columnas select, status, multi_select, formula o rollup. Si el tablero marca lo terminado con un tilde en vez de un estado, dejá esto vacío y usá el campo de abajo."
      />
      {statusProp && statusOptions.length > 0 && (
        <ValueMappingBlock
          title="Mapear valores de status Notion → KG"
          hint="Valores en Notion sin mapear caen en 'sin_empezar' al sincronizar."
          notionOptions={statusOptions.map((o) => o.name)}
          kgValues={KG_STATUSES}
          currentMap={statusMap}
          onChange={(nv, kg) => {
            setStatusMap((prev) => {
              const next = { ...prev };
              if (kg == null) delete next[nv];
              else next[nv] = kg as KgStatus;
              return next;
            });
          }}
        />
      )}

      <PropField
        label="Columna de tilde &quot;listo&quot; (opcional)"
        value={doneProp}
        options={checkboxProps.map((p) => p.name)}
        onChange={setDoneProp}
        hint="Para los tableros que marcan lo terminado con un checkbox en vez de un estado 'Listo'. Cuando está configurada, el tilde manda sobre la columna de status."
      />
      {doneProp && (
        <div
          style={{
            padding: 12,
            borderRadius: "var(--kg-r-8)",
            background: "var(--kg-bg-base)",
            border: "1px solid var(--kg-border-subtle)",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          <div>
            <label style={labelStyle}>Tildado →</label>
            <select
              value={doneStatus}
              onChange={(e) => setDoneStatus(e.target.value as KgStatus)}
              style={selectStyle}
            >
              {KG_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Sin tildar →</label>
            <select
              value={undoneStatus}
              onChange={(e) => setUndoneStatus(e.target.value as KgStatus)}
              style={selectStyle}
            >
              {KG_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <div style={{ ...hintStyle, marginTop: 4 }}>
              Si además hay columna de status, sin tildar se usa ese valor
              (salvo que también diga &quot;listo&quot;).
            </div>
          </div>
        </div>
      )}

      <PropField
        label="Columna de prioridad (opcional)"
        value={priorityProp}
        options={selectishProps.map((p) => p.name)}
        onChange={(v) => {
          setPriorityProp(v);
          setPriorityMap({});
        }}
        hint="Solo se aceptan columnas type='select' o type='status'."
      />
      {priorityProp && priorityOptions.length > 0 && (
        <ValueMappingBlock
          title="Mapear valores de prioridad Notion → KG"
          hint="Valores sin mapear caen en 'media'."
          notionOptions={priorityOptions.map((o) => o.name)}
          kgValues={KG_PRIORITIES}
          currentMap={priorityMap}
          onChange={(nv, kg) => {
            setPriorityMap((prev) => {
              const next = { ...prev };
              if (kg == null) delete next[nv];
              else next[nv] = kg as KgPriority;
              return next;
            });
          }}
        />
      )}

      <PropField
        label="Columna de responsables (opcional)"
        value={assigneeProp}
        options={assigneeCandidates.map((p) => p.name)}
        onChange={(v) => {
          setAssigneeProp(v);
          setExtraAssignees((prev) => prev.filter((p) => p !== v));
        }}
        hint="No hace falta que sea type='people': también leemos multi_select y select (por nombre), texto con @menciones, created_by y fórmulas. Los nombres se cruzan contra los usuarios de Notion mapeados y contra las personas de la organización. Las columnas 'relation' no se pueden resolver."
      />

      {assigneeProp && assigneeCandidates.length > 1 && (
        <div
          style={{
            padding: 12,
            borderRadius: "var(--kg-r-8)",
            background: "var(--kg-bg-base)",
            border: "1px solid var(--kg-border-subtle)",
          }}
        >
          <div style={labelStyle}>Columnas de responsables adicionales</div>
          <div className="kg-t7" style={{ ...hintStyle, marginBottom: 8 }}>
            Para los tableros que parten el dato (ej: &quot;Responsable&quot; +
            &quot;Apoyo&quot;). Se juntan todas y se dedupean.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {assigneeCandidates
              .filter((p) => p.name !== assigneeProp)
              .map((p) => (
                <label
                  key={p.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    color: "var(--kg-text-2)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={extraAssignees.includes(p.name)}
                    onChange={(e) =>
                      setExtraAssignees((prev) =>
                        e.target.checked
                          ? [...prev, p.name]
                          : prev.filter((x) => x !== p.name),
                      )
                    }
                  />
                  {p.name}
                  <span style={{ color: "var(--kg-text-3)" }}>({p.type})</span>
                </label>
              ))}
          </div>
        </div>
      )}

      <PropField
        label="Columna de vencimiento (opcional)"
        value={dueProp}
        options={dateProps.map((p) => p.name)}
        onChange={setDueProp}
      />

      <PropField
        label="Columna de fecha de inicio (opcional)"
        value={startProp}
        options={dateProps.map((p) => p.name)}
        onChange={setStartProp}
      />

      <PropField
        label="Columna de descripción (opcional)"
        value={descriptionProp}
        options={richTextProps.map((p) => p.name)}
        onChange={setDescriptionProp}
        hint="Solo columnas type='rich_text'. El body del page (blocks) todavía no se importa."
      />

      <div
        style={{
          padding: 12,
          borderRadius: "var(--kg-r-8)",
          background: "var(--kg-bg-base)",
          border: "1px solid var(--kg-border-subtle)",
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={writeBack}
            onChange={(e) => setWriteBack(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>
            <span style={{ color: "var(--kg-text-1)", fontSize: 13 }}>
              Escribir los cambios de KG en Notion
            </span>
            <span className="kg-t7" style={{ ...hintStyle, display: "block" }}>
              Recomendado. Cuando alguien marca un proyecto como listo en KG, el
              cambio se escribe en la page de Notion; sin esto el próximo sync lo
              revierte. Requiere que la integration tenga la capability
              &quot;Update content&quot; en Notion.
            </span>
          </span>
        </label>
      </div>

      {message && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "var(--kg-r-8)",
            background:
              message.kind === "ok"
                ? "rgba(0,208,132,0.10)"
                : "rgba(239,68,68,0.10)",
            border: `1px solid ${message.kind === "ok" ? "#00D084" : "#EF4444"}`,
            color: message.kind === "ok" ? "#00D084" : "#EF4444",
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          {message.text}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="submit"
          disabled={pending || !titleProp}
          className="kg-focus"
          style={primaryBtn}
        >
          {pending ? "Guardando…" : "Guardar mapeo"}
        </button>
      </div>
    </form>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-componentes
// ═══════════════════════════════════════════════════════════════════════════

function PropField({
  label,
  required,
  value,
  options,
  onChange,
  hint,
}: {
  readonly label: string;
  readonly required?: boolean;
  readonly value: string;
  readonly options: readonly string[];
  readonly onChange: (v: string) => void;
  readonly hint?: string;
}) {
  return (
    <div>
      <label style={labelStyle}>
        {label}
        {required && <span style={{ color: "#EF4444" }}> *</span>}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={selectStyle}
      >
        <option value="">— No usar —</option>
        {options.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      {hint && (
        <div style={{ ...hintStyle, marginTop: 4 }} className="kg-t7">
          {hint}
        </div>
      )}
      {options.length === 0 && (
        <div
          style={{
            ...hintStyle,
            color: "#FFB800",
            marginTop: 4,
          }}
        >
          Esta database no tiene columnas del tipo esperado.
        </div>
      )}
    </div>
  );
}

function ValueMappingBlock({
  title,
  hint,
  notionOptions,
  kgValues,
  currentMap,
  onChange,
}: {
  readonly title: string;
  readonly hint: string;
  readonly notionOptions: readonly string[];
  readonly kgValues: readonly string[];
  readonly currentMap: Readonly<Record<string, string>>;
  readonly onChange: (notionValue: string, kgValue: string | null) => void;
}) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: "var(--kg-r-8)",
        background: "var(--kg-bg-base)",
        border: "1px solid var(--kg-border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div>
        <div style={{ ...labelStyle, marginBottom: 2 }}>{title}</div>
        <div className="kg-t7" style={hintStyle}>
          {hint}
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          gap: 8,
          alignItems: "center",
        }}
      >
        {notionOptions.map((nv) => (
          <ValueRow
            key={nv}
            notionValue={nv}
            kgValue={currentMap[nv] ?? null}
            kgValues={kgValues}
            onChange={(kg) => onChange(nv, kg)}
          />
        ))}
      </div>
    </div>
  );
}

function ValueRow({
  notionValue,
  kgValue,
  kgValues,
  onChange,
}: {
  readonly notionValue: string;
  readonly kgValue: string | null;
  readonly kgValues: readonly string[];
  readonly onChange: (v: string | null) => void;
}) {
  return (
    <>
      <span style={{ color: "var(--kg-text-2)", fontSize: 12 }}>{notionValue}</span>
      <span style={{ color: "var(--kg-text-3)", fontSize: 12 }}>→</span>
      <select
        value={kgValue ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        style={{ ...selectStyle, padding: "6px 10px", fontSize: 12 }}
      >
        <option value="">— Sin mapear —</option>
        {kgValues.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  color: "var(--kg-text-3)",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.3,
  marginBottom: 5,
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-bg-base)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 13,
  fontFamily: "inherit",
};

const hintStyle: React.CSSProperties = {
  color: "var(--kg-text-3)",
  fontSize: 11,
  lineHeight: 1.5,
};

const primaryBtn: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 999,
  background: "var(--kg-accent-500)",
  border: "none",
  color: "#fff",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};
