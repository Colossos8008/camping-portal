"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabasePublicUrl } from "../_lib/image-url";
import type { PlaceHeroCandidate } from "../_lib/types";

export default function HeroCandidatesPanel(props: {
  placeId: number | null;
  placeType: string;
  candidates: PlaceHeroCandidate[];
  loading: boolean;
  error: string;
  onLoad: () => void;
  onSelect: (index: number) => void;
  onChooseHero: (index: number) => void;
  activeHeroUrl?: string | null;
}) {
  const supported = props.placeType !== "HVO_TANKSTELLE";
  const [failedUrls, setFailedUrls] = useState<string[]>([]);

  useEffect(() => {
    setFailedUrls([]);
  }, [props.placeId, props.candidates]);

  const visibleCandidates = useMemo(
    () => props.candidates.filter((candidate) => !failedUrls.includes(String(candidate.url ?? ""))),
    [failedUrls, props.candidates]
  );

  return (
    <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Hero-Vorschläge</div>
          <div className="text-xs opacity-70">5-10 externe Bildkandidaten zum manuellen Auswählen</div>
        </div>
        <button
          type="button"
          onClick={props.onLoad}
          disabled={!supported || !props.placeId || props.loading}
          className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs hover:bg-white/15 disabled:opacity-50"
        >
          {props.loading ? "Lädt..." : props.candidates.length ? "Neu laden" : "Vorschläge laden"}
        </button>
      </div>

      {!supported ? (
        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs opacity-80">
          Für HVO-Tankstellen sind Hero-Vorschläge deaktiviert.
        </div>
      ) : null}

      {props.error ? (
        <div className="mb-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">{props.error}</div>
      ) : null}

      {supported && visibleCandidates.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-2">
          {visibleCandidates.map((candidate) => {
            const originalIndex = props.candidates.findIndex(
              (item) => item.url === candidate.url && item.rank === candidate.rank && item.source === candidate.source
            );
            const src = getSupabasePublicUrl(String(candidate.thumbUrl ?? candidate.url), { placeId: props.placeId });
            const isActive = String(props.activeHeroUrl ?? "").trim() === String(candidate.url ?? "").trim();

            return (
              <div key={`${candidate.url}-${candidate.rank}-${candidate.source}`} className="rounded-xl border border-white/10 bg-black/30 p-1.5">
                <button
                  type="button"
                  onClick={() => props.onSelect(originalIndex)}
                  className="block w-full text-left"
                  title="Bild groß ansehen"
                >
                  {src ? (
                    <img
                      src={src}
                      alt=""
                      className={`h-24 w-full rounded-lg object-cover ${isActive ? "ring-2 ring-emerald-300/70" : ""}`}
                      loading="lazy"
                      onError={() => {
                        setFailedUrls((current) =>
                          current.includes(String(candidate.url ?? "")) ? current : [...current, String(candidate.url ?? "")]
                        );
                      }}
                    />
                  ) : (
                    <div className={`h-24 w-full rounded-lg bg-black/30 ${isActive ? "ring-2 ring-emerald-300/70" : ""}`} />
                  )}
                </button>

                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] opacity-80">
                  <span className="rounded-md border border-white/10 bg-white/10 px-1.5 py-0.5 uppercase">{candidate.source}</span>
                  <span>Score {candidate.score}</span>
                </div>

                <div className="mt-1 line-clamp-3 text-[11px] text-white/75">{candidate.reason}</div>

                <button
                  type="button"
                  onClick={() => props.onChooseHero(originalIndex)}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-white/10 px-2 py-1.5 text-[11px] hover:bg-white/15"
                >
                  {isActive ? "Aktives Hero-Bild" : "Als Hero setzen"}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {supported && !props.loading && !props.error && visibleCandidates.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs opacity-80">
          {props.candidates.length > 0 ? "Die geladenen Vorschläge konnten nicht angezeigt werden." : "Noch keine Vorschläge geladen."}
        </div>
      ) : null}
    </div>
  );
}
