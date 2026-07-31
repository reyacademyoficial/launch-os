/**
 * CLI wrapper delgado sobre `src/lib/settlements/create.ts`.
 *
 * USO:
 *   npx tsx scripts/settle-launch.ts --launch <uuid>            # dry-run (default)
 *   npx tsx scripts/settle-launch.ts --launch <uuid> --commit   # escribe fila
 *
 * SEGURIDAD:
 *   - Este script usa la SERVICE_ROLE_KEY, que PUENTEA la RLS por completo.
 *     Solo debe correrse en local, nunca desplegado como Route Handler.
 *   - Sin `--commit`, es imposible que el script escriba nada: el service
 *     que ejecuta pasa `dryRun: true` y el orquestador nunca llama a insert
 *     (ver test "dryRun=true NUNCA llama a insert").
 *
 * NO HACE NADA MÁS QUE ORQUESTAR:
 *   - No configura reglas.
 *   - No cambia status a `liquidada`.
 *   - No crea `client_transfers`.
 *   - Ver `src/lib/settlements/create.ts` para la lógica de negocio.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { createSettlement } from "../src/lib/settlements/create";

// ═══════════════════════════════════════════════════════════════════════════
// Carga de env — .env.local sin dotenv (evitamos dep extra)
// ═══════════════════════════════════════════════════════════════════════════

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    console.error(`✗ no se pudo leer ${path}`);
    process.exit(2);
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Args
// ═══════════════════════════════════════════════════════════════════════════

interface Args {
  launchId: string;
  commit: boolean;
}

function parseArgs(argv: string[]): Args {
  let launchId: string | null = null;
  let commit = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--launch") {
      launchId = argv[++i] ?? null;
    } else if (a === "--commit") {
      commit = true;
    } else if (a === "--help" || a === "-h") {
      printUsageAndExit(0);
    }
  }
  if (!launchId) {
    console.error("✗ falta --launch <uuid>");
    printUsageAndExit(2);
  }
  return { launchId: launchId as string, commit };
}

function printUsageAndExit(code: number): never {
  console.log(`
Uso:
  npx tsx scripts/settle-launch.ts --launch <uuid>            # dry-run (default)
  npx tsx scripts/settle-launch.ts --launch <uuid> --commit   # escribe fila

Sin --commit no hay ninguna escritura posible. Con --commit, inserta una
fila en launch_settlements con status='abierta' y closed_at=null.
`);
  process.exit(code);
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      "✗ faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en .env.local",
    );
    process.exit(2);
  }

  const args = parseArgs(process.argv.slice(2));

  // Node 20 no trae WebSocket global; @supabase/realtime-js falla al
  // inicializar sin transport. Este CLI no usa realtime — pasamos un stub
  // que nunca se conecta. Bajo Node 22+ este workaround es innecesario
  // pero inofensivo.
  class NoopWebSocket {
    constructor(_url: string) {}
    close() {}
    send() {}
    addEventListener() {}
    removeEventListener() {}
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: NoopWebSocket as never },
  });

  console.log(
    `► settle-launch  launch=${args.launchId}  ${args.commit ? "COMMIT" : "dry-run"}`,
  );

  const result = await createSettlement(supabase as never, {
    launchId: args.launchId,
    dryRun: !args.commit,
  });

  if (!result.ok) {
    console.log(`✗ ${result.reason}`);
    console.log(`  ${result.detail}`);
    process.exit(1);
  }

  console.log("✓ payload calculado:");
  console.log(JSON.stringify(result.payload, null, 2));
  if (result.draftsCount > 0) {
    console.log(
      `ℹ ${result.draftsCount} borrador(es) 'abierta' preexistente(s) para este launch (no bloquean)`,
    );
  }

  if (result.dryRun) {
    console.log("DRY RUN — no se escribió nada");
  } else {
    console.log(`✓ escrito. settlement_id = ${result.settlementId}`);
  }
}

main().catch((err) => {
  console.error("✗ error runtime:", err);
  process.exit(1);
});
