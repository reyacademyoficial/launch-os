"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { updatePassword, updateProfile, type ConfigState } from "./actions";

export function ProfileForm({
  initialFullName,
  email,
}: {
  readonly initialFullName: string | null;
  readonly email: string | null;
}) {
  const [state, formAction, pending] = useActionState<ConfigState, FormData>(
    updateProfile,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="profile-email">Email</Label>
        <Input
          id="profile-email"
          value={email ?? ""}
          disabled
          type="email"
          autoComplete="off"
        />
        <p className="mt-1 text-xs text-fg-subtle">
          El email se gestiona desde Supabase Auth, no se cambia acá.
        </p>
      </div>
      <div>
        <Label htmlFor="full_name">Nombre completo</Label>
        <Input
          id="full_name"
          name="full_name"
          type="text"
          defaultValue={initialFullName ?? ""}
          autoComplete="off"
          placeholder="Opcional"
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>

      {state && "error" in state && <FieldError>{state.error}</FieldError>}
      {state && "ok" in state && state.ok && (
        <p role="status" className="text-sm text-success">
          Datos guardados.
        </p>
      )}
    </form>
  );
}

export function PasswordForm() {
  const [state, formAction, pending] = useActionState<ConfigState, FormData>(
    updatePassword,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="password">Nueva contraseña</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>
      <div>
        <Label htmlFor="confirm">Repetir contraseña</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Cambiando…" : "Cambiar contraseña"}
      </Button>

      {state && "error" in state && <FieldError>{state.error}</FieldError>}
      {state && "ok" in state && state.ok && (
        <p role="status" className="text-sm text-success">
          Contraseña actualizada.
        </p>
      )}
    </form>
  );
}
