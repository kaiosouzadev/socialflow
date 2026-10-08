import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { clientIp, loginFailed, loginGate, loginSucceeded, maskEmailForLog } from "@/lib/rate-limit";
import {
  SESSION_MAX_AGE_S,
  SESSION_UPDATE_AGE_S,
  applyTokenToSessionUser,
  jwtCallback,
  signOutEvent,
  type SignInUser,
} from "@/lib/session-guard";

class TooManyAttempts extends CredentialsSignin {
  code = "rate_limited";
}

/**
 * Hash bcrypt (custo 12, o mesmo das senhas reais) de um valor aleatório que ninguém sabe.
 * Com e-mail inexistente o login compara com ele: o tempo de resposta fica igual ao da
 * senha errada e não revela quem tem conta (AC-06/CR-11).
 */
export const DUMMY_PASSWORD_HASH = "$2b$12$GfgAFVF.C5uP6xFVPbL8Fewaowp2mQhjyqCMi4YczDsy.uCBeR82W";

const MAX_EMAIL = 254;
const MAX_PASSWORD = 1024;

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      authorize: async (credentials, request) => {
        const email = typeof credentials?.email === "string" ? credentials.email.trim() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password || email.length > MAX_EMAIL || password.length > MAX_PASSWORD) return null;

        // limite só de FALHAS, por e-mail+IP e por IP (lib/rate-limit, LOGIN_LIMITS)
        const ip = clientIp(request);
        if (loginGate(ip, email).blocked) throw new TooManyAttempts();

        const user = await prisma.user.findUnique({
          where: { email },
          select: { id: true, name: true, email: true, role: true, passwordHash: true, sessionVersion: true },
        });
        // sempre um bcrypt (hash falso sem usuária): mesmo tempo com ou sem conta
        const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
        if (!user || !valid) {
          const failed = loginFailed(ip, email);
          if (failed.lockedNow) {
            await audit(
              {
                action: "auth.login_blocked",
                targetType: "login",
                meta: { email: maskEmailForLog(email), scope: failed.lockedNow, retryAfterSeconds: failed.retryAfter },
              },
              { req: request, actor: { id: null, email: null } }
            );
          }
          return null;
        }

        loginSucceeded(ip, email);
        const signedIn: SignInUser & { name: string; email: string } = {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          sessionVersion: user.sessionVersion,
        };
        return signedIn;
      },
    }),
  ],
  pages: { signIn: "/login" },
  // 7 dias renovando com o uso; teto de 30 dias desde o login (lib/session-guard)
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_S, updateAge: SESSION_UPDATE_AGE_S },
  callbacks: {
    // login: grava id/papel/versão/data; depois, revalida no banco a cada leitura da sessão
    jwt: ({ token, user }) => jwtCallback({ token, user: user as SignInUser | undefined }),
    session({ session, token }) {
      applyTokenToSessionUser(session.user as Parameters<typeof applyTokenToSessionUser>[0], token);
      return session;
    },
  },
  events: {
    // "Sair" invalida o cookie antigo (sobe users.session_version)
    signOut: (message) => signOutEvent(message),
  },
});
