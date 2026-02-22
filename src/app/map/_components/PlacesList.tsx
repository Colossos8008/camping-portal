// src/app/map/_components/PlacesList.tsx
"use client";

import type { SortMode, Place } from "../_lib/types";
import { formatDistanceKm } from "../_lib/geo";
import FeatureIcons from "./FeatureIcons";

type TS21Value = "S" | "O" | "X";
type TS21Source = "AI" | "USER";

function isTsRelevantType(t: any) {
  return t === "CAMPINGPLATZ" || t === "STELLPLATZ";
}

function ts21HaltungBadge(p: Place) {
  if (!isTsRelevantType((p as any)?.type)) return null;

  const raw = (p as any)?.ts21;
  if (!raw || typeof raw !== "object") return null;

  const dna = !!raw.dna;
  const explorer = !!raw.explorer;

  const effectiveDna = dna && explorer ? true : dna;
  const effectiveExplorer = dna && explorer ? false : explorer;

  if (!effectiveDna && !effectiveExplorer) return null;

  const emoji = effectiveExplorer ? "🧭" : "🧬";
  const label = effectiveExplorer ? "Explorer" : "DNA";

  return (
    <div
      className="mt-1 inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold leading-none text-white/90"
      title="Törtchensystem - Haltung"
    >
      <span className="text-[11px]">{emoji}</span>
      <span>{label}</span>
    </div>
  );
}

function ts21ToPoints(v: TS21Value): number {
  if (v === "S") return 2;
  if (v === "O") return 1;
  return 0;
}

function normTS21Value(v: any): TS21Value {
  return v === "S" || v === "O" || v === "X" ? v : "O";
}

function ts21Total(p: Place): number | null {
  if (!isTsRelevantType((p as any)?.type)) return null;

  const raw = (p as any)?.ts21;
  if (!raw || typeof raw !== "object") return null;

  const src: TS21Source = raw.activeSource === "USER" ? "USER" : "AI";
  const scores =
    (src === "USER" ? raw.user : raw.ai) && typeof (src === "USER" ? raw.user : raw.ai) === "object"
      ? (src === "USER" ? raw.user : raw.ai)
      : {};

  const keys = ["1a", "1b", "2a", "2b", "3", "4a", "4b", "5", "6", "7"];
  let sum = 0;
  for (const k of keys) sum += ts21ToPoints(normTS21Value((scores as any)[k]));
  return sum;
}

function displayScore(p: Place) {
  if (!isTsRelevantType((p as any)?.type)) return null;

  const t21 = ts21Total(p);
  if (t21 != null) return { value: t21, max: 20, title: "Törtchensystem" };

  const t1 = (p as any)?.ratingDetail?.totalPoints;
  const n = typeof t1 === "number" && Number.isFinite(t1) ? t1 : 0;
  return { value: n, max: 14, title: "Törtchensystem" };
}

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
      </div>

      <div className="h-[calc(100%-48px-74px)] overflow-auto px-2 pb-2">
        {props.places.map((p) => {
          const dist = formatDistanceKm((p as any).distanceKm);
          const hasDist = typeof (p as any).distanceKm === "number" && Number.isFinite((p as any).distanceKm);

          const sc = displayScore(p);

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
                  {sc ? (
                    <div title={sc.title}>
                      <span title="Törtchen-Score" className="mr-1" aria-hidden="true">
                        🍰
                      </span>
                      {sc.value}/{sc.max}
                    </div>
                  ) : null}

                  {ts21HaltungBadge(p)}

                  <div className="mt-1 text-[10px] opacity-70" title="Entfernung von deiner Eigenposition">
                    📏 {hasDist ? dist : "—"}
                  </div>
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