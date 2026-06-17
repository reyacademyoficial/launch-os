import "server-only";

import fs from "node:fs";
import path from "node:path";

/**
 * Registry de instructivos por provider — leído server-side desde los .md
 * de esta carpeta. Cada provider tiene su propio archivo Markdown; cambiar
 * un instructivo = editar el .md y nada más.
 *
 * El contenido (string) se pasa como prop al componente modal del cliente
 * (`InstructionsModal`) que lo renderiza con react-markdown. Lo hacemos así
 * en vez de importar el .md directamente porque Next 16 no resuelve .md por
 * defecto y queremos evitar agregar un loader.
 */

export interface ProviderInstructions {
  /** Título visible arriba del modal. */
  title: string;
  /** Contenido Markdown que se renderiza con react-markdown. */
  markdown: string;
}

const INSTRUCTIONS_DIR = path.join(process.cwd(), "src/lib/integrations/instructions");

const TITLES: Record<string, string> = {
  meta: "¿Cómo conecto Meta Ads?",
  ghl: "¿Cómo conecto Go High Level?",
  sendflow: "¿Cómo conecto SendFlow?",
};

export function getInstructions(providerId: string): ProviderInstructions | null {
  const title = TITLES[providerId];
  if (!title) return null;

  const filePath = path.join(INSTRUCTIONS_DIR, `${providerId}.md`);
  try {
    const markdown = fs.readFileSync(filePath, "utf8");
    return { title, markdown };
  } catch {
    return null;
  }
}
