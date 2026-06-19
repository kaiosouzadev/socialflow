import type { NextConfig } from "next";

const securityHeaders = [
  // não indexar (já tínhamos)
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
  // impede embanho em iframes (clickjacking)
  { key: "X-Frame-Options", value: "DENY" },
  // impede MIME sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // não vaza a URL (com tokens) para destinos externos
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // desliga APIs sensíveis do navegador
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  // força HTTPS por 2 anos (efetivo quando servido via HTTPS)
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // não expõe a versão do Next no header `X-Powered-By`
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
