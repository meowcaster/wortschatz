import { redis, verifyToken, bearer } from '../lib/store.js';

// "Talk with Lena" — AI German conversation tutor on NVIDIA NIM (OpenAI-compatible, free tier).
// Two models: a fast one writes Lena's replies so the chat flows; an accurate one checks the
// learner's German, estimates their level, translates, gives hints and reviews sessions.
// GET  -> {ok, configured}  (health check, no auth)
// POST -> {mode: reply|check|translate|hint|review, ...}  (requires a signed-in Bearer token)
export const maxDuration = 60;

const NV_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const FAST = process.env.TUTOR_FAST_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b';
const SMART = process.env.TUTOR_SMART_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b';
const DAILY_CAP = 600;

const LANGS = { en: 'English', ar: 'Arabic (العربية)', es: 'Spanish (español)', fr: 'French (français)',
  tr: 'Turkish (Türkçe)', ru: 'Russian (русский)', pt: 'Brazilian Portuguese (português do Brasil)' };
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const SCENARIOS = {
  free: 'a relaxed free conversation; follow the learner\'s interests and ask about their life',
  day: 'the learner tells you about their day; ask friendly follow-up questions',
  cafe: 'you are a friendly waiter in a café and the learner orders food and drinks (use "Sie")',
  shop: 'you are a shop assistant in a supermarket helping the learner find things and pay (use "Sie")',
  doctor: 'you are a doctor\'s receptionist and then the doctor; the learner describes symptoms (use "Sie")',
  work: 'you are a colleague chatting during a break at work; small talk about work and plans',
  interview: 'you are an interviewer in a job interview; ask typical interview questions (use "Sie")',
  flat: 'you are a landlord; the learner is viewing an apartment and asks questions (use "Sie")',
  travel: 'you are a helpful local; the learner asks for directions and travel tips',
};
const ERR_TYPES = ['word order', 'case', 'article', 'verb', 'adjective ending', 'spelling', 'word choice', 'other'];

const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const lang = (ui) => LANGS[ui] || LANGS.en;
const level = (l) => (LEVELS.includes(l) ? l : 'B1');

function cleanHistory(h) {
  if (!Array.isArray(h)) return [];
  return h.slice(-12)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.text)
    .map((m) => ({ role: m.role, content: clip(m.text, 600) }));
}

async function nv(model, messages, { max_tokens = 500, temperature = 0.3, timeout = 40000 } = {}) {
  const key = process.env.NVIDIA_KEY || process.env.NVIDIA_API_KEY;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(NV_URL, {
      method: 'POST', signal: ctl.signal,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, max_tokens, temperature, chat_template_kwargs: { enable_thinking: false } }),
    });
    if (!r.ok) throw new Error('nv-' + r.status);
    const j = await r.json();
    return String(j.choices?.[0]?.message?.content || '');
  } finally { clearTimeout(t); }
}
function parseJSON(text) {
  let s = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}
// Ask the preferred model for JSON; on failure or unusable output, try the other one.
async function ask(primary, messages, opts, valid) {
  const order = primary === SMART ? [SMART, FAST] : [FAST, SMART];
  for (const model of order) {
    try {
      const out = parseJSON(await nv(model, messages, { ...opts, timeout: model === SMART ? 40000 : 15000 }));
      if (out && valid(out)) return { out, model };
    } catch (_) { /* try next model */ }
  }
  return null;
}
// Plain-text variant (for Lena's chat replies): tolerant of stray JSON, quotes or a "Lena:" prefix.
function cleanReply(text) {
  let s = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (s.startsWith('{')) { const o = parseJSON(s); if (o && typeof o.reply === 'string') s = o.reply; }
  s = s.replace(/^```\w*\s*|```$/g, '').replace(/^(Lena|Assistant)\s*:\s*/i, '').trim();
  if (/^["„“].*["“”]$/s.test(s)) s = s.slice(1, -1).trim();
  return s;
}
async function askText(primary, messages, opts) {
  const order = primary === SMART ? [SMART, FAST] : [FAST, SMART];
  for (const model of order) {
    try {
      const out = cleanReply(await nv(model, messages, { ...opts, timeout: model === SMART ? 40000 : 15000 }));
      if (out) return { out, model };
    } catch (_) { /* try next model */ }
  }
  return null;
}
const langRule = (ui) => `LANGUAGE RULE: every explanation/translation field MUST be written in ${lang(ui)} (German example words inside it are fine). Never write those fields in another language.`;

