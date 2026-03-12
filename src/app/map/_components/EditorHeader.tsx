// src/app/map/_components/EditorHeader.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import FeatureIcons from "./FeatureIcons";
import { formatDistanceKm } from "../_lib/geo";
import type { Place } from "../_lib/types";
import { getSupabasePublicUrl } from "../_lib/image-url";

export default function EditorHeader(props: {
  editingNew: boolean;
  saving: boolean;

  formName: string;
  formType: string;

  score: { value: number; max: number; title: string } | null;

  heroImage: { filename: string } | null;
  placeId: number | null;
  headerImages: { id: number; filename: string }[];

  imagesCount: number;
  selectedPlace: Place | null;

  distanceKm: number | null;

  onOpenLightbox: (index: number) => void;
  onSave: () => void;
  onDelete: () => void;
  onNew: () => void;

  canDelete: boolean;
}) {
  const title = props.formName || (props.editingNew ? "Ort neu" : "Ort bearbeiten");
  const dist = formatDistanceKm(props.distanceKm);

  const heroFilename = String(props.heroImage?.filename ?? "").trim();
  const heroBaseSrc = heroFilename ? getSupabasePublicUrl(heroFilename, { placeId: props.placeId }) : "";

  const [heroRetry, setHeroRetry] = useState(0);
  const [heroFailedSrc, setHeroFailedSrc] = useState<string>("");
  const heroSrc = heroRetry > 0 && heroBaseSrc
    ? `${heroBaseSrc}${heroBaseSrc.includes("?") ? "&" : "?"}ui_retry=${heroRetry}`
    : heroBaseSrc;

  const canRenderHero = useMemo(() => {
    if (!heroSrc.length) return false;
    if (!heroFailedSrc.length) return true;
    return heroFailedSrc !== heroSrc;
  }, [heroFailedSrc, heroSrc]);

  useEffect(() => {
    setHeroRetry(0);
    setHeroFailedSrc("");
  }, [heroBaseSrc]);

  return (
    <div className="shrink-0 border-b border-white/10">
      <div className="relative overflow-hidden">
        {canRenderHero ? (
          <button type="button" onClick={() => props.onOpenLightbox(0)} className="block w-full" title="Bild öffnen">
            <img
              key={heroSrc}
              src={heroSrc}
              alt=""
              className="h-36 w-full object-cover"
              loading="lazy"
              onError={() => {
                if (heroRetry === 0 && heroBaseSrc) {
                  setHeroRetry(1);
                  return;
                }
                setHeroFailedSrc(heroSrc);
              }}
            />
          </button>
        ) : (
          <div className="h-36 w-full bg-black/30" />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
      </div>

      <div className="px-4 py-2">
        <div className="min-w-0">
          <div className="text-2xl font-semibold leading-tight break-words">{title}</div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs opacity-80">
            <span className="rounded-lg border border-white/10 bg-black/20 px-2 py-0.5">{props.formType}</span>
            {props.imagesCount ? (
              <span className="rounded-lg border border-white/10 bg-black/20 px-2 py-0.5">{props.imagesCount} Bilder</span>
            ) : null}
            {dist ? <span className="rounded-lg border border-white/10 bg-black/20 px-2 py-0.5">📏 {dist}</span> : null}
          </div>

          {props.score ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs opacity-80">
              <span className="rounded-lg border border-white/10 bg-black/20 px-2 py-0.5" title={props.score.title}>
                🍰 Bewertung: {props.score.value}/{props.score.max}
              </span>
            </div>
          ) : null}

          <div className="mt-2 flex items-start justify-between gap-3">
            <div className="min-w-0">{props.selectedPlace ? <FeatureIcons {...props.selectedPlace} /> : null}</div>

            <div className="shrink-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={props.onSave}
                  className="rounded-lg border border-white/10 bg-white/10 px-2.5 py-1.5 text-[11px] hover:bg-white/15 disabled:opacity-60"
                  disabled={props.saving}
                >
                  {props.saving ? "..." : "Speichern"}
                </button>

                {props.canDelete ? (
                  <button
                    type="button"
                    onClick={props.onDelete}
                    className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[11px] hover:bg-red-500/20 disabled:opacity-60"
                    disabled={props.saving}
                  >
                    Löschen
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={props.onNew}
                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] hover:bg-white/10 disabled:opacity-60"
                  disabled={props.saving}
                >
                  + Neu
                </button>
              </div>
            </div>
          </div>

          <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-1">
            {props.headerImages.length ? (
              props.headerImages.slice(0, 12).map((img: any, idx: number) => {
                const src = getSupabasePublicUrl(String(img.filename ?? ""));
                return (
                  <button key={img.id} type="button" onClick={() => props.onOpenLightbox(idx)} className="shrink-0" title="Bild öffnen">
                    {src ? (
                      <img
                        src={src}
                        alt=""
                        className={`h-10 w-10 rounded-lg object-cover ${idx === 0 ? "ring-2 ring-white/50" : "ring-0"}`}
                        loading="lazy"
                      />
                    ) : (
                      <div className={`h-10 w-10 rounded-lg bg-black/30 ${idx === 0 ? "ring-2 ring-white/50" : "ring-0"}`} />
                    )}
                  </button>
                );
              })
            ) : (
              <div className="h-10 w-10 shrink-0 rounded-lg border border-white/10 bg-black/30" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
