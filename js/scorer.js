// ローカル採点（AIが使えないときのフォールバック）
// 4項目 × 25点 = 100点満点: 面白さ / 気の利き / 意外性 / 空気読み

const HUMOR = /(w{2,}|ｗ|笑|草|やねん|なんで|どういう|おい|いや|まさか|逆に|むしろ|天才|伝説|事件|ワロ|爆|！？|!\?|まじか|嘘だろ|さすが|勝ち|負け|優勝|ありえ)/g;
const WIT = /(しよう|しよ|して|すれば|したら|おすすめ|作戦|まず|とりあえず|一緒に|わかる|大丈夫|えらい|おつかれ|お疲れ|ドンマイ|任せ|奢|おごる|行こ|やろ|かな|かも|ね[！!。]?$|？|\?)/g;
const GENERIC = /^(了解|りょ|りょうかい|わかった|おk|ok|おけ|いいね|うん|はい|草|笑|w+|ｗ+|それな|なるほど|たしかに|そうだね|ほんとそれ|へー|ふーん|。+|…+)[!！。w笑]*$/i;
const EMOJI = /\p{Extended_Pictographic}/gu;
const KATAKANA = /[ァ-ヴー]{3,}/g;
const NUMBER = /[0-9０-９一二三四五六七八九十百千万億]+/g;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const count = (s, re) => (s.match(re) || []).length;
const jitter = () => Math.round((Math.random() - 0.5) * 4);

export function localScore({ reply, scenarioText, keywords, previousReplies }) {
  const text = reply.trim();
  const len = [...text].length;

  if (len === 0) return finish(0, 0, 0, 0, "空っぽの返信…既読スルーと同じ扱いです");
  if (GENERIC.test(text)) return finish(5, 4, 2, 9, "無難すぎる！もうひとボケほしいところ");

  // 空気読み：話題のキーワードに乗れているか
  let fit = 10;
  const hits = keywords.filter((k) => k && text.includes(k)).length;
  fit += Math.min(12, hits * 5);
  if (len >= 6 && len <= 80) fit += 3;
  if (len > 140) fit -= 4;
  if (scenarioText.includes(text) && len > 4) fit -= 6;

  // 面白さ
  let humor = 6 + Math.min(10, count(text, HUMOR) * 4);
  humor += Math.min(4, count(text, EMOJI) * 2);
  if (/[!！]/.test(text)) humor += 2;
  if (len >= 15) humor += 2;

  // 気の利き
  let wit = 8 + Math.min(12, count(text, WIT) * 3);
  if (/[、。]/.test(text) && len >= 12) wit += 2;

  // 意外性：会話に出てこない言葉・数字・カタカナ語・文字のバリエーション
  let surprise = 7;
  const uniq = new Set([...text]).size;
  surprise += Math.min(8, Math.floor(uniq / 4));
  surprise += Math.min(4, count(text, NUMBER) * 2);
  surprise += Math.min(4, count(text, KATAKANA) * 2);
  const novel = [...text].filter((ch) => !scenarioText.includes(ch)).length / Math.max(1, len);
  surprise += Math.round(novel * 6);

  // ほぼ短文は全体的に控えめ
  if (len < 5) { humor -= 4; wit -= 4; surprise -= 4; }

  // 同じような返信の使い回しは減点
  const repeated = previousReplies.some((p) => p && (p === text || (len > 6 && (p.includes(text) || text.includes(p)))));
  const factor = repeated ? 0.5 : 1;

  return finish(
    Math.round(clamp(humor + jitter(), 0, 25) * factor),
    Math.round(clamp(wit + jitter(), 0, 25) * factor),
    Math.round(clamp(surprise + jitter(), 0, 25) * factor),
    Math.round(clamp(fit + jitter(), 0, 25) * factor),
    repeated ? "前と同じネタはバレてます…！" : null,
  );
}

function finish(humor, wit, surprise, fit, comment) {
  const score = humor + wit + surprise + fit;
  return { humor, wit, surprise, fit, score, comment: comment || pickComment(score, { humor, wit, surprise, fit }) };
}

function pickComment(score, parts) {
  const best = Object.entries(parts).sort((a, b) => b[1] - a[1])[0][0];
  const byBest = {
    humor: "笑いのセンスが光ってる！",
    wit: "気配りが効いてて好感度高め！",
    surprise: "その角度からくるとは…！",
    fit: "会話の流れにぴったり！",
  };
  if (score >= 80) return `神返信！${byBest[best]}`;
  if (score >= 60) return `ナイス返し。${byBest[best]}`;
  if (score >= 40) return "悪くない！もうひと押し攻めてもよかったかも";
  return "ちょっと伝わりにくかったかも。次はもっと大胆に！";
}

const REACTIONS = {
  high: ["それは天才すぎるwww", "腹筋崩壊したんだけどw", "それ採用！！", "ちょっと待って最高", "{me}にしか出せない返しw", "スクショした", "今年一笑った", "優勝🏆"],
  mid: ["なるほどねw", "ありかも", "{me}らしいわ", "それはそれでアリ", "ちょっと笑ったw", "たしかにw", "そうきたか"],
  low: ["……え？", "既読スルーしかけたわ", "どういうこと？w", "{me}、眠い？", "もうちょい頑張ろうか", "それは…うん"],
};

export function localReactions(score, members) {
  const pool = score >= 70 ? REACTIONS.high : score >= 45 ? REACTIONS.mid : REACTIONS.low;
  const n = score >= 70 ? 2 + (Math.random() < 0.5 ? 1 : 0) : 1 + (Math.random() < 0.5 ? 1 : 0);
  const speakers = [...members].sort(() => Math.random() - 0.5).slice(0, Math.min(n, members.length));
  const texts = [...pool].sort(() => Math.random() - 0.5);
  return speakers.map((m, i) => ({ name: m.name, text: texts[i % texts.length] }));
}
