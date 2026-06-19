const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "..", "..", "web", ".env") });

const SA_FILE = path.resolve(path.join(__dirname, "..", "..", "web"), process.env.GOOGLE_SERVICE_ACCOUNT_FILE);
const ROOT = process.env.DRIVE_ROOT_FOLDER_ID;

async function token() {
  const sa = JSON.parse(fs.readFileSync(SA_FILE, "utf8"));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const sig = crypto.createSign("RSA-SHA256").update(input).sign(sa.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${input}.${sig}` }) });
  return (await res.json()).access_token;
}
async function api(tk, pathUrl) {
  const res = await fetch("https://www.googleapis.com/drive/v3/" + pathUrl, { headers: { Authorization: `Bearer ${tk}` } });
  return res.json();
}

(async () => {
  const tk = await token();
  // 1) nome do ID configurado como ROOT
  const meta = await api(tk, `files/${ROOT}?fields=id,name,mimeType&supportsAllDrives=true`);
  console.log("ROOT id =>", JSON.stringify(meta));

  // 2) todas as pastas que a SA enxerga
  const folders = await api(tk, "files?q=" + encodeURIComponent("mimeType='application/vnd.google-apps.folder' and trashed=false") + "&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=100");
  console.log("\nPastas visíveis para a service account:");
  (folders.files || []).forEach((f) => console.log(`  - ${f.name}  [${f.id}]`));

  // 3) todos os arquivos visíveis (para entender a hierarquia)
  const all = await api(tk, "files?q=" + encodeURIComponent("trashed=false") + "&fields=files(id,name,mimeType,parents)&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=100");
  console.log("\nTodos os itens visíveis (nome | tipo | parents):");
  (all.files || []).forEach((f) => console.log(`  - ${f.name} | ${f.mimeType.includes("folder") ? "pasta" : "arquivo"} | ${(f.parents || []).join(",")}`));
})().catch((e) => console.error("ERRO:", e.message));
