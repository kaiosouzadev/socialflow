import type { NextConfig } from "next";

/*
 * Cabeçalhos de segurança de todas as respostas. O Content-Security-Policy das PÁGINAS não fica
 * aqui: ele leva um nonce novo por requisição e é montado no `src/proxy.ts` (lib/csp.ts).
 */
const securityHeaders = [
  // não indexar nada do sistema (páginas internas e links públicos)
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
  // impede embutir em iframes (clickjacking); o CSP repete com frame-ancestors 'none'
  { key: "X-Frame-Options", value: "DENY" },
  // impede MIME sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // não vaza a URL (com tokens) para destinos externos
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // desliga APIs do navegador que o sistema não usa
  {
    key: "Permissions-Policy",
    value: [
      "accelerometer=()",
      "autoplay=()",
      "bluetooth=()",
      "browsing-topics=()",
      "camera=()",
      "display-capture=()",
      "geolocation=()",
      "gyroscope=()",
      "hid=()",
      "idle-detection=()",
      "magnetometer=()",
      "microphone=()",
      "midi=()",
      "payment=()",
      "publickey-credentials-get=()",
      "screen-wake-lock=()",
      "serial=()",
      "usb=()",
      "xr-spatial-tracking=()",
    ].join(", "),
  },
  // janela isolada de quem a abriu (window.opener) e de popups de outros sites
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // força HTTPS por 2 anos (efetivo quando servido via HTTPS)
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

/*
 * APIs: respostas JSON nunca vão para cache (credenciais, usuários, chaves — CF-17) e, abertas
 * direto no navegador, não executam nada. `/api/media` fica de fora do no-store: tem cache
 * próprio (a Graph API baixa a mídia por ela).
 */
const apiHeaders = [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" }];
const apiNoStore = [{ key: "Cache-Control", value: "no-store" }];

const nextConfig: NextConfig = {
  // não expõe a versão do Next no header `X-Powered-By`
  poweredByHeader: false,
  // sem source maps do código do navegador em produção (não publica o código-fonte)
  productionBrowserSourceMaps: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: apiHeaders },
      { source: "/api/((?!media/).*)", headers: apiNoStore },
    ];
  },
};

export default nextConfig;
