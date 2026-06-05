import type { Metadata } from "next";

import { LoginForm } from "./form";

export const metadata: Metadata = { title: "Iniciar sesión" };

const ERROR_MESSAGES: Record<string, string> = {
  invalid_invite:
    "El link de invitación llegó sin parámetros de autenticación. Probablemente expiró o el template de email está mal configurado.",
  verification_failed:
    "No pudimos verificar la invitación (token inválido, expirado, o flow no soportado).",
};

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ error?: string; dbg?: string }>;
}) {
  const { error, dbg } = await searchParams;
  let initialError: string | undefined;
  if (error && ERROR_MESSAGES[error]) {
    initialError = ERROR_MESSAGES[error];
    if (dbg) initialError += ` Parámetros recibidos: [${dbg}].`;
  }

  return (
    <main>
      <h1 className="mb-1 text-2xl font-bold text-fg">Launch OS</h1>
      <p className="mb-6 text-sm text-fg-muted">
        Ingresá con tu email y contraseña.
      </p>
      <LoginForm initialError={initialError} />
    </main>
  );
}
