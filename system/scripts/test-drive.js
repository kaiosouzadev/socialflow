// Testa a conexão com o Google Drive via service account:
// autentica, lista a pasta raiz, acha o cliente → mês → imagem.
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "..", "..", "web", ".env") });

const SA_FILE = path.resolve(
  path.join(__dirname, "..", "..", "web"),
  process.env.GOOGLE_SERVICE_ACCOUNT_FILE
);
const ROOT = process.env.DRIVE_ROOT_FOLDER_ID;

async function token() {
  const sa = JSON.parse(fs.readFileSync(SA_FILE, "utf8"));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = crypto.createSign("RSA-SHA256").update(input).sign(sa.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${input}.${sig}`,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("auth: " + JSON.stringify(data));
  return data.access_token;
}

async function list(tk, q) {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", q);
  url.searchParams.set("fields", "files(id,name,mimeType)");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tk}` } });
  const data = await res.json();
  if (!res.ok) throw new Error("list: " + JSON.stringify(data));
  return data.files || [];
}

(async () => {
  console.log("SA file:", SA_FILE);
  console.log("ROOT:", ROOT);
  const tk = await token();
  console.log("✓ autenticado");

  const clients = await list(tk, `'${ROOT}' in parents and trashed=false`);
  console.log("\nConteúdo da pasta raiz:");
  clients.forEach((f) => console.log("  -", f.name, `(${f.mimeType.includes("folder") ? "pasta" : "arquivo"})`));

  if (clients[0]) {
    const cli = clients[0];
    const months = await list(tk, `'${cli.id}' in parents and trashed=false`);
    console.log(`\nDentro de "${cli.name}":`);
    months.forEach((f) => console.log("  -", f.name));

    if (months[0]) {
      const imgs = await list(tk, `'${months[0].id}' in parents and trashed=false`);
      console.log(`\nDentro de "${months[0].name}":`);
      imgs.forEach((f) => console.log("  -", f.name, `(${f.mimeType})`));
    }
  }
})().catch((e) => console.error("ERRO:", e.message));
