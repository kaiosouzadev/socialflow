export function Logo({ size = 28 }: { size?: number }) {
  return (
    <div
      className="relative flex items-center justify-center rounded-xl shrink-0"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg, #7c5cff, #ec4899)",
        boxShadow: "0 4px 18px -4px rgba(124,92,255,0.6), inset 0 1px 0 rgba(255,255,255,0.25)",
      }}
    >
      <svg
        width={size * 0.55}
        height={size * 0.55}
        viewBox="0 0 24 24"
        fill="none"
        stroke="#fff"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M13 3 4 14h7l-1 7 9-11h-7l1-7Z" />
      </svg>
    </div>
  );
}
