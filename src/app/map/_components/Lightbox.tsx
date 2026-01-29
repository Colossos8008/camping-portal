// src/app/map/_components/Lightbox.tsx
"use client";

import { useEffect } from "react";

export default function Lightbox(props: {
  open: boolean;
  index: number;
  images: { filename: string }[];
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const current = props.images[props.index] ?? null;

  useEffect(() => {
    if (!props.open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") props.onClose();
      if (e.key === "ArrowLeft") props.onPrev();
      if (e.key === "ArrowRight") props.onNext();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose, props.onPrev, props.onNext]);

  if (!props.open || !current) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="relative w-full max-w-[1100px]">
        <div className="absolute right-0 top-0 flex items-center gap-2">
          <div className="rounded-xl border border-white/10 bg-black/40 px-3 py-1 text-xs text-white/80">
            {props.index + 1}/{props.images.length}
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-xl border border-white/10 bg-white/10 px-3 py-1 text-xs hover:bg-white/15"
          >
            Schließen
          </button>
        </div>

        <button
          type="button"
          onClick={props.onPrev}
          className="absolute left-0 top-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-black/35 px-3 py-3 text-2xl leading-none text-white/90 hover:bg-black/50"
          aria-label="Vorheriges Bild"
        >
          ‹
        </button>

        <button
          type="button"
          onClick={props.onNext}
          className="absolute right-0 top-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-black/35 px-3 py-3 text-2xl leading-none text-white/90 hover:bg-black/50"
          aria-label="Nächstes Bild"
        >
          ›
        </button>

        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/40">
          <img
            src={`/uploads/${current.filename}`}
            alt=""
            className="max-h-[80svh] w-full select-none object-contain"
            draggable={false}
          />
        </div>

        <div className="mt-2 text-center text-xs text-white/70">Pfeile links rechts - ESC schließt</div>
      </div>
    </div>
  );
}
