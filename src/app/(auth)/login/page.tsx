import type { Metadata } from "next";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default function LoginPage() {
  return (
    <main>
      <h1 className="mb-2 text-2xl font-bold text-fg">Launch OS</h1>
      <p className="text-sm text-fg-muted">
        Inicio de sesión — placeholder. Se conecta en la Fase 3 (Auth).
      </p>
    </main>
  );
}
