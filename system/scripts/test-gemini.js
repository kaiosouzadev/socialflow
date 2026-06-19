const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", "web", ".env") });

const KEY = process.env.GEMINI_API_KEY;
const BASE = "https://generativelanguage.googleapis.com/v1beta";

async function tryModel(model, json = false) {
  const body = {
    contents: [{ role: "user", parts: [{ text: json ? 'Responda em JSON {"ok":true}' : "Diga: funcionando" }] }],
    generationConfig: { temperature: 0.2, ...(json ? { responseMimeType: "application/json" } : {}) },
  };
  const res = await fetch(`${BASE}/models/${model}:generateContent?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) return { model, ok: false, status: res.status, detail: text.slice(0, 200) };
  const data = JSON.parse(text);
  const out = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  return { model, ok: true, out: out.slice(0, 80) };
}

(async () => {
  if (!KEY) {
    console.log("GEMINI_API_KEY não configurada");
    process.exit(1);
  }
  const candidates = [
    process.env.GEMINI_CAPTION_MODEL || "gemini-2.5-flash",
    process.env.GEMINI_CALENDAR_MODEL || "gemini-3.5-flash",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
  ];
  const seen = new Set();
  for (const m of candidates) {
    if (seen.has(m)) continue;
    seen.add(m);
    try {
      const r = await tryModel(m, m.includes("calendar") ? false : false);
      console.log(JSON.stringify(r));
    } catch (e) {
      console.log(JSON.stringify({ model: m, ok: false, error: e.message }));
    }
  }
})();
