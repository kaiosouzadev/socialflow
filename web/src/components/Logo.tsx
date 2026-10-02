import Image from "next/image";
import Link from "next/link";
import coletivoLogo from "@/assets/brand/coletivo-logo.png";
import { ThemeToggle } from "./ThemeToggle";

/*
 * Identidade visual: só o logotipo do Grupo Coletivo (pedido do usuário em 02/10:
 * sem o texto "SocialFlow" e sem a placa escura). O PNG oficial é laranja com
 * fundo transparente e fica direto sobre a superfície nos dois temas.
 * Servido por /_next/static (fora do proxy).
 */

/** Largura proporcional do logotipo para uma altura de exibição. */
function logoWidth(height: number) {
  return Math.round((height * coletivoLogo.width) / coletivoLogo.height);
}

type LockupSize = "sm" | "md" | "lg";

/** Altura do logotipo em px por tamanho. */
const LOCKUP: Record<LockupSize, number> = { sm: 24, md: 32, lg: 48 };

/**
 * Logotipo do Grupo Coletivo (nome acessível "Grupo Coletivo").
 * Com `href`, a raiz é um link.
 */
export function BrandLockup({
  size = "md",
  href,
  className = "",
}: {
  size?: LockupSize;
  href?: string;
  className?: string;
}) {
  const height = LOCKUP[size];
  const content = (
    <Image
      src={coletivoLogo}
      alt="Grupo Coletivo"
      width={logoWidth(height)}
      height={height}
      unoptimized
      loading="eager"
      className="block"
    />
  );
  const root = `inline-flex shrink-0 items-center ${className}`;

  return href ? (
    <Link href={href} className={`${root} rounded-control`}>
      {content}
    </Link>
  ) : (
    <span className={root}>{content}</span>
  );
}

const PUBLIC_MAX_WIDTH = { xl: "max-w-xl", "3xl": "max-w-3xl", "6xl": "max-w-6xl" } as const;

/** Cabeçalho das páginas públicas e do login: lockup (sem link) + seletor de tema. */
export function PublicHeader({
  maxWidth = "3xl",
  className = "",
}: {
  maxWidth?: keyof typeof PUBLIC_MAX_WIDTH;
  className?: string;
}) {
  return (
    <header className={`border-b border-line bg-surface ${className}`}>
      <div
        className={`mx-auto flex h-14 items-center justify-between gap-3 px-4 ${PUBLIC_MAX_WIDTH[maxWidth]}`}
      >
        <BrandLockup size="md" />
        <ThemeToggle variant="icons" />
      </div>
    </header>
  );
}

/**
 * @deprecated usar BrandLockup. Mantido para os usos até a Fase 3 [RC 3d].
 * Só o logotipo, ocupando `size` px de altura (decorativo).
 */
export function Logo({ size = 28 }: { size?: number }) {
  const logo = Math.round(size * 0.8);
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center"
      style={{ height: size }}
    >
      <Image
        src={coletivoLogo}
        alt=""
        width={logoWidth(logo)}
        height={logo}
        unoptimized
        loading="eager"
        className="block"
      />
    </span>
  );
}
