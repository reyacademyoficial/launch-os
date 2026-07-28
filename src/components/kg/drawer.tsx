"use client";

import { useEffect, type ReactNode } from "react";

/**
 * KG · Drawer. Panel lateral glass, Esc-to-close, click-outside-to-close.
 * Renderiza al final del body vía portal implícito (position: fixed inset:0).
 * Nada de scroll lock — si el usuario abre y cierra rápido no queremos
 * pelearnos con overflow del body. Si en algún módulo importa, se agrega ahí.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  width = 560,
  children,
  footer,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly subtitle?: string;
  readonly width?: number;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function handle(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.5)",
        zIndex: 2000,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="kg-glass-3"
        style={{
          width: "100%",
          maxWidth: width,
          height: "100%",
          borderLeft: "1px solid var(--kg-border-default)",
          boxShadow: "var(--kg-shadow-float)",
          display: "flex",
          flexDirection: "column",
          animation: "kg-drawer var(--kg-dur-slow) var(--kg-ease)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 10,
            padding: "18px 22px",
            borderBottom: "1px solid var(--kg-border-subtle)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h3
              className="kg-t4"
              style={{ margin: 0, color: "var(--kg-text-1)" }}
            >
              {title}
            </h3>
            {subtitle && (
              <div
                className="kg-t6"
                style={{ color: "var(--kg-text-3)", marginTop: 3 }}
              >
                {subtitle}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="kg-focus"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--kg-text-3)",
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 22 }}>{children}</div>
        {footer && (
          <div
            style={{
              padding: "14px 22px",
              borderTop: "1px solid var(--kg-border-subtle)",
              background: "var(--kg-surface-2-solid)",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
