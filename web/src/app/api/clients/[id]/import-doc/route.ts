import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { uuidString } from "@/lib/validators";
import { POST_FORMATS } from "@/lib/formats";
import {
  BRIEFING_FIELDS,
  IMPORT_SCHEDULE_STATUSES,
  IMPORT_TEXT_MAX_BYTES,
  ImportClientNotFoundError,
  POST_TARGETS,
  analyzeImport,
  commitImport,
} from "@/lib/doc-import-commit";
import { z } from "zod";

export const dynamic = "force-dynamic";

// o corpo leva o texto em JSON (quebras de linha e aspas viram escapes): folga de 2×
const MAX_BODY_BYTES = IMPORT_TEXT_MAX_BYTES * 2 + 64 * 1024;
const TOO_LARGE = "O texto do documento passa de 500 KB. Divida o documento e importe por partes.";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "horário no formato HH:mm");

const schema = z.object({
  mode: z.enum(["preview", "commit"]),
  // só texto: o .docx nunca é enviado ao servidor. Pode trazer credenciais: elas saem do
  // texto aqui, a prévia só devolve rede/login/"tem senha" e o commit grava cifrado
  text: z.string().min(1, "Cole o texto do documento"),
  refMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "mês no formato AAAA-MM"),
  options: z
    .object({
      defaultTimes: z.partialRecord(z.enum(POST_FORMATS), time).optional(),
      scheduleStatus: z.enum(IMPORT_SCHEDULE_STATUSES).optional(),
      exclude: z.array(z.number().int().positive()).max(1000).optional(),
      briefingFields: z.array(z.enum(BRIEFING_FIELDS)).max(BRIEFING_FIELDS.length * 2).optional(),
      targets: z.array(z.enum(POST_TARGETS)).min(1).optional(),
      // redes das credenciais do documento a gravar (os valores vêm do próprio texto, no servidor)
      credentials: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    })
    .optional(),
});

/** Lê o corpo com teto de tamanho (não carrega um corpo enorme na memória). */
async function readBodyCapped(req: NextRequest, max: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Importa o documento mensal da redação.
 * - `preview`: devolve o que seria gravado; não grava nada.
 * - `commit`: grava numa única transação (posts sempre rascunho); reimportar cria 0.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  if (!uuidString.safeParse(id).success) {
    return Response.json({ error: "ID inválido" }, { status: 400 });
  }

  const raw = await readBodyCapped(req, MAX_BODY_BYTES);
  if (raw === null) return Response.json({ error: TOO_LARGE }, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { mode, text, refMonth, options } = parsed.data;
  if (Buffer.byteLength(text, "utf8") > IMPORT_TEXT_MAX_BYTES) {
    return Response.json({ error: TOO_LARGE }, { status: 413 });
  }

  const input = { text, refMonth, options };
  try {
    if (mode === "preview") {
      const preview = await analyzeImport(id, input);
      return Response.json({ mode, ...preview });
    }
    const result = await commitImport(id, input);
    const createdAny = result.created.posts + result.created.pendingItems + result.created.schedules > 0;
    return Response.json({ mode, ...result }, { status: createdAny ? 201 : 200 });
  } catch (e) {
    if (e instanceof ImportClientNotFoundError) {
      return Response.json({ error: "Cliente não encontrado" }, { status: 404 });
    }
    // o texto do documento nunca vai para o log
    console.error("[import-doc]", mode, e instanceof Error ? e.message : e);
    return Response.json(
      {
        error:
          mode === "commit"
            ? "Não foi possível gravar a importação. Nada foi salvo; tente de novo."
            : "Não foi possível ler o documento. Tente de novo.",
      },
      { status: 500 }
    );
  }
}
