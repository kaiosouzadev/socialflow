import type { MetadataRoute } from "next";

// Bloqueia todos os crawlers — o sistema não deve ser indexado.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
