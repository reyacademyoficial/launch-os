"use client";

import { useState } from "react";

import {
  FORWARD_DEFAULTS,
  type ForwardInput,
} from "@/lib/calculator/forward";
import {
  REVERSE_DEFAULTS,
  type ReverseInput,
} from "@/lib/calculator/reverse";

import { ForwardSection } from "./forward-section";
import { ReverseSection } from "./reverse-section";

type Mode = "reverse" | "forward";

export function Calculator() {
  const [mode, setMode] = useState<Mode>("reverse");
  // Keep input state OUTSIDE the section components so switching modes back
  // and forth preserves what the user typed in the inactive mode.
  const [reverseInput, setReverseInput] = useState<ReverseInput>(REVERSE_DEFAULTS);
  const [forwardInput, setForwardInput] = useState<ForwardInput>(FORWARD_DEFAULTS);

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Launch Revenue Simulator</h1>
        <p className="text-sm text-fg-muted">
          Modelá escenarios completos antes de ejecutar. Sin persistencia: lo que cambies acá no se guarda.
        </p>
      </header>

      <div className="flex gap-2">
        <ModeButton active={mode === "reverse"} onClick={() => setMode("reverse")}>
          Reverse · meta → presupuesto
        </ModeButton>
        <ModeButton active={mode === "forward"} onClick={() => setMode("forward")}>
          Forward · presupuesto → resultados
        </ModeButton>
      </div>

      {mode === "reverse" ? (
        <ReverseSection input={reverseInput} setInput={setReverseInput} />
      ) : (
        <ForwardSection input={forwardInput} setInput={setForwardInput} />
      )}
    </section>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-md border px-3 py-2 text-xs font-semibold transition-colors " +
        (active
          ? "border-accent bg-accent/15 text-accent"
          : "border-border bg-surface text-fg-muted hover:text-fg")
      }
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
