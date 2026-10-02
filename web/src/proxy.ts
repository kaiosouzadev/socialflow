import { auth } from "@/auth";

export const proxy = auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";

  if (!isLoggedIn && !isLoginPage) {
    return Response.redirect(new URL("/login", req.url));
  }
  if (isLoggedIn && isLoginPage) {
    return Response.redirect(new URL("/", req.url));
  }
});

export const config = {
  // Fora do proxy: APIs, links públicos (`aprovar` cobre também `aprovar-semana`
  // por prefixo), estáticos e os ícones de metadata (app/icon.png e
  // app/apple-icon.png), que precisam abrir sem sessão.
  matcher: ["/((?!api|aprovar|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)"],
};
