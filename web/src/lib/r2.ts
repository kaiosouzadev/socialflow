import { createHash, createHmac } from "crypto";

/**
 * Upload mínimo para o Cloudflare R2 via API S3 (SigV4 assinado com node:crypto,
 * sem depender do SDK da AWS). Usado para hospedar a mídia numa URL pública que
 * o Graph API da Meta consegue baixar diretamente do edge.
 *
 * Env necessárias: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * R2_BUCKET, R2_PUBLIC_BASE_URL.
 */

const REGION = "auto";
const SERVICE = "s3";

export function r2Configured(): boolean {
  return (
    !!process.env.R2_ACCOUNT_ID &&
    !!process.env.R2_ACCESS_KEY_ID &&
    !!process.env.R2_SECRET_ACCESS_KEY &&
    !!process.env.R2_BUCKET &&
    !!process.env.R2_PUBLIC_BASE_URL
  );
}

const sha256hex = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const hmac = (k: Buffer | string, d: string) => createHmac("sha256", k).update(d).digest();

function amzDate(): string {
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/**
 * Sobe um objeto para o R2 e devolve a URL pública (R2_PUBLIC_BASE_URL/key).
 * `key` não deve começar com barra (ex.: "clientId/postId.jpg").
 */
export async function uploadToR2(
  key: string,
  body: Buffer,
  contentType: string
): Promise<string> {
  const account = process.env.R2_ACCOUNT_ID!;
  const ak = process.env.R2_ACCESS_KEY_ID!;
  const sk = process.env.R2_SECRET_ACCESS_KEY!;
  const bucket = process.env.R2_BUCKET!;
  const pub = process.env.R2_PUBLIC_BASE_URL!.replace(/\/$/, "");
  const host = `${account}.r2.cloudflarestorage.com`;

  const now = amzDate();
  const date = now.slice(0, 8);
  const payloadHash = sha256hex(body);
  const canonicalUri = `/${bucket}/${key}`;
  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${now}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${date}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    now,
    scope,
    sha256hex(Buffer.from(canonicalRequest)),
  ].join("\n");

  const kSigning = hmac(
    hmac(hmac(hmac(`AWS4${sk}`, date), REGION), SERVICE),
    "aws4_request"
  );
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${host}${canonicalUri}`, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": now,
      "Content-Type": contentType,
    },
    body: new Uint8Array(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`R2 upload falhou: ${res.status} ${detail.slice(0, 200)}`);
  }
  return `${pub}/${key}`;
}

/** Deriva a key do objeto a partir da URL pública (R2_PUBLIC_BASE_URL/key). */
export function r2KeyFromUrl(url: string): string | null {
  const pub = process.env.R2_PUBLIC_BASE_URL;
  if (!pub) return null;
  const base = pub.replace(/\/$/, "") + "/";
  return url.startsWith(base) ? url.slice(base.length) : null;
}

/** Apaga um objeto do R2 (SigV4 DELETE). Idempotente: 404 não é erro. */
export async function deleteFromR2(key: string): Promise<void> {
  const account = process.env.R2_ACCOUNT_ID!;
  const ak = process.env.R2_ACCESS_KEY_ID!;
  const sk = process.env.R2_SECRET_ACCESS_KEY!;
  const bucket = process.env.R2_BUCKET!;
  const host = `${account}.r2.cloudflarestorage.com`;

  const now = amzDate();
  const date = now.slice(0, 8);
  const payloadHash = sha256hex(Buffer.from(""));
  const canonicalUri = `/${bucket}/${key}`;
  const canonicalHeaders =
    `host:${host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${now}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["DELETE", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const scope = `${date}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", now, scope, sha256hex(Buffer.from(canonicalRequest))].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${sk}`, date), REGION), SERVICE), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${host}${canonicalUri}`, {
    method: "DELETE",
    headers: {
      Authorization: authorization,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": now,
    },
  });
  if (!res.ok && res.status !== 404) {
    const detail = await res.text().catch(() => "");
    throw new Error(`R2 delete falhou: ${res.status} ${detail.slice(0, 200)}`);
  }
}
