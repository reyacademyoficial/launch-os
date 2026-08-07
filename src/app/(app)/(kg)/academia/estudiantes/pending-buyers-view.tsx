"use client";

import { useMemo, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";
import { EmptyState } from "@/components/kg/empty-state";
import { fMoney } from "@/lib/finance/format";

import {
  bulkCreateStudentsFromSales,
  type BulkFailure,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Vista "Compradores pendientes" — pestaña separada dentro de Estudiantes.
//
// Muestra los leads que compraron un producto-curso y NO están cargados
// como student. Checkbox por fila + botón "+ Marcar todos" + botón
// "Cargar seleccionados". Al confirmar, si TODOS los seleccionados
// corresponden al mismo curso (product_id), se ofrece inscribirlos en
// una cohort de ese curso en el mismo paso.
// ═══════════════════════════════════════════════════════════════════════════

export interface PendingBuyer {
  readonly saleId: string;
  readonly leadName: string;
  readonly leadEmail: string | null;
  readonly leadPhone: string | null;
  readonly productId: string;
  readonly productName: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly courseId: string | null;
  readonly amount: number;
  readonly currency: "ARS" | "USD";
  readonly createdAt: string;
}

export interface CohortOptionForBulk {
  readonly id: string;
  readonly courseId: string;
  readonly name: string;
  readonly status: "planned" | "active" | "finished" | "cancelled";
}

export function PendingBuyersView({
  buyers,
  cohortsByCourse,
}: {
  readonly buyers: readonly PendingBuyer[];
  readonly cohortsByCourse: Record<string, readonly CohortOptionForBulk[]>;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    createdCount: number;
    enrolledCount: number;
    failures: readonly BulkFailure[];
  } | null>(null);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === buyers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(buyers.map((b) => b.saleId)));
    }
  }

  const selectedBuyers = buyers.filter((b) => selectedIds.has(b.saleId));

  // ¿Todos los seleccionados son del mismo producto? Si sí, podemos
  // ofrecer inscribirlos en una cohort de ese curso.
  const singleProductId = useMemo(() => {
    if (selectedBuyers.length === 0) return null;
    const productIds = new Set(selectedBuyers.map((b) => b.productId));
    return productIds.size === 1 ? selectedBuyers[0]!.productId : null;
  }, [selectedBuyers]);

  const singleCourseId = useMemo(() => {
    if (selectedBuyers.length === 0) return null;
    const courseIds = new Set(
      selectedBuyers.map((b) => b.courseId).filter((v): v is string => v != null),
    );
    return courseIds.size === 1 ? selectedBuyers[0]!.courseId : null;
  }, [selectedBuyers]);

  const cohortsForBulk = singleCourseId
    ? cohortsByCourse[singleCourseId] ?? []
    : [];

  if (buyers.length === 0) {
    return (
      <EmptyState
        title="Sin compradores pendientes"
        hint="Los compradores de productos-curso aparecen acá cuando aún no están cargados como estudiantes. Si esperabas ver alguno, verificá que el producto de la venta esté asociado a un curso (Cursos → + Nuevo curso)."
      />
    );
  }

  const allSelected = selectedIds.size === buyers.length;
  const someSelected = selectedIds.size > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
          {buyers.length} comprador{buyers.length === 1 ? "" : "es"} pendiente
          {buyers.length === 1 ? "" : "s"}
          {someSelected && ` · ${selectedIds.size} seleccionado${selectedIds.size === 1 ? "" : "s"}`}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={toggleAll}
            disabled={pending}
            className="kg-focus"
            style={secondaryBtn}
          >
            {allSelected ? "Limpiar" : "Marcar todos"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={pending || !someSelected}
            className="kg-focus"
            style={{
              ...primaryBtn,
              opacity: !someSelected ? 0.5 : 1,
              cursor: !someSelected ? "not-allowed" : "pointer",
            }}
          >
            Cargar seleccionados ({selectedIds.size})
          </button>
        </div>
      </div>

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

      <div
        style={{
          overflowX: "auto",
          borderRadius: "var(--kg-r-8)",
          border: "1px solid var(--kg-border-subtle)",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
          }}
        >
          <thead>
            <tr
              style={{
                background: "var(--kg-surface-2-solid)",
                borderBottom: "1px solid var(--kg-border-subtle)",
              }}
            >
              <Th width={36}>&nbsp;</Th>
              <Th>Comprador</Th>
              <Th>Producto</Th>
              <Th>Proyecto</Th>
              <Th align="right">Monto</Th>
              <Th align="right">Fecha</Th>
            </tr>
          </thead>
          <tbody>
            {buyers.map((b, idx) => {
              const checked = selectedIds.has(b.saleId);
              return (
                <tr
                  key={b.saleId}
                  onClick={() => toggle(b.saleId)}
                  style={{
                    borderBottom:
                      idx === buyers.length - 1
                        ? "none"
                        : "1px solid var(--kg-border-subtle)",
                    background: checked
                      ? "rgba(34,197,94,0.06)"
                      : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <Td>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(b.saleId)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ cursor: "pointer" }}
                    />
                  </Td>
                  <Td>
                    <div
                      style={{
                        color: "var(--kg-text-1)",
                        fontWeight: 600,
                      }}
                    >
                      {b.leadName}
                    </div>
                    <div
                      className="kg-t7"
                      style={{
                        color: "var(--kg-text-3)",
                        marginTop: 2,
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      {b.leadEmail && <span>{b.leadEmail}</span>}
                      {b.leadPhone && <span>{b.leadPhone}</span>}
                    </div>
                  </Td>
                  <Td>{b.productName}</Td>
                  <Td subtle>{b.projectName}</Td>
                  <Td subtle align="right" mono>
                    {formatMoney(b.amount, b.currency)}
                  </Td>
                  <Td subtle align="right">
                    {formatDate(b.createdAt)}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {result && (
        <ResultBanner
          result={result}
          onClose={() => {
            setResult(null);
            setSelectedIds(new Set());
          }}
        />
      )}

      <ConfirmBulkDrawer
        open={confirming}
        onClose={() => {
          if (!pending) setConfirming(false);
        }}
        selectedBuyers={selectedBuyers}
        cohortsForBulk={cohortsForBulk}
        singleProductName={
          singleProductId
            ? selectedBuyers.find((b) => b.productId === singleProductId)
                ?.productName ?? null
            : null
        }
        pending={pending}
        onConfirm={(enrollInCohortId) => {
          setError(null);
          setResult(null);
          startTransition(async () => {
            const r = await bulkCreateStudentsFromSales(
              selectedBuyers.map((b) => b.saleId),
              { enrollInCohortId },
            );
            setConfirming(false);
            setResult({
              createdCount: r.createdCount,
              enrolledCount: r.enrolledCount,
              failures: r.failures,
            });
          });
        }}
      />
    </div>
  );
}

function ConfirmBulkDrawer({
  open,
  onClose,
  selectedBuyers,
  cohortsForBulk,
  singleProductName,
  pending,
  onConfirm,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly selectedBuyers: readonly PendingBuyer[];
  readonly cohortsForBulk: readonly CohortOptionForBulk[];
  readonly singleProductName: string | null;
  readonly pending: boolean;
  readonly onConfirm: (enrollInCohortId: string | null) => void;
}) {
  const [enrollAlso, setEnrollAlso] = useState(false);
  const [selectedCohortId, setSelectedCohortId] = useState<string>("");

  const eligibleCohorts = cohortsForBulk.filter(
    (c) => c.status === "active" || c.status === "planned",
  );

  // Auto-preseleccionar si hay una sola cohort elegible.
  const autoCohortId =
    eligibleCohorts.length === 1 ? eligibleCohorts[0]!.id : "";
  const finalCohortId =
    enrollAlso && (selectedCohortId || autoCohortId)
      ? selectedCohortId || autoCohortId
      : null;

  if (!open) return null;

  const canEnroll = singleProductName != null && eligibleCohorts.length > 0;
  const enrollDisabledReason =
    singleProductName == null
      ? "Los seleccionados son de productos distintos. Solo se crearán como estudiantes; para inscribirlos, andá a cada generación."
      : eligibleCohorts.length === 0
        ? "El curso no tiene generaciones en estado 'Activa' o 'Planeada'. Creá una primero."
        : null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Cargar seleccionados"
      subtitle={`${selectedBuyers.length} comprador${selectedBuyers.length === 1 ? "" : "es"}`}
      width={520}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-2)", lineHeight: 1.55 }}
        >
          Se van a crear{" "}
          <strong style={{ color: "var(--kg-text-1)" }}>
            {selectedBuyers.length} estudiantes
          </strong>{" "}
          desde las ventas seleccionadas. El nombre, email y teléfono se
          completan del lead de cada venta. Duplicados por email/teléfono se
          reportan al final.
        </div>

        <div
          style={{
            padding: "12px 14px",
            borderRadius: "var(--kg-r-8)",
            background: "var(--kg-surface-2-solid)",
            border: "1px solid var(--kg-border-subtle)",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              cursor: canEnroll ? "pointer" : "not-allowed",
              opacity: canEnroll ? 1 : 0.6,
            }}
          >
            <input
              type="checkbox"
              checked={enrollAlso}
              disabled={!canEnroll}
              onChange={(e) => setEnrollAlso(e.target.checked)}
              style={{ marginTop: 3, cursor: canEnroll ? "pointer" : "not-allowed" }}
            />
            <div style={{ flex: 1 }}>
              <div
                style={{
                  color: "var(--kg-text-1)",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Además, inscribir a una generación
              </div>
              <div
                className="kg-t7"
                style={{
                  color: "var(--kg-text-3)",
                  marginTop: 4,
                  lineHeight: 1.5,
                }}
              >
                {enrollDisabledReason ??
                  `Curso: ${singleProductName}. Los enrollments quedan vinculados a la venta original (badge "Auto").`}
              </div>
            </div>
          </label>

          {enrollAlso && canEnroll && (
            <div style={{ marginTop: 12 }}>
              <label
                className="kg-t7"
                style={{
                  display: "block",
                  color: "var(--kg-text-3)",
                  marginBottom: 6,
                }}
              >
                Generación destino
                <span
                  aria-hidden="true"
                  style={{ color: "#EF4444", marginLeft: 4 }}
                >
                  *
                </span>
              </label>
              <select
                value={selectedCohortId || autoCohortId}
                onChange={(e) => setSelectedCohortId(e.target.value)}
                required
                style={inputStyle}
              >
                {eligibleCohorts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.status === "active" ? "Activa" : "Planeada"}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 4,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="kg-focus"
            style={secondaryBtn}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(finalCohortId)}
            disabled={pending}
            className="kg-focus"
            style={{ ...primaryBtn, opacity: pending ? 0.7 : 1 }}
          >
            {pending
              ? "Procesando…"
              : finalCohortId
                ? "Crear e inscribir"
                : "Crear estudiantes"}
          </button>
        </div>
      </div>
    </Drawer>
  );
}

function ResultBanner({
  result,
  onClose,
}: {
  readonly result: {
    createdCount: number;
    enrolledCount: number;
    failures: readonly BulkFailure[];
  };
  readonly onClose: () => void;
}) {
  const hasFailures = result.failures.length > 0;
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: "var(--kg-r-8)",
        background: hasFailures
          ? "rgba(255,184,0,0.08)"
          : "rgba(34,197,94,0.08)",
        border: `1px solid ${hasFailures ? "#FFB800" : "#22C55E"}`,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            color: "var(--kg-text-1)",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {`Se crearon ${result.createdCount} estudiante${result.createdCount === 1 ? "" : "s"}`}
          {result.enrolledCount > 0 &&
            ` · ${result.enrolledCount} inscripción${result.enrolledCount === 1 ? "" : "es"}`}
          {hasFailures &&
            ` · ${result.failures.length} fallaron`}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="kg-focus"
          style={{
            background: "none",
            border: "none",
            padding: 4,
            color: "var(--kg-text-3)",
            fontSize: 14,
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>
      {hasFailures && (
        <ul
          style={{
            margin: 0,
            padding: "0 0 0 18px",
            color: "var(--kg-text-2)",
            fontSize: 12,
            lineHeight: 1.55,
          }}
        >
          {result.failures.map((f, i) => (
            <li key={`${f.saleId}-${i}`}>
              <strong>{f.leadName}</strong>: {f.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Th({
  children,
  align,
  width,
}: {
  readonly children: React.ReactNode;
  readonly align?: "right";
  readonly width?: number;
}) {
  return (
    <th
      style={{
        padding: "10px 14px",
        width: width ?? "auto",
        textAlign: align ?? "left",
        color: "var(--kg-text-3)",
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.5,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  subtle,
  mono,
}: {
  readonly children: React.ReactNode;
  readonly align?: "right";
  readonly subtle?: boolean;
  readonly mono?: boolean;
}) {
  return (
    <td
      style={{
        padding: "10px 14px",
        textAlign: align ?? "left",
        color: subtle ? "var(--kg-text-3)" : "var(--kg-text-1)",
        fontSize: 13,
        fontVariantNumeric: mono ? "tabular-nums" : "normal",
      }}
    >
      {children}
    </td>
  );
}

function formatMoney(amount: number, currency: "ARS" | "USD"): string {
  const raw = fMoney(amount);
  const prefix = currency === "USD" ? "US$" : "AR$";
  return raw.replace(/^(-?)\$/, `$1${prefix} `);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-2-solid)",
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

const secondaryBtn: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};
