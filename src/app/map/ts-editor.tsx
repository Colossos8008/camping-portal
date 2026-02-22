// src/app/map/ts-editor.tsx
"use client";

import { useMemo } from "react";

export type TSValue = "STIMMIG" | "OKAY" | "PASST_NICHT";

export type RatingDetail = {
  tsUmgebung: TSValue;
  tsPlatzStruktur: TSValue;
  tsSanitaer: TSValue;
  tsBuchung: TSValue;
  tsHilde: TSValue;
  tsPreisLeistung: TSValue;
  tsNachklang: TSValue;
  totalPoints: number;
  note: string;
  cUmgebung: string;
  cPlatzStruktur: string;
  cSanitaer: string;
  cBuchung: string;
  cHilde: string;
  cPreisLeistung: string;
  cNachklang: string;
};

type Props = {
  rating: RatingDetail;
  onChange: (next: RatingDetail, computedTotal: number) => void;
  disabled?: boolean;
};

const TS_DEFAULT: TSValue = "OKAY";

function blankRating(): RatingDetail {
  return {
    tsUmgebung: TS_DEFAULT,
    tsPlatzStruktur: TS_DEFAULT,
    tsSanitaer: TS_DEFAULT,
    tsBuchung: TS_DEFAULT,
    tsHilde: TS_DEFAULT,
    tsPreisLeistung: TS_DEFAULT,
    tsNachklang: TS_DEFAULT,
    totalPoints: 7,
    note: "",
    cUmgebung: "",
    cPlatzStruktur: "",
    cSanitaer: "",
    cBuchung: "",
    cHilde: "",
    cPreisLeistung: "",
    cNachklang: "",
  };
}

function normTS(v: any): TSValue {
  return v === "STIMMIG" || v === "OKAY" || v === "PASST_NICHT" ? v : TS_DEFAULT;
}

function tsPoints(v: TSValue): number {
  if (v === "STIMMIG") return 2;
  if (v === "OKAY") return 1;
  return 0;
}

function computeTotal(rd: RatingDetail): number {
  return (
    tsPoints(normTS(rd.tsUmgebung)) +
    tsPoints(normTS(rd.tsPlatzStruktur)) +
    tsPoints(normTS(rd.tsSanitaer)) +
    tsPoints(normTS(rd.tsBuchung)) +
    tsPoints(normTS(rd.tsHilde)) +
    tsPoints(normTS(rd.tsPreisLeistung)) +
    tsPoints(normTS(rd.tsNachklang))
  );
}

function SelectRow(props: {
  label: string;
  value: TSValue;
  onChange: (v: TSValue) => void;
  commentValue: string;
  onChangeComment: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{props.label}</div>
          <div className="mt-1 text-[11px] opacity-60">stimmig 2 - okay 1 - passt nicht 0</div>
        </div>

        <select
          className="shrink-0 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value as TSValue)}
          disabled={props.disabled}
        >
          <option value="STIMMIG">stimmig</option>
          <option value="OKAY">okay</option>
          <option value="PASST_NICHT">passt nicht</option>
        </select>
      </div>

      <div className="mt-2">
        <input
          className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
          placeholder="Kommentar (optional)"
          value={props.commentValue}
          onChange={(e) => props.onChangeComment(e.target.value)}
          disabled={props.disabled}
        />
      </div>
    </div>
  );
}

