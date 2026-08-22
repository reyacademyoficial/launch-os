import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContextBar } from "@/components/kg/context-bar";
import { IconAca } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { KgDataTable, type Column } from "@/components/kg/data-table";
import { getSystemById } from "@/lib/academia/systems";
import { monthlyAttendanceBySystem } from "@/lib/academia/system-reports";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Reporte mensual · Sistema" };

interface CourseDbRow {
  readonly id: string;
  readonly product_id: string;
}

interface ProductDbRow {
  readonly id: string;
  readonly name: string;
}

interface StudentRow {
  readonly studentId: string;
  readonly name: string;
  readonly present: number;
  readonly total: number;
  readonly attendancePct: number | null;
}

const YEAR_MIN = 2020;
const YEAR_MAX = 2100;

export default async function ReporteMensualPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ courseId: string; systemId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { courseId, systemId } = await params;
  const sp = await searchParams;

  const system = await getSystemById(systemId);
  if (!system || system.course_id !== courseId) notFound();

  const supabase = await createClient();
  const courseRes = await supabase
    .from("courses")
    .select("id, product_id")
    .eq("id", courseId)
    .maybeSingle();
  const course = courseRes.data as CourseDbRow | null;
  if (!course) notFound();

  const productRes = await supabase
    .from("products")
    .select("id, name")
    .eq("id", course.product_id)
    .maybeSingle();
  const product = productRes.data as ProductDbRow | null;

  const { year, month } = parseYearMonth(sp.year, sp.month);

  const report = await monthlyAttendanceBySystem(systemId, year, month);

  const studentRows: StudentRow[] = report.byStudent.map((b) => ({
    studentId: b.studentId,
    name: b.name,
    present: b.present,
    total: b.total,
    attendancePct: b.total === 0 ? null : (b.present / b.total) * 100,
  }));

  const columns: Column<StudentRow>[] = [
    {
      key: "name",
      label: "Alumno",
      render: (r) => (
        <span
          style={{
            color: "var(--kg-text-1)",
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          {r.name}
        </span>
      ),
    },
    {
      key: "present",
      label: "Presentes",
      align: "right",
      numeric: true,
      render: (r) => String(r.present),
    },
    {
      key: "total",
      label: "Total clases",
      align: "right",
      numeric: true,
      render: (r) => String(r.total),
    },
    {
      key: "pct",
      label: "% Asistencia",
      align: "right",
      numeric: true,
      render: (r) =>
        r.attendancePct == null ? (
          <span style={{ color: "var(--kg-text-3)" }}>—</span>
        ) : (
          `${r.attendancePct.toFixed(0)}%`
        ),
    },
  ];

  const monthOptions = buildMonthOptions();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconAca size={16} />}
        title={`${system.name} · ${monthLabel(year, month)}`}
        stats={[
          { l: "Clases", v: String(report.classesCount) },
          { l: "Asistencias", v: String(report.attendancesPresent) },
          { l: "Alumnos con registro", v: String(studentRows.length) },
        ]}
      />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link
            href={`/academia/cursos/${courseId}`}
            className="kg-focus"
            style={secondaryLinkBtn}
          >
            ← Volver al curso
          </Link>
          <span
            className="kg-t7"
            style={{ color: "var(--kg-text-3)" }}
          >
            {product?.name ?? "Curso"} · Sistema {system.name}
          </span>
        </div>

        <form
          method="get"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <label
            htmlFor="year"
            className="kg-t7"
            style={{ color: "var(--kg-text-3)" }}
          >
            Año
          </label>
          <input
            id="year"
            name="year"
            type="number"
            min={YEAR_MIN}
            max={YEAR_MAX}
            defaultValue={year}
            style={{
              ...inputStyle,
              width: 90,
            }}
          />
          <label
            htmlFor="month"
            className="kg-t7"
            style={{ color: "var(--kg-text-3)" }}
          >
            Mes
          </label>
          <select
            id="month"
            name="month"
            defaultValue={String(month)}
            style={{ ...inputStyle, width: 150 }}
          >
            {monthOptions.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <button type="submit" className="kg-focus" style={primaryBtn}>
            Ver
          </button>
        </form>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        <SummaryCard
          label="Asistencias totales"
          value={String(report.attendancesPresent)}
          hint={`En ${report.classesCount} clase${report.classesCount === 1 ? "" : "s"} del sistema`}
        />
        <SummaryCard
          label="Clases del sistema"
          value={String(report.classesCount)}
          hint="Sumadas todas las cohortes"
        />
        <SummaryCard
          label="Sesiones individuales"
          value={
            report.individualSessions == null
              ? "—"
              : String(report.individualSessions)
          }
          hint="Disponible cuando se conecte la app externa"
        />
      </div>

      <Panel title="Asistencia por alumno">
        <KgDataTable
          columns={columns}
          rows={studentRows}
          rowKey={(r) => r.studentId}
          totalCount={studentRows.length}
          emptyTitle="Sin asistencias en el mes"
          emptyHint="No hay registros de asistencia para las cohortes de este sistema en el mes seleccionado."
        />
      </Panel>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint: string;
}) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: "var(--kg-r-12)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        className="kg-t7"
        style={{ color: "var(--kg-text-3)", fontWeight: 600 }}
      >
        {label}
      </div>
      <div
        style={{
          color: "var(--kg-text-1)",
          fontSize: 22,
          fontWeight: 700,
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      <div
        className="kg-t7"
        style={{ color: "var(--kg-text-3)" }}
      >
        {hint}
      </div>
    </div>
  );
}

function parseYearMonth(
  yearRaw: string | string[] | undefined,
  monthRaw: string | string[] | undefined,
): { year: number; month: number } {
  const now = new Date();
  const defaultYear = now.getUTCFullYear();
  const defaultMonth = now.getUTCMonth() + 1;

  const y = Array.isArray(yearRaw) ? yearRaw[0] : yearRaw;
  const m = Array.isArray(monthRaw) ? monthRaw[0] : monthRaw;
  const year = y ? Number(y) : defaultYear;
  const month = m ? Number(m) : defaultMonth;

  if (
    !Number.isInteger(year) ||
    year < YEAR_MIN ||
    year > YEAR_MAX ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return { year: defaultYear, month: defaultMonth };
  }
  return { year, month };
}

const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? String(month)} ${year}`;
}

function buildMonthOptions(): ReadonlyArray<{ value: string; label: string }> {
  return MONTH_NAMES.map((label, i) => ({
    value: String(i + 1),
    label,
  }));
}

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 12,
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

const secondaryLinkBtn: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 700,
  textDecoration: "none",
};
