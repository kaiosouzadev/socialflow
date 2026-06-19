const { z } = require("zod");

const createSchema = z.object({
  clientId: z.string().uuid(),
  theme: z.string().optional(),
  caption: z.string().optional(),
  mediaUrl: z.string().url().optional().or(z.literal("")),
  scheduledAt: z.string().datetime(),
  targets: z.array(z.enum(["instagram", "facebook", "linkedin"])).min(1),
});

const payloads = {
  "com mídia + datetime-local convertido": {
    clientId: "11111111-1111-1111-1111-111111111111",
    theme: "Teste",
    caption: "legenda",
    mediaUrl: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1080",
    scheduledAt: new Date("2026-06-17T20:00").toISOString(),
    targets: ["instagram", "facebook"],
  },
  "sem mídia (string vazia)": {
    clientId: "11111111-1111-1111-1111-111111111111",
    theme: "",
    caption: "",
    mediaUrl: "",
    scheduledAt: new Date().toISOString(),
    targets: ["instagram"],
  },
};

for (const [name, p] of Object.entries(payloads)) {
  const r = createSchema.safeParse(p);
  console.log(`\n[${name}] => ${r.success ? "OK" : "FALHOU"}`);
  if (!r.success) console.log(JSON.stringify(r.error.issues, null, 2));
}
