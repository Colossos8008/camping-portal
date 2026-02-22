// src/app/map/ts2-editor.tsx
"use client";

export type TSHaltung = "DNA" | "EXPLORER";

export type TS2Detail = {
  haltung: TSHaltung;
  note: string;
};

type Props = {
  value: TS2Detail | null | undefined;
  onChange: (next: TS2Detail) => void;
  disabled?: boolean;
};

function blank(): TS2Detail {
  return { haltung: "DNA", note: "" };
}

function normalize(input: any): TS2Detail {
  if (!input || typeof input !== "object") return blank();
  const haltung: TSHaltung = input.haltung === "EXPLORER" ? "EXPLORER" : "DNA";
  const note = typeof input.note === "string" ? input.note : input.note == null ? "" : String(input.note);
  return { haltung, note };
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

export default function Ts2Editor(props: Props) {
  const v = normalize(props.value);

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Törtchensystem 2.0</div>
          <div className="mt-1 text-xs opacity-70">Haltung - {v.haltung === "DNA" ? "DNA" : "Explorer"}</div>
        </div>

        <div className="flex items-center gap-2">
          <SegButton
            active={v.haltung === "DNA"}
            label="🧬 DNA"
            onClick={() => props.onChange({ ...v, haltung: "DNA" })}
            disabled={props.disabled}
          />
          <SegButton
            active={v.haltung === "EXPLORER"}
            label="🧭 Explorer"
            onClick={() => props.onChange({ ...v, haltung: "EXPLORER" })}
            disabled={props.disabled}
          />
        </div>
      </div>

      <div className="my-3 h-px bg-white/10" />

      <div>
        <div className="mb-1 text-xs font-semibold opacity-80">Notiz (optional)</div>
        <textarea
          className="min-h-[64px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
          value={String(v.note ?? "")}
          onChange={(e) => props.onChange({ ...v, note: e.target.value })}
          placeholder="• Warum DNA oder Explorer"
          disabled={props.disabled}
        />
      </div>
    </div>
  );
}