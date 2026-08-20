"use client";

import { useRouter, useSearchParams } from "next/navigation";

/**
 * Select nativo para filtrar la lista de proyectos por responsable. Vive
 * client-side porque necesita `router.push` para navegar preservando el
 * resto de query params (status, etc.). Un simple `<a>` pill por persona
 * escalaría feo con 20+ personas.
 *
 * Value = "" → sin filtro (todos). Cualquier otro = person_id.
 */
export function OwnerFilterSelect({
  people,
  currentId,
}: {
  readonly people: readonly { readonly id: string; readonly fullName: string }[];
  readonly currentId: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "") params.delete("ownerId");
    else params.set("ownerId", next);
    const qs = params.toString();
    router.push(qs ? `/operaciones/proyectos?${qs}` : "/operaciones/proyectos");
  }

  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: 11,
        color: "var(--kg-text-3)",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.3,
      }}
    >
      Responsable
      <select
        value={currentId ?? ""}
        onChange={(e) => handleChange(e.target.value)}
        aria-label="Filtrar por responsable"
        className="kg-focus"
        style={{
          padding: "5px 10px",
          borderRadius: 999,
          background: currentId
            ? "var(--kg-accent-500)"
            : "transparent",
          border: `1px solid ${currentId ? "var(--kg-accent-500)" : "var(--kg-border-subtle)"}`,
          color: currentId ? "#fff" : "var(--kg-text-2)",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "none",
          letterSpacing: 0,
          cursor: "pointer",
          colorScheme: "dark",
        }}
      >
        <option value="">Todos</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.fullName}
          </option>
        ))}
      </select>
    </label>
  );
}
