import type { Metadata } from "next";

export const metadata: Metadata = { title: "Calculadora" };

export default function CalculatorPage() {
  return (
    <section>
      <h1 className="text-2xl font-bold">Calculadora de lanzamientos</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Reverse Planning (meta → leads necesarios) y Forward Planning (budget → resultados).
        Placeholder — se porta tal cual de la <code>CalcPage</code> del prototipo en Fase 6.
      </p>
    </section>
  );
}