// ---------- modes ----------
async function reply(p) {
  const sys = `You are "Lena", a warm, encouraging German conversation partner in a language-learning app.
Scenario: ${SCENARIOS[p.scenario] || SCENARIOS.free}.
The learner's level is about ${level(p.level)}. Write natural, everyday German pitched slightly above that level.
Reply with 1-3 short sentences and keep the conversation going (usually end with a question). Stay in the scenario.
Never correct the learner or explain grammar — another teacher does that separately. If the learner writes in another language, answer in simple German and gently encourage German.
Answer with ONLY your German message — no quotes, no name prefix, no JSON, no translation.`;
  const r = await askText(FAST, [{ role: 'system', content: sys }, ...cleanHistory(p.history)], { max_tokens: 260, temperature: 0.7 });
  return r && { reply: clip(r.out, 800), model: r.model };
}

async function check(p) {
  const sys = `You are an expert German teacher. Check the learner's German message for real mistakes (grammar, case/article, word order, verb form, adjective ending, spelling, wrong word). Ignore punctuation and capitalisation at the start. Consider the conversation context: ${clip(p.context, 300) || '(none)'}.
Estimate the learner's CEFR level from this message (score 1.0-6.0: A1=1, A2=2, B1=3, B2=4, C1=5, C2=6). Very short answers ("Ja", "Danke") show little — then score near their current level ${level(p.level)}.
Return ONLY JSON: {"correction":"the whole message corrected, or empty string if it is already correct","errors":[{"type":"${ERR_TYPES.join('|')}","wrong":"exact wrong part","right":"fixed part","why":"very short explanation"}],"level":"B1","score":3.1}
Only list real mistakes; never list a part that is already correct. Max 6 errors.
${langRule(p.ui)}`;
  const r = await ask(SMART, [{ role: 'system', content: sys }, { role: 'user', content: clip(p.text, 600) }],
    { max_tokens: 700, temperature: 0.2 }, (o) => Array.isArray(o.errors) || typeof o.correction === 'string');
  if (!r) return null;
  const o = r.out;
  const errors = (Array.isArray(o.errors) ? o.errors : []).slice(0, 6).map((e) => ({
    type: ERR_TYPES.includes(e && e.type) ? e.type : 'other',
    wrong: clip(e && e.wrong, 120), right: clip(e && e.right, 120), why: clip(e && e.why, 300),
  })).filter((e) => e.wrong && e.right && e.wrong.trim() !== e.right.trim());
  let score = Number(o.score);
  if (!(score >= 1 && score <= 6)) score = LEVELS.indexOf(level(o.level)) + 1;
  return { correction: errors.length ? clip(o.correction, 800) : '', errors, level: level(o.level), score, model: r.model };
}

async function translate(p) {
  const sys = `Translate the German text into ${lang(p.ui)}, naturally and accurately. Return ONLY JSON: {"tr":"translation"}. ${langRule(p.ui)}`;
  const r = await ask(SMART, [{ role: 'system', content: sys }, { role: 'user', content: clip(p.text, 800) }],
    { max_tokens: 400, temperature: 0.2 }, (o) => typeof o.tr === 'string' && o.tr.trim());
  return r && { tr: clip(r.out.tr.trim(), 1200), model: r.model };
}

async function hint(p) {
  const sys = `You help a German learner (level about ${level(p.level)}) who is stuck in a conversation. Scenario: ${SCENARIOS[p.scenario] || SCENARIOS.free}.
Suggest 3 different natural things the learner could say next in reply to the last message, at their level, each with a translation.
Every suggestion must be grammatically perfect German: double-check verb agreement (e.g. "hier sind 20 Euro"), case, gender and word order before answering.
Return ONLY JSON: {"suggestions":[{"de":"German sentence","tr":"translation"}]}
${langRule(p.ui)}`;
  const r = await ask(SMART, [{ role: 'system', content: sys }, ...cleanHistory(p.history)],
    { max_tokens: 500, temperature: 0.6 }, (o) => Array.isArray(o.suggestions) && o.suggestions.length);
  return r && { suggestions: r.out.suggestions.slice(0, 3).map((s) => ({ de: clip(s && s.de, 300), tr: clip(s && s.tr, 300) })).filter((s) => s.de), model: r.model };
}

