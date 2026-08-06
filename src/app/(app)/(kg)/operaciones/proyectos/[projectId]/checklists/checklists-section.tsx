"use client";

import { useState, useTransition } from "react";

import { EmptyState } from "@/components/kg/empty-state";

import {
  addChecklistItem,
  createProjectChecklist,
  deleteChecklist,
  deleteChecklistItem,
  renameChecklist,
  toggleChecklistItem,
} from "./actions";

export interface ChecklistItemData {
  readonly id: string;
  readonly content: string;
  readonly done: boolean;
  readonly position: number;
}

export interface ChecklistData {
  readonly id: string;
  readonly title: string;
  readonly items: readonly ChecklistItemData[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Sección de checklists de un proyecto.
//
// Muestra las checklists directamente colgadas del internal_project (los
// que cuelgan de task viven en la ficha de la task, pendiente). Cada
// checklist tiene form inline para agregar items y toggle done por item.
// ═══════════════════════════════════════════════════════════════════════════

export function ChecklistsSection({
  projectId,
  checklists,
}: {
  readonly projectId: string;
  readonly checklists: readonly ChecklistData[];
}) {
  const [newChecklistTitle, setNewChecklistTitle] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCreateChecklist() {
    const title = newChecklistTitle.trim();
    if (title.length === 0) {
      setError("El título es obligatorio.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("title", title);
    startTransition(async () => {
      const result = await createProjectChecklist(projectId, fd);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setNewChecklistTitle("");
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "var(--kg-r-8)",
            background: "rgba(239,68,68,0.10)",
            border: "1px solid #EF4444",
            color: "#EF4444",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {/* Form inline para nueva checklist */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 8,
        }}
      >
        <input
          type="text"
          value={newChecklistTitle}
          onChange={(e) => setNewChecklistTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleCreateChecklist();
            }
          }}
          disabled={pending}
          placeholder="Nombre de la checklist (ej. Hitos del rediseño)"
          style={inputStyle}
        />
        <button
          type="button"
          onClick={handleCreateChecklist}
          disabled={pending || newChecklistTitle.trim().length === 0}
          className="kg-focus"
          style={{
            ...primaryBtn,
            opacity:
              pending || newChecklistTitle.trim().length === 0 ? 0.6 : 1,
          }}
        >
          + Crear
        </button>
      </div>

      {checklists.length === 0 ? (
        <EmptyState
          title="Sin checklists"
          hint="Agregá una arriba para trackear hitos macro del proyecto. Los checklists más específicos de una tarea individual viven adentro de cada tarea."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {checklists.map((c) => (
            <ChecklistBlock key={c.id} checklist={c} projectId={projectId} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChecklistBlock({
  checklist,
  projectId: _projectId,
}: {
  readonly checklist: ChecklistData;
  readonly projectId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(checklist.title);
  const [newItemContent, setNewItemContent] = useState("");

  const doneCount = checklist.items.filter((i) => i.done).length;
  const totalCount = checklist.items.length;
  const progressPct =
    totalCount === 0 ? null : Math.round((doneCount / totalCount) * 100);

  function handleRename() {
    const t = titleDraft.trim();
    if (t.length === 0 || t === checklist.title) {
      setEditingTitle(false);
      setTitleDraft(checklist.title);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await renameChecklist(checklist.id, t);
      if ("error" in result) setError(result.error);
      setEditingTitle(false);
    });
  }

  function handleDelete() {
    const ok = window.confirm(
      `¿Eliminar la checklist "${checklist.title}"? Se pierden los ${totalCount} items.`,
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteChecklist(checklist.id);
      if ("error" in result) setError(result.error);
    });
  }

  function handleAddItem() {
    const c = newItemContent.trim();
    if (c.length === 0) return;
    setError(null);
    const fd = new FormData();
    fd.set("content", c);
    startTransition(async () => {
      const result = await addChecklistItem(checklist.id, fd);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setNewItemContent("");
    });
  }

  function handleToggleItem(itemId: string, currentDone: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await toggleChecklistItem(itemId, !currentDone);
      if ("error" in result) setError(result.error);
    });
  }

  function handleDeleteItem(itemId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteChecklistItem(itemId);
      if ("error" in result) setError(result.error);
    });
  }

  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: "var(--kg-r-8)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {error && (
        <div
          style={{
            padding: "8px 10px",
            borderRadius: "var(--kg-r-8)",
            background: "rgba(239,68,68,0.10)",
            border: "1px solid #EF4444",
            color: "#EF4444",
            fontSize: 11,
          }}
        >
          {error}
        </div>
      )}

      {/* Header: título editable + progreso + delete */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        {editingTitle ? (
          <input
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleRename();
              }
              if (e.key === "Escape") {
                setEditingTitle(false);
                setTitleDraft(checklist.title);
              }
            }}
            autoFocus
            disabled={pending}
            style={{ ...inputStyle, flex: 1 }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingTitle(true)}
            className="kg-focus"
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              color: "var(--kg-text-1)",
              fontSize: 13,
              fontWeight: 700,
              textAlign: "left",
              cursor: "pointer",
              flex: 1,
            }}
          >
            {checklist.title}
          </button>
        )}
        <div
          className="kg-t7"
          style={{
            color: "var(--kg-text-3)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {progressPct == null ? "sin items" : `${doneCount}/${totalCount} · ${progressPct}%`}
        </div>
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="kg-focus"
          style={{
            padding: "4px 10px",
            borderRadius: 999,
            background: "transparent",
            border: "1px solid #EF4444",
            color: "#EF4444",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Eliminar
        </button>
      </div>

      {/* Items */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {checklist.items.map((item) => (
          <div
            key={item.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "6px 8px",
              borderRadius: "var(--kg-r-8)",
            }}
          >
            <input
              type="checkbox"
              checked={item.done}
              onChange={() => handleToggleItem(item.id, item.done)}
              disabled={pending}
              style={{ cursor: "pointer", flexShrink: 0 }}
            />
            <span
              style={{
                flex: 1,
                color: item.done ? "var(--kg-text-3)" : "var(--kg-text-1)",
                fontSize: 13,
                textDecoration: item.done ? "line-through" : "none",
              }}
            >
              {item.content}
            </span>
            <button
              type="button"
              onClick={() => handleDeleteItem(item.id)}
              disabled={pending}
              aria-label="Eliminar item"
              className="kg-focus"
              style={{
                background: "transparent",
                border: "none",
                padding: 4,
                color: "var(--kg-text-3)",
                fontSize: 14,
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Form inline para nuevo item */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 8,
          marginTop: 4,
        }}
      >
        <input
          type="text"
          value={newItemContent}
          onChange={(e) => setNewItemContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAddItem();
            }
          }}
          disabled={pending}
          placeholder="+ Nuevo item"
          style={{ ...inputStyle, fontSize: 12 }}
        />
        <button
          type="button"
          onClick={handleAddItem}
          disabled={pending || newItemContent.trim().length === 0}
          className="kg-focus"
          style={{
            padding: "6px 12px",
            borderRadius: 999,
            background: "transparent",
            border: "1px solid var(--kg-border-subtle)",
            color: "var(--kg-text-2)",
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
            opacity:
              pending || newItemContent.trim().length === 0 ? 0.5 : 1,
          }}
        >
          Sumar
        </button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-1-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 13,
  colorScheme: "dark",
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
