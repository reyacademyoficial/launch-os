"use client";

import { useState } from "react";

import { panelActionPrimaryBtn } from "@/components/kg/form-primitives";

import {
  UploadFormDrawer,
  type AssetOption,
  type CadenceLite,
  type OwnerOption,
} from "./upload-form-drawer";

export function NewUploadButton({
  ownerOptions,
  assetOptions,
  cadences,
}: {
  readonly ownerOptions: readonly OwnerOption[];
  readonly assetOptions: readonly AssetOption[];
  readonly cadences: readonly CadenceLite[];
}) {
  const [open, setOpen] = useState(false);
  const noAssets = assetOptions.length === 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={noAssets}
        className="kg-focus"
        style={{ ...panelActionPrimaryBtn, opacity: noAssets ? 0.5 : 1 }}
        title={
          noAssets
            ? "Primero registrá al menos un asset en /marketing/edicion"
            : undefined
        }
      >
        + Nueva subida
      </button>
      <UploadFormDrawer
        mode="create"
        open={open}
        onClose={() => setOpen(false)}
        ownerOptions={ownerOptions}
        assetOptions={assetOptions}
        cadences={cadences}
      />
    </>
  );
}
