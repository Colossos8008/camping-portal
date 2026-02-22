// src/app/map/ts21-editor.tsx
"use client";

import { useMemo } from "react";

export type TS21Source = "AI" | "USER";
export type TS21Value = "S" | "O" | "X";
export type TS21Scores = Record<string, TS21Value>;

export type TS21Detail = {
  activeSource: TS21Source;
  ai: TS21Scores;
  user: TS21Scores;

  dna: boolean;
  explorer: boolean;
  dnaExplorerNote: string;

  note: string;
};

type Props = {
  value: TS21Detail | null | undefined;
  onChange: (next: TS21Detail) => void;
  disabled?: boolean;
};

type Row = {
  key: string;
  label: string;
};

const BLOCKS: { title: string; rows: Row[] }[] = [
  {
    title: "Hund",
    rows: [
      { key: "1a", label: "Hund am Platz" },
      { key: "1b", label: "Gassi & Umfeld" },
    ],
  },
  {
    title: "Ablauf",
    rows: [
      { key: "2a", label: "Buchung" },
      { key: "2b", label: "Ankommen" },
    ],
  },
  {
    title: "Platz",
    rows: [
      { key: "3", label: "Sanitär" },
      { key: "4a", label: "Umgebung" },
      { key: "4b", label: "Stellplatz" },
      { key: "5", label: "Ruhe/Nachtruhe" },
      { key: "6", label: "Nachklang" },
      { key: "7", label: "Wiederkommen" },
    ],
  },
];

function blank(): TS21Detail {
  return {
    activeSource: "AI",
    ai: {},
    user: {},
    dna: false,
    explorer: false,
    dnaExplorerNote: "",
    note: "",
  };
}

function normValue(v: any): TS21Value {
  return v === "S" || v === "O" || v === "X" ? v : "O";
}

function ensureScores(v: any): TS21Scores {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: TS21Scores = {};
  for (const k of Object.keys(v)) out[String(k)] = normValue((v as any)[k]);
  return out;
}

function normalizeDetail(input: any): TS21Detail {
  if (!input || typeof input !== "object") return blank();

  const activeSource: TS21Source = input.activeSource === "USER" ? "USER" : "AI";
  const ai = ensureScores(input.ai);
  const user = ensureScores(input.user);

  const dna = !!input.dna;
  const explorer = !!input.explorer;

  // mutual exclusive – falls kaputte Daten kommen
  const fixedDna = dna && explorer ? true : dna;
  const fixedExplorer = dna && explorer ? false : explorer;

  const dnaExplorerNote =
    typeof input.dnaExplorerNote === "string" ? input.dnaExplorerNote : input.dnaExplorerNote == null ? "" : String(input.dnaExplorerNote);

  const note = typeof input.note === "string" ? input.note : input.note == null ? "" : String(input.note);

  return { activeSource, ai, user, dna: fixedDna, explorer: fixedExplorer, dnaExplorerNote, note };
}

function tsToPoints(v: TS21Value): number {
  if (v === "S") return 2;
  if (v === "O") return 1;
  return 0;
}

function computeTotal(scores: TS21Scores): number {
  const keys = ["1a", "1b", "2a", "2b", "3", "4a", "4b", "5", "6", "7"];
  let sum = 0;
  for (const k of keys) sum += tsToPoints(normValue(scores[k]));
  return sum;
}

