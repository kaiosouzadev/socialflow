import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { uuidString } from "@/lib/validators";

export const dynamic = "force-dynamic";

/** Textos do 400/404/500 (N-14: `error` é sempre uma frase pt-BR, nunca o objeto do zod). */
const MSG = {
  invalidId: "Post inválido.",
  body: "Informe se a arte está feita ou não.",
  notFound: "Post não encontrado.",
  failed: "Não foi possível atualizar a arte agora. Tente de novo.",
} as const;

const bodySchema = z.object({ done: z.boolean() });

type SessionUser = { id?: string; email?: string | null } | undefined;

/** Usuária da sessão no banco ({ id, name }) — pelo id do token; sem ele, pelo e-mail. null se não existir mais. */
async function sessionUser(): Promise<{ id: string; name: string } | null> {
  const session = await auth();
  const user = session?.user as SessionUser;
  if (user?.id && uuidString.safeParse(user.id).success) {
    const found = await prisma.user.findUnique({ where: { id: user.id }, select: { id: true, name: true } });
    if (found) return found;
  }
  if (user?.email) {
    return prisma.user.findUnique({ where: { email: user.email }, select: { id: true, name: true } });
  }
  return null;
}

/**
 * Marca (ou desmarca) a ARTE de um post como feita — fila da página /design e Quadro de Produção.
 *
 * Corpo: `{ done: boolean }`.
 *   - done=true  → art_done_at = agora, art_done_by = usuária da sessão (null se ela não existir mais);
 *   - done=false → limpa os dois (a arte volta a "a fazer", salvo se o post tiver mídia ou estiver publicado).
 * Resposta 200: `{ ok: true, artDoneAt: string | null (ISO), artDoneBy: { id, name } | null }`.
 * Erros: 401 sem sessão; 400 id ou corpo inválido; 404 post inexistente; 500 falha do banco — sempre `{ error: "<pt-BR>" }`.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  if (!uuidString.safeParse(id).success) {
    return Response.json({ error: MSG.invalidId }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: MSG.body }, { status: 400 });
  }
  const { done } = parsed.data;

  try {
    const by = done ? await sessionUser() : null;
    const at = done ? new Date() : null;
    const { count } = await prisma.post.updateMany({
      where: { id },
      data: { artDoneAt: at, artDoneBy: by?.id ?? null },
    });
    if (count === 0) return Response.json({ error: MSG.notFound }, { status: 404 });
    return Response.json({ ok: true, artDoneAt: at ? at.toISOString() : null, artDoneBy: by });
  } catch (e) {
    // detalhe técnico só no log do servidor; a tela recebe uma frase pt-BR
    console.error("[posts/art]", e);
    return Response.json({ error: MSG.failed }, { status: 500 });
  }
}
