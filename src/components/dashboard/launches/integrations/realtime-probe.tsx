"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Componente invisible que monta una suscripción de Supabase Realtime sobre
 * `launch_daily` y `launch_daily_ads` filtrada por launch_id, y dispara
 * `router.refresh()` al recibir cualquier cambio.
 *
 * Por qué `router.refresh()` en vez de re-fetch local:
 *  - El page del detalle es server component — todo (KPIs, calendar, table,
 *    chart, integraciones section) sale del mismo render. Un refresh
 *    re-rendera todo coherente sin tener que sincronizar 5 piezas de estado
 *    cliente.
 *  - Los Realtime events de Supabase son RLS-aware: cada navegador solo
 *    recibe filas que su user puede ver. No hay leak entre proyectos.
 *
 * El componente no renderiza nada — es solo el side-effect.
 */
export function RealtimeProbe({ launchId }: { readonly launchId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`launch-realtime-${launchId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "launch_daily",
          filter: `launch_id=eq.${launchId}`,
        },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "launch_daily_ads",
          filter: `launch_id=eq.${launchId}`,
        },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "integration_runs",
          filter: `launch_id=eq.${launchId}`,
        },
        () => router.refresh(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [launchId, router]);

  return null;
}