function SegButton(props: { active: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
        props.active ? "border-white/30 bg-white/15" : "border-white/10 bg-white/5 hover:bg-white/10"
      } disabled:opacity-60`}
    >
      {props.label}
    </button>
  );
}

function Select(props: { label: string; value: TS21Value; onChange: (v: TS21Value) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
      <span className="text-sm">{props.label}</span>
      <select
        className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-sm outline-none"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value as TS21Value)}
        disabled={props.disabled}
      >
        <option value="S">stimmig (2)</option>
        <option value="O">okay (1)</option>
        <option value="X">passt nicht (0)</option>
      </select>
    </label>
  );
}

export default function Ts21Editor(props: Props) {
  const v = useMemo(() => normalizeDetail(props.value), [props.value]);

  const active: TS21Source = v.activeSource === "USER" ? "USER" : "AI";
  const activeScores = active === "USER" ? v.user : v.ai;

  const totalActive = useMemo(() => computeTotal(activeScores), [activeScores, active]);
  const totalAI = useMemo(() => computeTotal(v.ai), [v.ai]);
  const totalUser = useMemo(() => computeTotal(v.user), [v.user]);

  function setActiveSource(next: TS21Source) {
    props.onChange({ ...v, activeSource: next });
  }

  function patchScore(key: string, nextVal: TS21Value) {
    const val = normValue(nextVal);
    if (active === "USER") {
      props.onChange({ ...v, user: { ...v.user, [key]: val } });
    } else {
      props.onChange({ ...v, ai: { ...v.ai, [key]: val } });
    }
  }

  function toggleDNA() {
    if (v.dna) {
      props.onChange({ ...v, dna: false, explorer: false });
      return;
    }
    props.onChange({ ...v, dna: true, explorer: false });
  }

  function toggleExplorer() {
    if (v.explorer) {
      props.onChange({ ...v, dna: false, explorer: false });
      return;
    }
    props.onChange({ ...v, dna: false, explorer: true });
  }

  const haltungLabel = v.explorer ? "Explorer" : v.dna ? "DNA" : "—";

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Törtchensystem</div>
          <div className="mt-1 text-xs opacity-70">
            Aktiv - {active === "USER" ? "Wir" : "KI"} - {totalActive}/20
          </div>
          <div className="mt-1 text-[11px] opacity-60">KI {totalAI}/20 - Wir {totalUser}/20</div>
        </div>

        <div className="flex items-center gap-2">
          <SegButton active={active === "AI"} label="🤖 KI" onClick={() => setActiveSource("AI")} disabled={props.disabled} />
          <SegButton active={active === "USER"} label="👤 Wir" onClick={() => setActiveSource("USER")} disabled={props.disabled} />
        </div>
      </div>

      <div className="my-3 h-px bg-white/10" />

      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold opacity-80">Haltung</div>
          <div className="text-[11px] opacity-70">Aktiv - {haltungLabel}</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SegButton active={!!v.dna} label="🧬 DNA" onClick={toggleDNA} disabled={props.disabled} />
          <SegButton active={!!v.explorer} label="🧭 Explorer" onClick={toggleExplorer} disabled={props.disabled} />
        </div>

        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold opacity-80">Notiz (optional)</div>
          <textarea
            className="min-h-[76px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none disabled:opacity-60"
            value={String(v.dnaExplorerNote ?? "")}
            onChange={(e) => props.onChange({ ...v, dnaExplorerNote: e.target.value })}
            placeholder="Warum DNA oder Explorer"
            disabled={props.disabled}
          />
        </div>
      </div>

      <div className="my-3 h-px bg-white/10" />

      <div className="space-y-3">
        {BLOCKS.map((b) => (
          <div key={b.title} className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="mb-2 text-xs font-semibold opacity-80">{b.title}</div>
            <div className="grid grid-cols-1 gap-2">
              {b.rows.map((r) => (
                <Select
                  key={r.key}
                  label={r.label}
                  value={normValue(activeScores[r.key])}
                  onChange={(val) => patchScore(r.key, val)}
                  disabled={props.disabled}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="my-3 h-px bg-white/10" />

      <div>
        <div className="mb-1 text-xs font-semibold opacity-80">Notiz (optional)</div>
        <textarea
          className="min-h-[76px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
          value={String(v.note ?? "")}
          onChange={(e) => props.onChange({ ...v, note: e.target.value })}
          placeholder="Kontext zur Bewertung"
          disabled={props.disabled}
        />
      </div>
    </div>
  );
}