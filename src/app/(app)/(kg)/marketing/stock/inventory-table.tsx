"use client";

import { useState } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { KgDetailDrawer, type DetailField } from "@/components/kg/detail-drawer";
import { StatusPill } from "@/components/kg/status-pill";
import {
  ASSET_STOCK_STATE_LABEL,
  ASSET_STOCK_STATE_TONE,
  FORMAT_LABEL,
  type MarketingFormat,
} from "@/lib/marketing/types";
import type { AssetStockState } from "@/lib/marketing/stock";

/** Fila del inventario individual (panel "Contenido producido"). */
export interface AssetInventoryRow {
  readonly id: string;
  readonly name: string;
  readonly ownerName: string;
  readonly contentOwnerId: string;
  readonly format: MarketingFormat;
  readonly state: AssetStockState;
  readonly createdAt: string;
  readonly driveAssetUrl: string | null;
  readonly sourceContentEditId: string | null;
  /** Otros archivos que salieron de la misma edición (excluyéndose a sí mismo). */
  readonly siblings: readonly { readonly id: string; readonly name: string }[];
}

// ═══════════════════════════════════════════════════════════════════════════
// InventoryTable — un corte por fila con su estado frente al stock.
//
// Es la lectura que pide el procedimiento: todo lo que salió de producción,
// qué está libre para agendar, qué ya quedó reservado por una subida
// planificada y qué se consumió. Color sólo en el StatusPill, nunca en el
// texto (regla del proyecto).
//
// Click en la fila abre un detalle de solo lectura (no hay drawer de edición
// para content_assets sueltos — se cargan desde /marketing/edicion al cerrar
// una edición) con el link a Drive del archivo y cuántos otros archivos
// salieron de la misma edición, para no tener que adivinar si "esto es todo
// lo que hay" cuando una edición produjo varios cortes.
// ═══════════════════════════════════════════════════════════════════════════

export function InventoryTable({
  rows,
}: {
  readonly rows: readonly AssetInventoryRow[];
}) {
  const [viewingId, setViewingId] = useState<string | null>(null);

  const viewing =
    viewingId != null ? rows.find((r) => r.id === viewingId) ?? null : null;

  const viewingFields: readonly DetailField[] =
    viewing != null
      ? [
          { label: "Dueño", value: viewing.ownerName },
          { label: "Formato", value: FORMAT_LABEL[viewing.format] },
          {
            label: "Estado",
            value: (
              <StatusPill
                text={ASSET_STOCK_STATE_LABEL[viewing.state]}
                tone={ASSET_STOCK_STATE_TONE[viewing.state]}
              />
            ),
          },
          {
            label: "Archivo (Drive)",
            value: viewing.driveAssetUrl ? (
              <a
                href={viewing.driveAssetUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--kg-accent-text)", textDecoration: "none" }}
              >
                Abrir ↗
              </a>
            ) : null,
          },
          {
            label: "Otros archivos de la misma edición",
            value:
              viewing.siblings.length === 0
                ? "Ninguno — este fue el único archivo que salió de esa edición."
                : viewing.siblings.map((s) => s.name).join(", "),
          },
        ]
      : [];

  const columns: Column<AssetInventoryRow>[] = [
    {
      key: "name",
      label: "Corte",
      render: (r) => (
        <span style={{ color: "var(--kg-text-1)", fontWeight: 600 }}>
          {r.name}
        </span>
      ),
    },
    {
      key: "owner",
      label: "Dueño",
      render: (r) => r.ownerName,
    },
    {
      key: "format",
      label: "Formato",
      render: (r) => FORMAT_LABEL[r.format],
    },
    {
      key: "state",
      label: "Estado",
      render: (r) => (
        <StatusPill
          text={ASSET_STOCK_STATE_LABEL[r.state]}
          tone={ASSET_STOCK_STATE_TONE[r.state]}
        />
      ),
    },
  ];

  return (
    <>
      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={rows.length}
        emptyTitle="Sin contenido producido"
        emptyHint="Los cortes aparecen acá después de registrar la producción de una grabación realizada, en /marketing/edicion."
        onRowClick={(r) => setViewingId(r.id)}
      />

      <KgDetailDrawer
        open={viewing != null}
        onClose={() => setViewingId(null)}
        title={viewing?.name ?? ""}
        subtitle={viewing?.ownerName}
        fields={viewingFields}
      />
    </>
  );
}
