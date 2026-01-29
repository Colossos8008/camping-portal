// src/app/map/_components/PlacesList.tsx
"use client";

import type { SortMode, Place } from "../_lib/types";
import { formatDistanceKm } from "../_lib/geo";
import FeatureIcons from "./FeatureIcons";

export default function PlacesList(props: {
  places: Place[];
  selectedId: number | null;
  onSelect: (id: number) => void;

  sortMode: SortMode;
  setSortMode: (m: SortMode) => void;

  geoStatus: string;
  onRequestMyLocation: () => void;

  hasMyPos: boolean;
  onZoomToMyPos: () => void;

  showMyRings: boolean;
  setShowMyRings: (v: boolean) => void;
}) {
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

        {props.sortMode === "DIST" ? (
          <>
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={props.onRequestMyLocation}
                className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs hover:bg-white/15"
              >
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
          </>
        ) : null}
      </div>

      <div className="h-[calc(100%-48px-74px)] overflow-auto px-2 pb-2">
        {props.places.map((p) => {
          const dist = formatDistanceKm(p.distanceKm);
          return (
            <button
              key={p.id}
              onClick={() => props.onSelect(p.id)}
              className={`mb-2 w-full rounded-xl border px-3 py-3 text-left ${
                p.id === props.selectedId ? "border-white/30 bg-white/10" : "border-white/10 bg-white/5 hover:bg-white/10"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{p.name}</div>
                  <div className="text-[11px] opacity-70">{p.type}</div>
                  <FeatureIcons {...p} />
                </div>

                <div className="shrink-0 text-right text-[11px] opacity-90">
                  <span title="Törtchen-Score" className="mr-1">
                    🍰
                  </span>
                  {p.ratingDetail?.totalPoints ?? 0}/14
                  {props.sortMode === "DIST" ? <div className="mt-1 text-[10px] opacity-70">{dist}</div> : null}
                </div>
              </div>
            </button>
          );
        })}

        {props.places.length === 0 ? (
          <div className="px-2 py-6 text-sm opacity-70">Keine Treffer (Filter prüfen) - oder rechts auf + Neu.</div>
        ) : null}
      </div>
    </div>
  );
}
