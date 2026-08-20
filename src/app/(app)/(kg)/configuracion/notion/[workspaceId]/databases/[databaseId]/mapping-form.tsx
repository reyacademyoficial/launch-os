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
 *     · status_prop: type='select' o 'status'
 *     · priority_prop: type='select' o 'status'
 *     · assignee_prop: type='people'
 *     · due/start_prop: type='date'
 *     · description_prop: type='rich_text'
 *   - Cuando se elige un status_prop o priority_prop, aparecen los options
 *     de esa columna con un dropdown al lado para elegir el KG value.
 *   - Al submit se guarda con `saveNotionDatabaseMapping`; feedback OK/error.
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

  const titleProps = propsByType["title"] ?? [];
  const selectishProps = [
    ...(propsByType["select"] ?? []),
    ...(propsByType["status"] ?? []),
  ];
  const peopleProps = propsByType["people"] ?? [];
  const dateProps = propsByType["date"] ?? [];
  const richTextProps = propsByType["rich_text"] ?? [];

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
  const [assigneeProp, setAssigneeProp] = useState<string>(
    initialMap?.assignee_prop ?? "",
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
    const map: NotionPropertyMap = {
      title_prop: titleProp,
      status_prop: statusProp || undefined,
      status_map:
        statusProp && Object.keys(statusMap).length > 0 ? statusMap : undefined,
      priority_prop: priorityProp || undefined,
      priority_map:
        priorityProp && Object.keys(priorityMap).length > 0
          ? priorityMap
          : undefined,
      assignee_prop: assigneeProp || undefined,
      due_prop: dueProp || undefined,
      start_prop: startProp || undefined,
      description_prop: descriptionProp || undefined,
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
        hint="Solo se aceptan columnas type='select' o type='status'."
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
        label="Columna de assignee/owner (opcional)"
        value={assigneeProp}
        options={peopleProps.map((p) => p.name)}
        onChange={setAssigneeProp}
        hint="Tomamos el primer people mapeado a una persona KG. El resto se ignora."
      />

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
