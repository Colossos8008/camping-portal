"use client";

import { useEffect, useRef } from "react";
import type { SortMode, Place } from "../_lib/types";
import { formatDistanceKm } from "../_lib/geo";
import { getCampingStance, getPlaceScore, getPlaceTypeLabel, getSightseeingMeta } from "../_lib/place-display";
import FeatureIcons from "./FeatureIcons";

function tripStatusLabel(status: string) {
  if (status === "BOOKED") return "angefragt";
  if (status === "CONFIRMED") return "bestaetigt";
  if (status === "VISITED") return "besucht";
  return "geplant";
}

function sightInfo(p: Place) {
  if (p.type !== "SEHENSWUERDIGKEIT") return null;

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
  selectedTripId?: number | null;
}) {
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  useEffect(() => {
    if (!props.scrollToSelectedToken || props.selectedId == null) return;
    const node = itemRefs.current.get(props.selectedId);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [props.scrollToSelectedToken, props.selectedId]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5">
      <div className="border-b border-white/10 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Orte</div>
            <div className="text-[11px] text-white/55">{props.places.length} Treffer</div>
          </div>

          <select
            className="rounded-full border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none"
            value={props.sortMode}
            onChange={(e) => props.setSortMode(e.target.value as SortMode)}
          >
            <option value="SCORE">Score</option>
            <option value="ALPHA">A-Z</option>
            <option value="DIST">Distanz</option>
          </select>
        </div>

      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 overscroll-contain [webkit-overflow-scrolling:touch]">
        {props.places.map((p) => {
          const dist = formatDistanceKm((p as any).distanceKm);
          const score = getPlaceScore(p);
          const stance = getCampingStance(p);
          const sightseeing = sightInfo(p);
          const activeTripPlacement =
            props.selectedTripId != null
              ? (p.tripPlacements ?? []).find((item) => item.tripId === props.selectedTripId) ?? null
              : null;

          return (
            <button
              key={p.id}
              ref={(node) => {
                if (node) itemRefs.current.set(p.id, node);
                else itemRefs.current.delete(p.id);
              }}
              onClick={() => props.onSelect(p.id)}
              className={`mb-2 w-full rounded-2xl border px-3 py-2.5 text-left transition ${
                p.id === props.selectedId ? "border-white/30 bg-white/12" : "border-white/10 bg-white/5 hover:bg-white/10"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{p.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-white/60">
                        <span>{getPlaceTypeLabel(p.type)}</span>
                        {activeTripPlacement ? (
                          <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-1.5 py-0.5 text-[10px] text-sky-100">
                            #{activeTripPlacement.sortOrder} {tripStatusLabel(activeTripPlacement.status)}
                          </span>
                        ) : null}
                        {stance ? (
                          <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/80">
                            {stance.icon} {stance.label}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="shrink-0 text-right text-[11px] text-white/75">
                      {score ? (
                        <div title={score.title}>
                          <span className="mr-1" aria-hidden="true">
                            {score.icon}
                          </span>
                          {score.value}/{score.max}
                        </div>
                      ) : null}
                      <div className="mt-0.5">{dist ? dist : "-"}</div>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-3">
                    <FeatureIcons {...p} />
                    {sightseeing ? (
                      <div className="text-right text-[10px] text-white/50">
                        {sightseeing.relevance ? <div>{sightseeing.relevance}</div> : null}
                        {sightseeing.modePrimary ? <div>{sightseeing.modePrimary}</div> : null}
                      </div>
                    ) : null}
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
