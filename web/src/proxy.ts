import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import type { NextAuthRequest } from "next-auth";
import { auth } from "@/auth";
import { buildCsp, generateNonce, mediaSourcesFromEnv } from "@/lib/csp";
import { allowedOriginsFor, checkApiRequest, guardResponse } from "@/lib/request-guard";

/*
 * Proxy (antigo middleware) — três papéis, por caminho:
 *
 * - `/api/**`: só a guarda de CSRF/tamanho (lib/request-guard). Não lê a sessão (cada rota
 *   continua conferindo a sua com requireAuth/requireAdmin/chave interna).
 * - `/aprovar/**` e `/aprovar-semana/**` (links públicos do cliente): só o CSP com nonce.
 * - demais páginas: sessão obrigatória (sem sessão → /login; com sessão, /login → /) e CSP.
 *
 * O CSP vai na resposta e também no cabeçalho da REQUISIÇÃO (junto com `x-nonce`): é de lá que o
 * Next tira o nonce para pôr nos scripts dele, e o layout raiz põe no script de tema.
 */

const isDev = process.env.NODE_ENV === "development";

function isPublicPage(pathname: string): boolean {
  return pathname.startsWith("/aprovar/") || pathname.startsWith("/aprovar-semana/");
}

/** Segue para a página com um nonce novo no CSP (requisição e resposta). */
function nextWithCsp(req: NextRequest): NextResponse {
  const nonce = generateNonce();
  const csp = buildCsp({ nonce, dev: isDev, mediaSources: mediaSourcesFromEnv() });
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

/** Sessão válida = tem identidade (CF-01: objeto de erro/sessão vazia não passa). */
function hasIdentity(req: NextAuthRequest): boolean {
  const id = req.auth?.user?.id;
  return typeof id === "string" && id.length > 0;
}

// o 2º parâmetro (evento) faz o NextAuth devolver a forma "proxy" (req, evento), não a de rota
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const pages = auth((req: NextAuthRequest, _ev: NextFetchEvent) => {
  const isLoggedIn = hasIdentity(req);
  const isLoginPage = req.nextUrl.pathname === "/login";

  if (!isLoggedIn && !isLoginPage) {
    return Response.redirect(new URL("/login", req.url));
  }
  if (isLoggedIn && isLoginPage) {
    return Response.redirect(new URL("/", req.url));
  }
  return nextWithCsp(req);
});

export async function proxy(req: NextRequest, ev: NextFetchEvent) {
  const { pathname } = req.nextUrl;

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    const refusal = checkApiRequest({
      method: req.method,
      pathname,
      headers: req.headers,
      allowedOrigins: allowedOriginsFor(req.headers, req.nextUrl.origin),
    });
    if (refusal) {
      console.warn(`[proxy] ${req.method} ${pathname} recusado (${refusal.status}): ${refusal.reason}`);
      return guardResponse(refusal);
    }
    return NextResponse.next();
  }

  if (isPublicPage(pathname)) return nextWithCsp(req);

  return pages(req, ev);
}

export const config = {
  // Fora do proxy: estáticos do Next, os ícones de metadata (app/icon.png e app/apple-icon.png)
  // e o robots.txt, que precisam abrir sem sessão. `/api` e os links públicos ENTRAM (guarda de
  // CSRF e CSP); a sessão só é exigida nas páginas internas (ver proxy acima).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|robots.txt).*)"],
};
