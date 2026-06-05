import {
  connectIntegration,
  disconnectIntegration,
  rotateSecret,
} from "@/app/(app)/proyectos/[projectId]/integraciones/actions";
import { fmtDate } from "@/lib/format";
import type {
  ProjectIntegrationRow,
  ProviderConfig,
} from "@/lib/integrations/types";

import { ConnectModal } from "./connect-modal";
import { DisconnectButton } from "./disconnect-button";
import { RotateModal } from "./rotate-modal";

export function ProviderCard({
  provider,
  integration,
  canEdit,
  projectId,
}: {
  readonly provider: ProviderConfig;
  readonly integration: ProjectIntegrationRow | undefined;
  readonly canEdit: boolean;
  readonly projectId: string;
}) {
  const connected = integration?.connected === true;

  const connectAction = connectIntegration.bind(null, projectId);
  const rotateAction = rotateSecret.bind(null, projectId);
  const disconnectAction = disconnectIntegration.bind(null, projectId, provider.id);

  return (
    <article
      className="flex flex-col rounded-md border bg-surface p-5 transition-colors"
      style={{
        borderColor: connected ? `${provider.color}55` : "var(--color-border)",
      }}
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-md text-base font-extrabold"
            style={{
              background: `${provider.color}1A`,
              color: provider.color,
            }}
            aria-hidden
          >
            {provider.glyph}
          </span>
          <div>
            <div className="text-sm font-semibold text-fg">{provider.name}</div>
            <div className="text-[11px] uppercase tracking-wide text-fg-subtle">
              {connected ? "Conectado" : "Desconectado"}
            </div>
          </div>
        </div>
        <span
          aria-hidden
          className="mt-1.5 inline-block h-2 w-2 rounded-full"
          style={{ background: connected ? "var(--color-success)" : "var(--color-fg-subtle)" }}
        />
      </header>

      <dl className="mb-4 space-y-1.5 text-xs">
        <Row label={provider.accountLabel} value={integration?.account_id} />
        <Row label="Último sync" value={fmtDate(integration?.last_sync ?? null)} />
        <Row label="Estado" value={integration?.status ?? "—"} />
      </dl>

      <footer className="mt-auto flex items-center justify-end gap-3">
        {canEdit ? (
          connected ? (
            <>
              <DisconnectButton onConfirm={disconnectAction} />
              <RotateModal provider={provider} action={rotateAction} />
            </>
          ) : (
            <ConnectModal provider={provider} action={connectAction} />
          )
        ) : (
          <span className="text-xs text-fg-subtle">
            {connected ? "Solo admin gestiona credenciales" : "—"}
          </span>
        )}
      </footer>
    </article>
  );
}

function Row({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | null | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="truncate text-right font-medium text-fg">
        {value && value !== "—" ? value : <span className="text-fg-subtle">—</span>}
      </dd>
    </div>
  );
}
