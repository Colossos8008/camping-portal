"use client";

import { useEffect } from "react";
import { getSupabasePublicUrl } from "../_lib/image-url";

type LightboxItem = {
  id?: number;
  filename: string;
  kind?: "hero" | "gallery" | "candidate";
  source?: string;
  userFeedback?: "UP" | "DOWN" | null;
  candidateId?: number;
};

export default function Lightbox(props: {
  open: boolean;
  index: number;
  images: LightboxItem[];
  placeId: number | null;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRate?: (candidateId: number, vote: "UP" | "DOWN") => void;
}) {
  const { open, index, images, placeId, onClose, onPrev, onNext, onRate } = props;
  const current = images[index] ?? null;
  const src = current?.filename ? getSupabasePublicUrl(current.filename, { placeId }) : "";
  const canRate = current?.kind === "candidate" && typeof current.candidateId === "number";

  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onNext, onPrev, open]);

  if (!open || !current) return null;

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
            {index + 1}/{images.length}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/10 px-3 py-1 text-xs hover:bg-white/15"
          >
            Schließen
          </button>
        </div>

        <button
          type="button"
          onClick={onPrev}
          className="absolute left-0 top-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-black/35 px-3 py-3 text-2xl leading-none text-white/90 hover:bg-black/50"
          aria-label="Vorheriges Bild"
        >
          ‹
        </button>

        <button
          type="button"
          onClick={onNext}
          className="absolute right-0 top-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-black/35 px-3 py-3 text-2xl leading-none text-white/90 hover:bg-black/50"
          aria-label="Nächstes Bild"
        >
          ›
        </button>

        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/40">
          {src ? (
            <img src={src} alt="" className="max-h-[80svh] w-full select-none object-contain" draggable={false} />
          ) : (
            <div className="flex h-[60svh] w-full items-center justify-center text-xs text-white/70">Bild nicht verfügbar</div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-white/70">
            {current.kind === "candidate"
              ? `Hero-Vorschlag${current.source ? ` · ${current.source}` : ""}`
              : current.kind === "hero"
                ? "Hero-Bild"
                : "Galeriebild"}
          </div>

          {canRate ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onRate?.(current.candidateId as number, "DOWN")}
                className={`rounded-lg border px-2.5 py-1.5 text-xs ${
                  current.userFeedback === "DOWN"
                    ? "border-red-400/60 bg-red-500/20 text-red-100"
                    : "border-white/10 bg-white/5 text-white/85 hover:bg-white/10"
                }`}
                title="Passt nicht zu diesem Ort"
              >
                👎
              </button>
              <button
                type="button"
                onClick={() => onRate?.(current.candidateId as number, "UP")}
                className={`rounded-lg border px-2.5 py-1.5 text-xs ${
                  current.userFeedback === "UP"
                    ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-100"
                    : "border-white/10 bg-white/5 text-white/85 hover:bg-white/10"
                }`}
                title="Passt gut zu diesem Ort"
              >
                👍
              </button>
            </div>
          ) : null}
        </div>

        <div className="mt-2 text-center text-xs text-white/70">Pfeiltasten links/rechts · ESC schließt</div>
      </div>
    </div>
  );
}
