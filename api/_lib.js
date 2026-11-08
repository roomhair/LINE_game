// Claude API 共通処理（ファイル名が _ で始まるので Vercel の関数としては公開されない）
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.LINE_GAME_MODEL || "claude-opus-5-5";
export const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client;
const getClient = () => (client ??= new Anthropic());

// JSONスキーマで出力を固定して1回だけ呼び出す
export async function askJSON({ system, prompt, schema, maxTokens = 2000 }) {
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") throw new Error("refusal");
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("empty response");
  return JSON.parse(text);
}

export function readBody(req) {
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  return body;
}

export const cut = (s, n) => String(s ?? "").slice(0, n);

export function sendError(res, status, message) {
  res.status(status).json({ error: message });
}
