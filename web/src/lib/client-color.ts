/**
 * Cor estável por cliente.
 *
 * Derivada do id, então o mesmo cliente tem sempre a mesma cor em qualquer
 * tela e em qualquer sessão — sem precisar guardar nada no banco. Antes cada
 * tela pintava as bolinhas por conta própria e a cor de um cliente mudava
 * conforme a ordem em que ele aparecia na lista.
 *
 * `brandColor` do cliente, quando existir, tem prioridade.
 */

const PALETTE = [
  "#7c5cff", // violeta
  "#38bdf8", // azul
  "#34d399", // verde
  "#fbbf24", // âmbar
  "#f472b6", // rosa
  "#a78bfa", // lilás
  "#22d3ee", // ciano
  "#fb923c", // laranja
  "#4ade80", // lima
  "#e879f9", // magenta
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0; // mantém em 32 bits
  }
  return Math.abs(h);
}

export function clientColor(clientId: string, brandColor?: string | null): string {
  if (brandColor && /^#[0-9a-f]{6}$/i.test(brandColor)) return brandColor;
  return PALETTE[hash(clientId) % PALETTE.length];
}
