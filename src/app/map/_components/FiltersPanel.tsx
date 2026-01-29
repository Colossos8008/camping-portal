// src/app/map/_components/FiltersPanel.tsx
"use client";

import type { Dispatch, SetStateAction } from "react";

export default function FiltersPanel(props: {
  filtersOpen: boolean;
  setFiltersOpen: Dispatch<SetStateAction<boolean>>;

  showStellplatz: boolean;
  setShowStellplatz: Dispatch<SetStateAction<boolean>>;
  showCampingplatz: boolean;
  setShowCampingplatz: Dispatch<SetStateAction<boolean>>;
  showSehens: boolean;
  setShowSehens: Dispatch<SetStateAction<boolean>>;

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

  onRefresh: () => void;
}) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/5 ${props.filtersOpen ? "p-4" : "p-3"}`}>
      <div className="flex items-center justify-between">
        <button
          onClick={() => props.setFiltersOpen((v) => !v)}
          className="text-sm font-semibold hover:opacity-90"
          title={props.filtersOpen ? "Filter ausblenden" : "Filter einblenden"}
        >
          Filter <span className="ml-1 opacity-60">{props.filtersOpen ? "▾" : "▸"}</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={props.onRefresh}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
          >
            Refresh
          </button>

          <button
            onClick={() => props.setFiltersOpen((v) => !v)}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
          >
            {props.filtersOpen ? "Ausblenden" : "Einblenden"}
          </button>
        </div>
      </div>

      {props.filtersOpen ? (
        <>
          <div className="my-3 h-px bg-white/10" />

          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={props.showStellplatz}
                onChange={(e) => props.setShowStellplatz(e.target.checked)}
              />
              Stellplatz
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={props.showCampingplatz}
                onChange={(e) => props.setShowCampingplatz(e.target.checked)}
              />
              Campingplatz
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={props.showSehens} onChange={(e) => props.setShowSehens(e.target.checked)} />
              Sehenswürdigkeit
            </label>

            <div className="col-span-2 my-1 h-px bg-white/10" />

            <label className="flex items-center gap-2">
              <input type="checkbox" checked={props.fDog} onChange={(e) => props.setFDog(e.target.checked)} />
              Hunde
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={props.fSan} onChange={(e) => props.setFSan(e.target.checked)} />
              Sanitär
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={props.fYear} onChange={(e) => props.setFYear(e.target.checked)} />
              Ganzjährig
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={props.fOnline} onChange={(e) => props.setFOnline(e.target.checked)} />
              Online
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={props.fGastro} onChange={(e) => props.setFGastro(e.target.checked)} />
              Gastro
            </label>
          </div>
        </>
      ) : null}
    </div>
  );
}
