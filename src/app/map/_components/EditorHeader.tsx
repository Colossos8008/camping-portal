// src/app/map/_components/EditorHeader.tsx
"use client";

import FeatureIcons from "./FeatureIcons";
import { formatDistanceKm } from "../_lib/geo";
import type { Place } from "../_lib/types";
import { getSupabasePublicUrl } from "../_lib/image-url";

export default function EditorHeader(props: {
  editingNew: boolean;
  saving: boolean;

  formName: string;
  formType: string;
  totalPoints: number;

  heroImage: { filename: string } | null;
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

  const heroSrc = props.heroImage?.filename ? getSupabasePublicUrl(props.heroImage.filename) : "";

  return (
    <div className="shrink-0 border-b border-white/10">
      <div className="relative overflow-hidden">
        {heroSrc ? (
          <button type="button" onClick={() => props.onOpenLightbox(0)} className="block w-full" title="Bild öffnen">
            <img src={heroSrc} alt="" className="h-36 w-full object-cover" loading="lazy" />
          </button>
        ) : (
          <div className="h-36 w-full bg-black/30" />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
      </div>

      <div className="px-4 py-2">
        <div className="min-w-0">
          <div className="text-2xl font-semibold leading-tight break-words">{title}</div>

          {/* Typ bewusst 1 Zeile tiefer */}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs opacity-80">
            <span className="rounded-lg border border-white/10 bg-black/20 px-2 py-0.5">{props.formType}</span>
            {props.imagesCount ? (
              <span className="rounded-lg border border-white/10 bg-black/20 px-2 py-0.5">{props.imagesCount} Bilder</span>
            ) : null}
            {dist ? <span className="rounded-lg border border-white/10 bg-black/20 px-2 py-0.5">📏 {dist}</span> : null}
          </div>

          {/* Törtchen Score bewusst nochmal eine Zeile tiefer */}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs opacity-80">
            <span className="rounded-lg border border-white/10 bg-black/20 px-2 py-0.5">Bewertung: {props.totalPoints}/14</span>
          </div>

          <div className="mt-2 flex items-start justify-between gap-3">
            <div className="min-w-0">{props.selectedPlace ? <FeatureIcons {...props.selectedPlace} /> : null}</div>

            <div className="shrink-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={props.onSave}
                  className="rounded-lg border border-white/10 bg-white/10 px-2.5 py-1.5 text-[11px] hover:bg-white/15 disabled:opacity-60"
                  disabled={props.saving}
                >
                  {props.saving ? "..." : "Speichern"}
                </button>

                {props.canDelete ? (
                  <button
                    onClick={props.onDelete}
                    className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[11px] hover:bg-red-500/20 disabled:opacity-60"
                    disabled={props.saving}
                  >
                    Löschen
                  </button>
                ) : null}

                <button
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
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => props.onOpenLightbox(idx)}
                    className="shrink-0"
                    title="Bild öffnen"
                  >
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
