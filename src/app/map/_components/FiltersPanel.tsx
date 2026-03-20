"use client";

import type { Dispatch, SetStateAction } from "react";

type CoordinateReviewFilter = "ALL" | "UNREVIEWED" | "CORRECTED" | "CONFIRMED" | "REJECTED";

export default function FiltersPanel(props: {
  filtersOpen: boolean;
  setFiltersOpen: Dispatch<SetStateAction<boolean>>;
  alwaysOpen?: boolean;
  showStellplatz: boolean;
  setShowStellplatz: Dispatch<SetStateAction<boolean>>;
  showCampingplatz: boolean;
  setShowCampingplatz: Dispatch<SetStateAction<boolean>>;
  showSehens: boolean;
  setShowSehens: Dispatch<SetStateAction<boolean>>;
  showHvoTankstelle: boolean;
  setShowHvoTankstelle: Dispatch<SetStateAction<boolean>>;
  fDog: boolean;
  setFDog: Dispatch<SetStateAction<boolean>>;
  fSan: boolean;
  setFSan: Dispatch<SetStateAction<boolean>>;
  fYear: boolean;
  setFYear: Dispatch<SetStateAction<boolean>>;
  fOnline: boolean;
  setFOnline: Dispatch<SetStateAction<boolean>>;
  fGastro: boolean;
  setFGastro: Dispatch<SetStateAction<boolean>>;
  reviewFilter: CoordinateReviewFilter;
  setReviewFilter: Dispatch<SetStateAction<CoordinateReviewFilter>>;
  geoStatus: string;
  hasMyPos: boolean;
  showMyRings: boolean;
  setShowMyRings: Dispatch<SetStateAction<boolean>>;
  onRequestMyLocation: () => void;
  onZoomToMyPos: () => void;
  onRefresh: () => void;
}) {
  const effectiveOpen = props.alwaysOpen || props.filtersOpen;
  const setShowHvo = typeof props.setShowHvoTankstelle === "function" ? props.setShowHvoTankstelle : () => {};

  return (
    <div className={`rounded-2xl border border-white/10 bg-white/5 ${effectiveOpen ? "p-4" : "p-3"}`}>
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => {
            if (!props.alwaysOpen) props.setFiltersOpen((v) => !v);
          }}
          className="text-sm font-semibold hover:opacity-90"
          title={effectiveOpen ? "Filter ausblenden" : "Filter einblenden"}
        >
          Filter <span className="ml-1 opacity-60">{effectiveOpen ? "v" : ">"}</span>
        </button>

        <div className="flex items-center gap-2">
          <button onClick={props.onRefresh} className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10">
            Aktualisieren
          </button>

          {!props.alwaysOpen ? (
            <button
              onClick={() => props.setFiltersOpen((v) => !v)}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
            >
              {effectiveOpen ? "Ausblenden" : "Einblenden"}
            </button>
          ) : null}
        </div>
      </div>

      {effectiveOpen ? (
        <>
          <div className="my-3 h-px bg-white/10" />

          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={props.showStellplatz} onChange={(e) => props.setShowStellplatz(e.target.checked)} />
              Stellplatz
            </label>

            <label className="flex items-center gap-2">
              <input type="checkbox" checked={props.showCampingplatz} onChange={(e) => props.setShowCampingplatz(e.target.checked)} />
              Campingplatz
            </label>

            <label className="flex items-center gap-2">
              <input type="checkbox" checked={props.showSehens} onChange={(e) => props.setShowSehens(e.target.checked)} />
              Sehenswuerdigkeit
            </label>

            <label className="flex items-center gap-2">
              <input type="checkbox" checked={props.showHvoTankstelle} onChange={(e) => setShowHvo(e.target.checked)} />
              HVO-Tankstelle
            </label>

            <div className="col-span-2 my-1 h-px bg-white/10" />

            <label className="flex items-center gap-2">
              <input type="checkbox" checked={props.fDog} onChange={(e) => props.setFDog(e.target.checked)} />
              Hunde
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={props.fSan} onChange={(e) => props.setFSan(e.target.checked)} />
              Sanitaer
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={props.fYear} onChange={(e) => props.setFYear(e.target.checked)} />
              Ganzjaehrig
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={props.fOnline} onChange={(e) => props.setFOnline(e.target.checked)} />
              Online
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={props.fGastro} onChange={(e) => props.setFGastro(e.target.checked)} />
              Gastro
            </label>

            <div className="col-span-2 my-1 h-px bg-white/10" />

            <label className="col-span-2 flex items-center justify-between gap-2">
              <span>Review</span>
              <select
                value={props.reviewFilter}
                onChange={(e) => props.setReviewFilter(e.target.value as CoordinateReviewFilter)}
                className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs"
              >
                <option value="ALL">alle</option>
                <option value="UNREVIEWED">ungeprueft</option>
                <option value="CORRECTED">korrigiert</option>
                <option value="CONFIRMED">bestaetigt</option>
                <option value="REJECTED">verworfen</option>
              </select>
            </label>
          </div>

          <div className="my-3 h-px bg-white/10" />

          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Karte & Position</div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={props.onRequestMyLocation} className="rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs hover:bg-white/15">
                Position holen
              </button>
              <button
                onClick={props.onZoomToMyPos}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-60"
                disabled={!props.hasMyPos}
                title={props.hasMyPos ? "Auf Eigenposition zentrieren" : "Erst Eigenposition holen"}
              >
                Zentrieren
              </button>
              <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/75">
                <input
                  type="checkbox"
                  checked={props.showMyRings}
                  onChange={(e) => props.setShowMyRings(e.target.checked)}
                  disabled={!props.hasMyPos}
                />
                Ringe
              </label>
            </div>
            {props.geoStatus ? <div className="text-[11px] text-white/55">{props.geoStatus}</div> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
