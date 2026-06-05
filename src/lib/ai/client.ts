import "server-only";

import OpenAI from "openai";

/**
 * Single boundary for AI provider calls. Today it's OpenAI; swapping to
 * Anthropic or another provider only requires editing this file — the rest of
 * the codebase only knows the `generateText(...)` shape.
 *
 * `OPENAI_API_KEY` is read from env and never exposed to the browser
 * (`server-only` import enforces it).
 */
export const DEFAULT_MODEL = "gpt-4o-mini";

let client: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY no está seteada. Cargala en .env.local y reiniciá el dev server.",
      );
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

/**
 * Generates a single completion. Returns the text. Throws on API error so the
 * Server Action can surface a friendly message.
 */
export async function generateText({
  system,
  user,
  maxTokens = 1024,
}: {
  readonly system: string;
  readonly user: string;
  readonly maxTokens?: number;
}): Promise<string> {
  const openai = getOpenAIClient();
  const response = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const text = response.choices[0]?.message?.content;
  if (!text || text.trim() === "") {
    throw new Error("La respuesta de OpenAI vino vacía.");
  }
  return text;
}
