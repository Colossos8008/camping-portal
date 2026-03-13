"use client";

import { useEffect, useRef } from "react";
import type { SortMode, Place } from "../_lib/types";
import { formatDistanceKm } from "../_lib/geo";
import { getCampingStance, getPlaceScore, getPlaceTypeLabel, getSightseeingMeta } from "../_lib/place-display";
import FeatureIcons from "./FeatureIcons";

function ts21HaltungBadge(p: Place) {
  const stance = getCampingStance(p);
  if (!stance) return null;

  return (
    <div
      className="mt-1 inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold leading-none text-white/90"
      title="Törtchensystem - Haltung"
    >
      <span className="text-[11px]">{stance.icon}</span>
      <span>{stance.label}</span>
    </div>
  );
}

function reviewBadge(p: Place) {
  const rawStatus = (p as any)?.coordinateReviewStatus;
  const status = rawStatus === "CONFIRMED" || rawStatus === "CORRECTED" || rawStatus === "REJECTED" ? rawStatus : "UNREVIEWED";

  if (status === "CONFIRMED") {
    return (
      <span
        className="inline-flex items-center rounded-full border border-emerald-400/20 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-medium leading-none text-emerald-200"
        title="Koordinate bestätigt"
      >
        bestätigt
      </span>
    );
  }

  if (status === "CORRECTED") {
    return (
      <span
        className="inline-flex items-center rounded-full border border-amber-400/20 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-medium leading-none text-amber-200"
        title="Koordinate korrigiert"
      >
        korrigiert
      </span>
    );
  }

  if (status === "REJECTED") {
    return (
      <span
        className="inline-flex items-center rounded-full border border-rose-400/20 bg-rose-400/10 px-1.5 py-0.5 text-[9px] font-medium leading-none text-rose-200"
        title="Koordinate geprüft, aber verworfen"
      >
        verworfen
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-1.5 py-0.5 text-[9px] font-medium leading-none text-white/70"
      title="Koordinate ungeprüft"
    >
      ungeprüft
    </span>
  );
}

function sightInfo(p: Place) {
  if ((p as any)?.type !== "SEHENSWUERDIGKEIT") return null;

  const score = getPlaceScore(p);
  const meta = getSightseeingMeta(p);

  return {
    total: score?.value ?? null,
    relevance: meta?.relevance ?? null,
    modePrimary: meta?.visitMode ?? null,
  };
}

export default function PlacesList(props: {
  places: Place[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  scrollToSelectedToken?: number;
  sortMode: SortMode;
  setSortMode: (m: SortMode) => void;
  geoStatus: string;
  onRequestMyLocation: () => void;
  hasMyPos: boolean;
  onZoomToMyPos: () => void;
  showMyRings: boolean;
  setShowMyRings: (v: boolean) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  useEffect(() => {
    if (!props.scrollToSelectedToken || props.selectedId == null) return;
    const node = itemRefs.current.get(props.selectedId);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [props.scrollToSelectedToken, props.selectedId]);

  return (
    <div className="h-full overflow-hidden rounded-2xl border border-white/10 bg-white/5">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="text-sm font-semibold">Orte</div>
        <div className="text-xs opacity-70">{props.places.length} Treffer</div>
      </div>

      <div className="px-4 pb-2">
        <select
          className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
          value={props.sortMode}
          onChange={(e) => props.setSortMode(e.target.value as SortMode)}
        >
          <option value="SCORE">Sortierung: Score</option>
          <option value="ALPHA">Sortierung: Alphabetisch</option>
          <option value="DIST">Sortierung: Entfernung</option>
        </select>

        <div className="mt-2 flex items-center gap-2">
          <button onClick={props.onRequestMyLocation} className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs hover:bg-white/15">
            Eigenposition holen
          </button>

          <button
            onClick={props.onZoomToMyPos}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-60"
            disabled={!props.hasMyPos}
            title={props.hasMyPos ? "Zu mir zoomen" : "Erst Eigenposition holen"}
          >
            Zu mir
          </button>

          <div className="text-xs opacity-70">{props.geoStatus}</div>
        </div>

        <label className="mt-2 flex items-center gap-2 text-xs opacity-85">
          <input
            type="checkbox"
            checked={props.showMyRings}
            onChange={(e) => props.setShowMyRings(e.target.checked)}
            disabled={!props.hasMyPos}
          />
          Entfernungsringe anzeigen
        </label>
      </div>

      <div ref={listRef} className="h-[calc(100%-48px-74px)] overflow-auto px-2 pb-2">
        {props.places.map((p) => {
          const dist = formatDistanceKm((p as any).distanceKm);
          const hasDist = typeof (p as any).distanceKm === "number" && Number.isFinite((p as any).distanceKm);
          const score = getPlaceScore(p);

          return (
            <button
              key={p.id}
              ref={(node) => {
                if (node) itemRefs.current.set(p.id, node);
                else itemRefs.current.delete(p.id);
              }}
              onClick={() => props.onSelect(p.id)}
              className={`mb-2 w-full rounded-xl border px-3 py-3 text-left ${
                p.id === props.selectedId ? "border-white/30 bg-white/10" : "border-white/10 bg-white/5 hover:bg-white/10"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{p.name}</div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <div className="text-[11px] opacity-70">{getPlaceTypeLabel(p.type)}</div>
                    {reviewBadge(p)}
                  </div>
                  <FeatureIcons {...p} />
                </div>

                <div className="shrink-0 text-right text-[11px] opacity-90">
                  {score ? (
                    <div title={score.title}>
                      <span title={score.title} className="mr-1" aria-hidden="true">
                        {score.icon}
                      </span>
                      {score.value}/{score.max}
                    </div>
                  ) : null}

                  {(() => {
                    const si = sightInfo(p);
                    if (!si) return null;
                    return (
                      <div className="mt-1 space-y-1">
                        {si.relevance ? <div className="text-[10px] opacity-80">{si.relevance}</div> : null}
                        {si.modePrimary ? <div className="text-[10px] opacity-80">{si.modePrimary}</div> : null}
                      </div>
                    );
                  })()}

                  {ts21HaltungBadge(p)}

                  <div className="mt-1 text-[10px] opacity-70" title="Entfernung von deiner Eigenposition">
                    📏 {hasDist ? dist : "-"}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
