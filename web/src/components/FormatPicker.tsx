"use client";

export const POST_FORMATS = [
  { id: "feed", label: "Feed" },
  { id: "story", label: "Story" },
  { id: "carrossel", label: "Carrossel" },
  { id: "reels", label: "Reels" },
] as const;

export function FormatPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {POST_FORMATS.map((f) => {
        const on = value === f.id;
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onChange(f.id)}
            className={`py-2.5 rounded-xl border text-sm font-medium transition-all ${
              on
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-white"
                : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)]"
            }`}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