export default function TsEditor(props: Props) {
  const rd = props.rating ?? blankRating();

  const normalized = useMemo(() => {
    const b = blankRating();
    const next: RatingDetail = {
      ...b,
      ...rd,
      tsUmgebung: normTS((rd as any).tsUmgebung),
      tsPlatzStruktur: normTS((rd as any).tsPlatzStruktur),
      tsSanitaer: normTS((rd as any).tsSanitaer),
      tsBuchung: normTS((rd as any).tsBuchung),
      tsHilde: normTS((rd as any).tsHilde),
      tsPreisLeistung: normTS((rd as any).tsPreisLeistung),
      tsNachklang: normTS((rd as any).tsNachklang),
      note: typeof (rd as any).note === "string" ? (rd as any).note : "",
      cUmgebung: typeof (rd as any).cUmgebung === "string" ? (rd as any).cUmgebung : "",
      cPlatzStruktur: typeof (rd as any).cPlatzStruktur === "string" ? (rd as any).cPlatzStruktur : "",
      cSanitaer: typeof (rd as any).cSanitaer === "string" ? (rd as any).cSanitaer : "",
      cBuchung: typeof (rd as any).cBuchung === "string" ? (rd as any).cBuchung : "",
      cHilde: typeof (rd as any).cHilde === "string" ? (rd as any).cHilde : "",
      cPreisLeistung: typeof (rd as any).cPreisLeistung === "string" ? (rd as any).cPreisLeistung : "",
      cNachklang: typeof (rd as any).cNachklang === "string" ? (rd as any).cNachklang : "",
      totalPoints: Number.isFinite(Number((rd as any).totalPoints)) ? Number((rd as any).totalPoints) : b.totalPoints,
    };
    return next;
  }, [rd]);

  const total = useMemo(() => computeTotal(normalized), [normalized]);

  function patch(next: Partial<RatingDetail>) {
    const merged: RatingDetail = { ...normalized, ...next };
    const computed = computeTotal(merged);
    props.onChange({ ...merged, totalPoints: computed }, computed);
  }

  return (
    <div className="space-y-3">
      <SelectRow
        label="Umgebung"
        value={normalized.tsUmgebung}
        onChange={(v) => patch({ tsUmgebung: v })}
        commentValue={normalized.cUmgebung}
        onChangeComment={(v) => patch({ cUmgebung: v })}
        disabled={props.disabled}
      />

      <SelectRow
        label="Platz - Struktur"
        value={normalized.tsPlatzStruktur}
        onChange={(v) => patch({ tsPlatzStruktur: v })}
        commentValue={normalized.cPlatzStruktur}
        onChangeComment={(v) => patch({ cPlatzStruktur: v })}
        disabled={props.disabled}
      />

      <SelectRow
        label="Sanitär"
        value={normalized.tsSanitaer}
        onChange={(v) => patch({ tsSanitaer: v })}
        commentValue={normalized.cSanitaer}
        onChangeComment={(v) => patch({ cSanitaer: v })}
        disabled={props.disabled}
      />

      <SelectRow
        label="Buchung"
        value={normalized.tsBuchung}
        onChange={(v) => patch({ tsBuchung: v })}
        commentValue={normalized.cBuchung}
        onChangeComment={(v) => patch({ cBuchung: v })}
        disabled={props.disabled}
      />

      <SelectRow
        label="Hilde"
        value={normalized.tsHilde}
        onChange={(v) => patch({ tsHilde: v })}
        commentValue={normalized.cHilde}
        onChangeComment={(v) => patch({ cHilde: v })}
        disabled={props.disabled}
      />

      <SelectRow
        label="Preis - Leistung"
        value={normalized.tsPreisLeistung}
        onChange={(v) => patch({ tsPreisLeistung: v })}
        commentValue={normalized.cPreisLeistung}
        onChangeComment={(v) => patch({ cPreisLeistung: v })}
        disabled={props.disabled}
      />

      <SelectRow
        label="Nachklang"
        value={normalized.tsNachklang}
        onChange={(v) => patch({ tsNachklang: v })}
        commentValue={normalized.cNachklang}
        onChangeComment={(v) => patch({ cNachklang: v })}
        disabled={props.disabled}
      />

      <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Gesamt</div>
          <div className="text-sm font-semibold opacity-90">{total}/14</div>
        </div>

        <div className="mt-2">
          <div className="mb-1 text-xs font-semibold opacity-80">Notiz (optional)</div>
          <textarea
            className="min-h-[76px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
            value={String(normalized.note ?? "")}
            onChange={(e) => patch({ note: e.target.value })}
            placeholder="• Freitext zum Ort"
            disabled={props.disabled}
          />
        </div>
      </div>
    </div>
  );
}