"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";
import {
  FORMAT_LABEL,
  MARKETING_PLATFORMS,
  PLATFORM_LABEL,
  UPLOAD_STATUS_LABEL,
  UPLOAD_STATUSES,
  type MarketingFormat,
  type MarketingPlatform,
  type UploadStatus,
} from "@/lib/marketing/types";

import {
  createUpload,
  deleteUpload,
  updateUpload,
  type CreateUploadState,
  type UpdateUploadState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer create/edit de content_upload.
//
// Flujo:
//   1. Owner  → filtra assets al set del owner.
//   2. Platform → filtra assets según cadencia (allow_repeat_asset).
//   3. Asset  → picker filtrado.
//   4. Fecha + estado + notas + public_url (visible solo si status='subida').
//
// Regla del picker "asset disponible" para una (owner, platform):
//   - si la cadencia (owner × platform × format) tiene allow_repeat_asset=false
//     y el asset ya está COMPROMETIDO en esa platform — reservado por una
//     subida .planificada. o consumido por una .subida. — NO aparece.
//   - si allow_repeat_asset=true (o no hay cadencia configurada), aparece
//     igual.
//   - los assets EN COLA (sin edited_at) no llegan hasta acá: la page ya los
//     excluye del picker. Sólo se puede agendar lo que está editado.
//
// En modo EDIT: el asset original siempre aparece aunque no cumpla el filtro
// (para poder guardar sin perder la selección).
// ═══════════════════════════════════════════════════════════════════════════

export interface OwnerOption {
  readonly id: string;
  readonly name: string;
}

export interface AssetOption {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly name: string;
  readonly format: MarketingFormat;
  readonly editedAt: string | null;
  /** platforms en las que este asset YA tiene un upload en status='subida'. */
  readonly usedPlatforms: readonly MarketingPlatform[];
}

export interface CadenceLite {
  readonly contentOwnerId: string;
  readonly platform: MarketingPlatform;
  readonly format: MarketingFormat;
  readonly allowRepeatAsset: boolean;
}

export interface UploadInitial {
  readonly id: string;
  readonly contentAssetId: string;
  readonly contentOwnerId: string; // resolvido del asset
  readonly platform: MarketingPlatform;
  readonly scheduledFor: string; // yyyy-mm-dd
  readonly status: UploadStatus;
  readonly publicUrl: string | null;
  readonly notes: string | null;
}

export function UploadFormDrawer({
  mode,
  open,
  onClose,
  ownerOptions,
  assetOptions,
  cadences,
  initial,
  presetDate,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly ownerOptions: readonly OwnerOption[];
  readonly assetOptions: readonly AssetOption[];
  readonly cadences: readonly CadenceLite[];
  readonly initial?: UploadInitial;
  readonly presetDate?: string;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nueva subida" : "Editar subida";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={560}>
      <UploadFormBody
        mode={mode}
        onClose={onClose}
        ownerOptions={ownerOptions}
        assetOptions={assetOptions}
        cadences={cadences}
        initial={initial}
        presetDate={presetDate}
      />
    </Drawer>
  );
}

function UploadFormBody({
  mode,
  onClose,
  ownerOptions,
  assetOptions,
  cadences,
  initial,
  presetDate,
}: {
  readonly mode: "create" | "edit";
  readonly onClose: () => void;
  readonly ownerOptions: readonly OwnerOption[];
  readonly assetOptions: readonly AssetOption[];
  readonly cadences: readonly CadenceLite[];
  readonly initial?: UploadInitial;
  readonly presetDate?: string;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdateUploadState, fd: FormData) =>
      updateUpload(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateUploadState,
    FormData
  >(createUpload, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateUploadState,
    FormData
  >(
    updateBound ??
      (async () => ({ error: "Modo edit sin id" as string }) as never),
    null,
  );

  const state = isEdit ? updateState : createState;
  const formAction = isEdit ? updateFormAction : createFormAction;
  const pending = isEdit ? updatePending : createPending;

  useEffect(() => {
    if (state && "ok" in state && state.ok) onClose();
  }, [state, onClose]);

  const [ownerId, setOwnerId] = useState(initial?.contentOwnerId ?? "");
  const [platform, setPlatform] = useState<MarketingPlatform | "">(
    initial?.platform ?? "",
  );
  const [assetId, setAssetId] = useState(initial?.contentAssetId ?? "");
  const [status, setStatus] = useState<UploadStatus>(
    initial?.status ?? "planificada",
  );

  const [deletePending, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const cadenceByKey = useMemo(() => {
    const map = new Map<string, CadenceLite>();
    for (const c of cadences) {
      map.set(`${c.contentOwnerId}::${c.platform}::${c.format}`, c);
    }
    return map;
  }, [cadences]);

  // Filtrar assets según owner + platform + regla de repetición.
  const availableAssets = useMemo(() => {
    if (!ownerId) return [];
    return assetOptions.filter((a) => {
      if (a.contentOwnerId !== ownerId) return false;
      if (platform) {
        const cad = cadenceByKey.get(
          `${a.contentOwnerId}::${platform}::${a.format}`,
        );
        // Si hay cadencia y NO permite repetir, esconder assets ya subidos
        // en esa plataforma.
        if (cad && !cad.allowRepeatAsset && a.usedPlatforms.includes(platform)) {
          // Excepción: en modo edit, si el asset seleccionado ES este, lo
          // dejamos aparecer para no perder la selección.
          if (isEdit && initial && a.id === initial.contentAssetId) return true;
          return false;
        }
      }
      return true;
    });
  }, [ownerId, platform, assetOptions, cadenceByKey, isEdit, initial]);

  function handleOwnerChange(next: string) {
    setOwnerId(next);
    if (next !== ownerId) {
      setAssetId("");
    }
  }

  function handlePlatformChange(next: string) {
    setPlatform(next as MarketingPlatform | "");
    // Si el asset actual ya no está disponible con la nueva platform, resetear.
    if (next && ownerId) {
      const stillOk = assetOptions.some((a) => {
        if (a.id !== assetId) return false;
        if (a.contentOwnerId !== ownerId) return false;
        const cad = cadenceByKey.get(
          `${ownerId}::${next}::${a.format}`,
        );
        if (cad && !cad.allowRepeatAsset && a.usedPlatforms.includes(next as MarketingPlatform)) {
          return isEdit && initial ? a.id === initial.contentAssetId : false;
        }
        return true;
      });
      if (!stillOk) setAssetId("");
    }
  }

  function handleDelete() {
    if (!isEdit || !initial) return;
    const ok = window.confirm("¿Eliminar esta subida?");
    if (!ok) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteUpload(initial.id);
      if ("error" in result) {
        setDeleteError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <Field label="Dueño de contenido" htmlFor="_owner_id" required>
        <select
          id="_owner_id"
          value={ownerId}
          onChange={(e) => handleOwnerChange(e.target.value)}
          required
          style={inputStyle}
        >
          <option value="">— Elegí un dueño —</option>
          {ownerOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </Field>

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label="Plataforma" htmlFor="platform" required>
            <select
              id="platform"
              name="platform"
              value={platform}
              onChange={(e) => handlePlatformChange(e.target.value)}
              required
              style={inputStyle}
            >
              <option value="">— Elegí una —</option>
              {MARKETING_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABEL[p]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Fecha de subida" htmlFor="scheduled_for" required>
            <input
              id="scheduled_for"
              name="scheduled_for"
              type="date"
              required
              defaultValue={initial?.scheduledFor ?? presetDate ?? ""}
              style={inputStyle}
            />
          </Field>
        </div>
      </div>

      <Field label="Asset a subir" htmlFor="content_asset_id" required>
        <select
          id="content_asset_id"
          name="content_asset_id"
          value={assetId}
          onChange={(e) => setAssetId(e.target.value)}
          required
          disabled={!ownerId}
          style={inputStyle}
        >
          <option value="">
            {ownerId
              ? availableAssets.length === 0
                ? "— No hay assets disponibles —"
                : "— Elegí un asset —"
              : "— Primero elegí un dueño —"}
          </option>
          {availableAssets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {FORMAT_LABEL[a.format]}
            </option>
          ))}
        </select>
        <div className="kg-t7" style={{ color: "var(--kg-text-3)", marginTop: 4 }}>
          {platform && ownerId
            ? "Sólo aparecen cortes ya editados y sin reservar. Los subidos o ya agendados en esta plataforma se ocultan si la cadencia no permite repetir."
            : "Elegí dueño y plataforma para filtrar el listado."}
        </div>
      </Field>

      <Field label="Estado" htmlFor="status" required>
        <select
          id="status"
          name="status"
          value={status}
          onChange={(e) => setStatus(e.target.value as UploadStatus)}
          required
          style={inputStyle}
        >
          {UPLOAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {UPLOAD_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </Field>

      {status === "subida" && (
        <Field label="Link al posteo (opcional)" htmlFor="public_url">
          <input
            id="public_url"
            name="public_url"
            type="url"
            defaultValue={initial?.publicUrl ?? ""}
            placeholder="https://www.instagram.com/reel/..."
            style={inputStyle}
          />
        </Field>
      )}

      <Field label="Notas" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={initial?.notes ?? ""}
          placeholder="Contexto libre — hora de subida, hashtags, resultado, etc."
          style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
        />
      </Field>

      {state && "error" in state && (
        <div style={errorStyle}>{state.error}</div>
      )}

      {deleteError && <div style={errorStyle}>{deleteError}</div>}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginTop: 4,
        }}
      >
        {isEdit ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending || deletePending}
            className="kg-focus"
            style={{ ...dangerBtn, opacity: deletePending ? 0.7 : 1 }}
          >
            {deletePending ? "Eliminando…" : "Eliminar"}
          </button>
        ) : (
          <div />
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={pending || deletePending}
            className="kg-focus"
            style={secondaryBtn}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={pending || deletePending || !assetId}
            className="kg-focus"
            style={{ ...primaryBtn, opacity: pending ? 0.7 : 1 }}
          >
            {pending
              ? isEdit
                ? "Guardando…"
                : "Creando…"
              : isEdit
                ? "Guardar cambios"
                : "Crear subida"}
          </button>
        </div>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  readonly label: string;
  readonly htmlFor: string;
  readonly required?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="kg-t7"
        style={{ display: "block", color: "var(--kg-text-3)", marginBottom: 6 }}
      >
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: "#EF4444", marginLeft: 4 }}>
            *
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 13,
  colorScheme: "dark",
};

const primaryBtn: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 999,
  background: "var(--kg-accent-500)",
  border: "none",
  color: "#fff",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

const dangerBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid #EF4444",
  color: "#EF4444",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};

const errorStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: "var(--kg-r-8)",
  background: "rgba(239,68,68,0.10)",
  border: "1px solid #EF4444",
  color: "#EF4444",
  fontSize: 12,
};
