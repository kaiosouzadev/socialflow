const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", "web", ".env") });

const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_CALENDAR_MODEL || "gemini-3.5-flash";
const BASE = "https://generativelanguage.googleapis.com/v1beta";

const targets = ["instagram", "facebook"];
const n = 3;
const captionKeys = targets.map((t) => `"${t}":"<legenda ${t}>"`).join(",");
const prompt = [
  "Cliente: Cliente Teste.",
  "Tom de voz: profissional e próximo, foco em seguros.",
  "Mês de referência: julho de 2026.",
  `Plataformas: ${targets.join(", ")}.`,
  `Gere EXATAMENTE ${n} ideias de post para o mês, variando os tipos de conteúdo `,
  "(educativo, bastidores, promocional). Evite repetir temas. ",
  "Para cada post forneça: theme, format (feed/carrossel/reels/story) e captions (uma por rede). ",
  `Responda em JSON: {"posts":[{"theme":"...","format":"...","captions":{${captionKeys}}}]} com ${n} itens.`,
].join("");

(async () => {
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: "Responda SOMENTE com JSON válido." }] },
    generationConfig: { temperature: 0.9, responseMimeType: "application/json" },
  };
  const res = await fetch(`${BASE}/models/${MODEL}:generateContent?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  console.log("HTTP", res.status, "model", MODEL);
  if (!res.ok) {
    console.log("ERRO:", txt.slice(0, 400));
    return;
  }
  const data = JSON.parse(txt);
  const raw = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  console.log("RAW (200 chars):", raw.slice(0, 200));
  const parsed = JSON.parse(raw);
  const posts = Array.isArray(parsed) ? parsed : parsed.posts;
  console.log("posts.length:", posts?.length);
  console.log("primeiro item:", JSON.stringify(posts?.[0], null, 2));
})().catch((e) => console.log("EXCEPTION:", e.message));
