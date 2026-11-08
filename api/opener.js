// グループ名とメンバーから、毎回ちがう会話の書き出しを生成する
import { askJSON, hasKey, readBody, cut, sendError } from "./_lib.js";

const SYSTEM = `あなたは「今日のLINEゲーム」の会話シナリオ作家です。
指定されたLINEグループで、友人たちがプレイヤーに返信を求める会話の書き出しを作ってください。

- 2〜4件のメッセージ。各メッセージは30字以内の自然な口語LINE。
- name は与えられたメンバー名から選ぶ。
- ちょっと変わった出来事や、ボケ・大喜利の余地があるお題にする（毎回ちがう意外な状況を）。
- 最後のメッセージで、プレイヤー（{me} と書く）に返信・意見・アイデアを求める。
- keywords には会話の重要な単語を3〜5個。
- 誰かを傷つける話題や露骨な内容は避ける。`;

const ADULT_RULE = `
- このグループは成人どうしの下ネタOKグループ。言葉遊び・勘違い・あるあるで笑える、ギリギリだが露骨ではないお題にする。
  直接的な性描写、未成年、実在の人物は絶対に扱わない。`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["messages", "keywords"],
  properties: {
    messages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "text"],
        properties: { name: { type: "string" }, text: { type: "string" } },
      },
    },
    keywords: { type: "array", items: { type: "string" } },
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return sendError(res, 405, "POST only");
  if (!hasKey()) return sendError(res, 503, "AI is not configured");

  let body;
  try { body = readBody(req); } catch { return sendError(res, 400, "bad json"); }
  const members = (Array.isArray(body.members) ? body.members : []).slice(0, 6).map((m) => cut(m, 20));
  if (members.length === 0) return sendError(res, 400, "missing members");

  const avoid = (Array.isArray(body.avoid) ? body.avoid : []).slice(0, 8).map((s) => `- ${cut(s, 60)}`).join("\n");
  const prompt = `グループ名: ${cut(body.group, 40)}
メンバー: ${members.join("、")}
${avoid ? `\nこのゲームで既に出たお題（似せない）:\n${avoid}` : ""}`;

  try {
    const out = await askJSON({ system: body.adult ? SYSTEM + ADULT_RULE : SYSTEM, prompt, schema: SCHEMA, maxTokens: 1500 });
    const messages = (out.messages || []).slice(0, 4).map((m, i) => ({
      name: members.includes(m.name) ? m.name : members[i % members.length],
      text: cut(m.text, 80),
    }));
    if (messages.length < 2) throw new Error("too short");
    res.status(200).json({ messages, keywords: (out.keywords || []).slice(0, 6).map((k) => cut(k, 20)) });
  } catch (err) {
    console.error("opener failed:", err?.message);
    sendError(res, 502, "opener failed");
  }
}
