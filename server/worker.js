// Anara tour guide brain: picks the best recorded lines for a visitor's question. The Gemini key lives in the GEMINI_KEY secret.
const ORIG = ["https://yovi-tours.github.io"];
const BANK_URL = "https://yovi-tours.github.io/anara-type-a-360/ai_bank.json";
let BANK = null, BANK_T = 0;
async function bank() {
  if (BANK && Date.now() - BANK_T < 3600e3) return BANK;
  const r = await fetch(BANK_URL, { cf: { cacheTtl: 600 } });
  BANK = await r.json(); BANK_T = Date.now(); return BANK;
}
function scrub(t) { return String(t || "").replace(/\S+@\S+/g, "[email]").replace(/[+\d\u0660-\u0669][\d\u0660-\u0669 -]{5,}/g, "[number]") }
async function report(req, env) {
  const days = Math.min(90, +new URL(req.url).searchParams.get("days") || 7), since = Date.now() - days * 86400e3;
  const rows = [], fb = {}; let cur;
  do { const r = await env.LOGS.list({ prefix: "q:", cursor: cur, limit: 1000 });
    for (const k of r.keys) { const t = parseInt(k.name.split(":")[1], 36); if (t >= since) rows.push({ t: new Date(t).toISOString().slice(0, 16), id: k.name.split(":")[2], ...(k.metadata || {}) }) }
    cur = r.list_complete ? null : r.cursor } while (cur && rows.length < 5000);
  cur = undefined;
  do { const r = await env.LOGS.list({ prefix: "f:", cursor: cur, limit: 1000 }); for (const k of r.keys) fb[k.name.slice(2)] = (k.metadata || {}).v; cur = r.list_complete ? null : r.cursor } while (cur);
  for (const x of rows) if (fb[x.id]) x.fb = fb[x.id];
  const n = rows.length, c = s => rows.filter(x => x.s === s).length;
  const sum = { days, questions: n, rule: c("rule"), ai: c("ai"), unknown: c("unk"), offtopic: c("off"), up: rows.filter(x => x.fb === 1).length, down: rows.filter(x => x.fb === -1).length };
  return new Response(JSON.stringify({ sum, rows }, null, 1), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
export default {
  async fetch(req, env) {
    const o = req.headers.get("Origin") || "";
    const ok = ORIG.includes(o) || o.startsWith("http://localhost");
    const H = { "Access-Control-Allow-Origin": ok ? o : ORIG[0], "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
    if (req.method === "OPTIONS") return new Response(null, { headers: H });
    const P = new URL(req.url).pathname;
    if (P === "/report" && req.method === "GET") return report(req, env);
    if (req.method !== "POST" || !ok) return new Response('{"error":"forbidden"}', { status: 403, headers: H });
    if (P === "/log" || P === "/fb") {
      const b = await req.json().catch(() => ({})), id = String(b.id || "").replace(/[^a-z0-9]/gi, "").slice(0, 16);
      if (!id || !env.LOGS) return new Response("{}", { headers: H });
      const ttl = { expirationTtl: 90 * 86400 };
      if (P === "/fb") await env.LOGS.put("f:" + id, "", { ...ttl, metadata: { v: b.v > 0 ? 1 : -1 } });
      else await env.LOGS.put("q:" + Date.now().toString(36) + ":" + id, "", { ...ttl, metadata: {
        q: scrub(b.q).slice(0, 220), l: b.lang === "en" ? "en" : "ar", r: String(b.room || "").slice(0, 30),
        s: String(b.src || "").slice(0, 6), k: String(b.key || "").slice(0, 40), a: scrub(b.a).slice(0, 90) } });
      return new Response("{}", { headers: H });
    }
    const ip = req.headers.get("CF-Connecting-IP") || "x", c = caches.default;
    const rk = new Request("https://rl.local/" + ip + "/" + Math.floor(Date.now() / 60000));
    let n = 0; const hit = await c.match(rk); if (hit) n = +(await hit.text());
    if (n >= 40) return new Response('{"error":"slow down"}', { status: 429, headers: H });
    await c.put(rk, new Response(String(n + 1), { headers: { "Cache-Control": "max-age=70" } }));
    const b = await req.json().catch(() => ({}));
    const q = String(b.q || "").slice(0, 300), L = b.lang === "en" ? "en" : "ar", room = String(b.room || "").slice(0, 40);
    const hist = Array.isArray(b.hist) ? b.hist.slice(-4) : [], hint = String(b.hint || "").slice(0, 60);
    if (!q) return new Response('{"keys":[]}', { headers: H });
    const ck = new Request("https://ans.local/v2/" + L + "/" + encodeURIComponent(room + "|" + q.toLowerCase().replace(/[\s?؟.!،,]+/g, " ").trim() + "|" + (hist.length ? String(hist[hist.length - 1].t || "").slice(0, 60) : "")));
    const cached = await c.match(ck); if (cached) return new Response(await cached.text(), { headers: H });
    const B = await bank(), lines = B.lines[L], rooms = B.rooms;
    const sys = "You are the brain of the voice guide inside a 360-degree tour of Villa Type A at Anara, Riyadh. The guide can ONLY speak the pre-recorded lines listed below. " +
      "Choose the 1 to 3 line keys that best answer the visitor's last message, in the order they should be spoken. Prefer one precise line. Never combine lines that repeat each other. " +
      "If the visitor asks to see, go to or be shown a place, also set go to that room id. Use the conversation to resolve words like it, there, them. " +
      "The visitor may write in any Arabic dialect (Najdi, Hijazi, Eastern Saudi, Gulf, Egyptian, Levantine, Yemeni, Sudanese, Iraqi) or English, with typos. " +
      "Answer the real intent and the visitor's situation (family, parents, guests, work, budget), not just the words. Use go only when the visitor wants to see or be taken somewhere, or when showing a place is clearly the best answer. " +
      "Lines that hand over to the sales team are right for price, payment, handover, availability, plots, legal and anything the plans cannot answer. " +
      "If the visitor wants to see or reach a place that has no matching line, return an empty keys list with go set. Never claim something is near, available or included unless a line says so. " +
      "For counts (how many bathrooms, rooms, floors) use the summary lines such as baths, beds, fl0, fl1, fl2, never several dim_ lines. Return at least one key whenever any line is partly relevant; an empty list is only allowed together with go. If no line truly answers, return keys [\"unknown\"]. Current room: " + room + "." + (hint ? " A simple keyword matcher guessed the line " + hint + "; it is often wrong for long questions, use it only if it truly fits." : "") + "\nLINES (key: text)\n" +
      Object.entries(lines).map(([k, v]) => k + ": " + v.slice(0, 130)).join("\n") + "\nROOMS (id: name)\n" + rooms.map(r => r.id + ": " + r[L]).join("\n");
    const contents = hist.map(h => ({ role: h.r === "a" ? "model" : "user", parts: [{ text: String(h.t || "").slice(0, 400) }] }));
    contents.push({ role: "user", parts: [{ text: q }] });
    const body = { systemInstruction: { parts: [{ text: sys }] }, contents,
      generationConfig: { temperature: 0, maxOutputTokens: 200, responseMimeType: "application/json",
        responseSchema: { type: "OBJECT", properties: { keys: { type: "ARRAY", items: { type: "STRING" } }, go: { type: "STRING" } }, required: ["keys"] } } };
    const models = [env.MODEL, "gemini-flash-lite-latest", "gemini-flash-lite-latest"].filter(Boolean);
    let out = { keys: ["unknown"] };
    for (const model of models) {
      try {
        const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 3500);
        const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", { method: "POST", signal: ac.signal, headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_KEY }, body: JSON.stringify(body) });
        clearTimeout(tm);
        const j = await r.json();
        if (j.error) { out.err = model + ": " + j.error.message; continue }
        out = JSON.parse(j.candidates[0].content.parts[0].text); out.model = model; break;
      } catch (e) { out.err = model + ": " + String(e).slice(0, 160) }
    }
    out.keys = (out.keys || []).filter(k => lines[k]).slice(0, 3);
    if (out.go && !rooms.find(x => x.id === out.go)) delete out.go;
    const res = JSON.stringify(out);
    if (!out.err && out.keys.length && out.keys[0] !== "unknown") await c.put(ck, new Response(res, { headers: { "Cache-Control": "max-age=86400" } }));
    return new Response(res, { headers: H });
  }
};
