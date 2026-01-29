// src/app/map/_components/TogglePill.tsx
"use client";

export default function TogglePill(props: { on: boolean; label: string; icon: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`h-9 flex items-center justify-center gap-2 rounded-xl border px-3 text-[12px] leading-none transition ${
        props.on ? "border-white/25 bg-white/10" : "border-white/10 bg-black/20 opacity-85 hover:opacity-100"
      }`}
      title={props.label}
      aria-pressed={props.on}
    >
      <span className="text-[13px] leading-none">{props.icon}</span>
      <span className="whitespace-nowrap">{props.label}</span>
    </button>
  );
}
