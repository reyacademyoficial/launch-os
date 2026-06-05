import type { Metadata } from "next";

import { Calculator } from "@/components/dashboard/calculator/calculator";

export const metadata: Metadata = { title: "Calculadora" };

export default function CalculatorPage() {
  return <Calculator />;
}