async function review(p) {
  const said = (Array.isArray(p.said) ? p.said : []).slice(-30).map((s) => '- ' + clip(s, 300)).join('\n');
  const stats = Object.entries(p.mistakes && typeof p.mistakes === 'object' ? p.mistakes : {})
    .filter(([k]) => ERR_TYPES.includes(k)).map(([k, v]) => `${k}: ${Number(v) || 0}`).join(', ');
  const errs = (Array.isArray(p.errs) ? p.errs : []).slice(-25)
    .map((e) => `- [${clip(e && e.type, 20)}] "${clip(e && e.wrong, 80)}" -> "${clip(e && e.right, 80)}"`).join('\n');
  const sys = `You are an encouraging German teacher reviewing a learner's recent conversation practice.
Their messages:\n${said || '(none)'}\nTheir actual mistakes (already verified by a teacher):\n${errs || '(none)'}\nMistake counts overall: ${stats || 'none recorded'}. Current estimate: ${level(p.level)}.
Give an honest assessment that helps them improve fast. Base strengths and focus areas ONLY on this evidence — never invent a mistake they did not make, and never state a grammar rule you are not sure of.
Return ONLY JSON: {"level":"B1","score":3.2,"summary":"a two-sentence overall assessment of their German","strengths":["..."],"focus":["most important thing to practise", "..."],"tip":"one concrete exercise for this week","words":[{"de":"useful word or phrase","tr":"meaning"}]}
strengths max 3, focus max 3, words max 5.
${langRule(p.ui)}`;
  const r = await ask(SMART, [{ role: 'system', content: sys }, { role: 'user', content: 'Please review my German.' }],
    { max_tokens: 900, temperature: 0.4 }, (o) => typeof o.summary === 'string');
  if (!r) return null;
  const o = r.out, arr = (a, n, m) => (Array.isArray(a) ? a : []).slice(0, n).map((x) => clip(x, m)).filter(Boolean);
  let score = Number(o.score); if (!(score >= 1 && score <= 6)) score = LEVELS.indexOf(level(o.level)) + 1;
  return { level: level(o.level), score, summary: clip(o.summary, 600), strengths: arr(o.strengths, 3, 300), focus: arr(o.focus, 3, 300),
    tip: clip(o.tip, 400), words: (Array.isArray(o.words) ? o.words : []).slice(0, 5).map((w) => ({ de: clip(w && w.de, 80), tr: clip(w && w.tr, 160) })).filter((w) => w.de),
    model: r.model };
}

const MODES = { reply, check, translate, hint, review };

export default async function handler(req, res) {
  const configured = !!(process.env.NVIDIA_KEY || process.env.NVIDIA_API_KEY);
  if (req.method === 'GET') return res.status(200).json({ ok: true, configured });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const id = verifyToken(bearer(req));
  if (!id) return res.status(401).json({ error: 'Not signed in.' });
  if (!configured) return res.status(503).json({ error: 'tutor-not-configured' });

  const p = req.body || {};
  const fn = MODES[p.mode];
  if (!fn) return res.status(400).json({ error: 'Unknown mode.' });

  // Per-user daily cap so a leaked token can't drain the free NVIDIA quota.
  try {
    const day = new Date().toISOString().slice(0, 10);
    const k = `tutor:${id}:${day}`;
    const n = await redis(['INCR', k]);
    if (n === 1) await redis(['EXPIRE', k, 172800]);
    if (n > DAILY_CAP) return res.status(429).json({ error: 'daily-limit' });
  } catch (_) { /* storage hiccup: don't block practice */ }

  try {
    const out = await fn(p);
    if (!out) return res.status(502).json({ error: 'ai-unavailable' });
    return res.status(200).json({ ok: true, ...out });
  } catch (e) {
    return res.status(500).json({ error: 'Server error.' });
  }
}
