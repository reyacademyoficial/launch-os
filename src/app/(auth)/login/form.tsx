"use client";

import { useActionState, useState } from "react";

import { FieldError } from "@/components/ui/field-error";

import { signIn, type LoginState } from "./actions";

const FIELD_LABEL =
  "mb-1.5 block text-xs font-semibold uppercase tracking-wide";
const FIELD_INPUT =
  "h-12 w-full rounded-[var(--kg-r-12)] border px-4 text-base transition-colors " +
  "focus:outline-none focus:ring-2 sm:text-sm";

export function LoginForm({ initialError }: { readonly initialError?: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    signIn,
    initialError ? { error: initialError } : null,
  );
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <div>
        <label
          htmlFor="email"
          className={FIELD_LABEL}
          style={{ color: "var(--kg-text-2)" }}
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="tu@empresa.com"
          className={FIELD_INPUT}
          style={{
            background: "var(--kg-surface-1-solid)",
            borderColor: "var(--kg-border-default)",
            color: "var(--kg-text-1)",
          }}
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className={FIELD_LABEL}
          style={{ color: "var(--kg-text-2)" }}
        >
          Contraseña
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            className={`${FIELD_INPUT} pr-12`}
            style={{
              background: "var(--kg-surface-1-solid)",
              borderColor: "var(--kg-border-default)",
              color: "var(--kg-text-1)",
            }}
          />
          <button
            type="button"
            aria-label={
              showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
            }
            aria-pressed={showPassword}
            onClick={() => setShowPassword((v) => !v)}
            className="kg-focus absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[var(--kg-r-8)] transition-colors"
            style={{ color: "var(--kg-text-3)" }}
          >
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="kg-focus h-12 w-full rounded-[var(--kg-r-12)] text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
        style={{ background: "var(--kg-accent-500)" }}
      >
        {pending ? "Ingresando…" : "Ingresar"}
      </button>

      <FieldError>{state?.error}</FieldError>
    </form>
  );
}

function EyeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}
