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
    <main className="grid w-full max-w-md gap-8 lg:max-w-5xl lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-16">
      <section className="flex flex-col items-center gap-5 text-center lg:items-start lg:text-left">
        <BrandMark />
        <div className="space-y-2">
          <h1
            className="kg-t2"
            style={{ color: "var(--kg-text-1)", letterSpacing: "-1px" }}
          >
            Kin<span style={{ color: "var(--kg-accent-text)" }}>Grow</span>
          </h1>
          <p className="kg-t5" style={{ color: "var(--kg-text-2)" }}>
            Sistema operativo de lanzamientos.
            <span className="hidden sm:inline">
              {" "}
              Acceso por invitación.
            </span>
          </p>
        </div>
        <ul className="mt-2 hidden flex-col gap-3 lg:flex">
          <FeatureLine>Pipeline de ventas y cobros en tiempo real</FeatureLine>
          <FeatureLine>
            Split de comisiones y liquidaciones automatizadas
          </FeatureLine>
          <FeatureLine>Salud del cliente, renewals y upsells</FeatureLine>
        </ul>
      </section>

      <section
        className="kg-glass w-full rounded-[var(--kg-r-20)] p-6 sm:p-8"
        style={{ boxShadow: "var(--kg-shadow-amb)" }}
      >
        <header className="mb-6">
          <h2 className="kg-t3" style={{ color: "var(--kg-text-1)" }}>
            Iniciar sesión
          </h2>
          <p
            className="kg-t6 mt-1"
            style={{ color: "var(--kg-text-3)" }}
          >
            Ingresá con tu email y contraseña.
          </p>
        </header>
        <LoginForm initialError={initialError} />
        <p
          className="mt-6 text-center text-xs lg:text-left"
          style={{ color: "var(--kg-text-3)" }}
        >
          ¿No tenés cuenta? Pedile una invitación a tu admin.
        </p>
      </section>
    </main>
  );
}

function BrandMark() {
  return (
    <div
      aria-label="KinGrow"
      role="img"
      className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-[var(--kg-r-20)]"
      style={{
        background:
          "linear-gradient(135deg, var(--kg-accent-500) 0%, var(--kg-accent-700) 100%)",
        boxShadow: "var(--kg-glow-accent)",
      }}
    >
      <span
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 30% 20%, rgba(255,255,255,0.28), transparent 55%)",
        }}
      />
      <svg
        aria-hidden
        viewBox="0 0 40 40"
        width="40"
        height="40"
        className="relative"
      >
        <text
          x="6"
          y="30"
          fontFamily="var(--font-inter), Inter, sans-serif"
          fontSize="22"
          fontWeight={900}
          fill="#ffffff"
          letterSpacing="-1"
        >
          K
        </text>
        <text
          x="20"
          y="30"
          fontFamily="var(--font-inter), Inter, sans-serif"
          fontSize="22"
          fontWeight={900}
          fill="#ffffff"
          fillOpacity="0.82"
          letterSpacing="-1"
        >
          G
        </text>
        <path
          d="M19.5 8 L19.5 34"
          stroke="#ffffff"
          strokeOpacity="0.35"
          strokeWidth="1"
        />
      </svg>
    </div>
  );
}

function FeatureLine({ children }: { readonly children: React.ReactNode }) {
  return (
    <li
      className="kg-t5 flex items-start gap-3"
      style={{ color: "var(--kg-text-2)" }}
    >
      <span
        aria-hidden
        className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ background: "var(--kg-accent-500)" }}
      />
      <span>{children}</span>
    </li>
  );
}
