"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

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

function tsToPoints(v: TSValue): number {
  if (v === "STIMMIG") return 2;
  if (v === "OKAY") return 1;
  return 0;
}

function computeTotal(r: RatingDetail): number {
  return (
    tsToPoints(r.tsUmgebung) +
    tsToPoints(r.tsPlatzStruktur) +
    tsToPoints(r.tsSanitaer) +
    tsToPoints(r.tsBuchung) +
    tsToPoints(r.tsHilde) +
    tsToPoints(r.tsPreisLeistung) +
    tsToPoints(r.tsNachklang)
  );
}

function normalizeBullets(v: string): string {
  const s = String(v ?? "");
  if (!s.trim()) return "";
  const lines = s.replace(/\r\n/g, "\n").split("\n");
  const out = lines.map((line) => {
    const t = line.trim();
    if (!t) return "";
    if (t.startsWith("•")) return "• " + t.replace(/^•\s*/, "");
    if (t.startsWith("- ")) return "• " + t.slice(2);
    if (t.startsWith("* ")) return "• " + t.slice(2);
    return "• " + t;
  });
  return out.join("\n");
}

function insertAt(s: string, insert: string, start: number, end: number) {
  return s.slice(0, start) + insert + s.slice(end);
}

function isLineOnlyBullet(line: string) {
  return line.trim() === "•" || line.trim() === "• ";
}

function useBulletTextarea(enabled: boolean) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>, value: string, setValue: (next: string) => void) => {
      if (!enabled) return;

      const el = e.currentTarget;
      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;

      if (e.key === "Enter") {
        e.preventDefault();
        const next = insertAt(value, "\n• ", start, end);
        setValue(next);
        requestAnimationFrame(() => {
          const pos = start + 3;
          el.setSelectionRange(pos, pos);
        });
        return;
      }

      if (e.key === "Backspace") {
        const v = value;
        const caret = start;
        if (start !== end) return;

        const before = v.slice(0, caret);
        const lineStart = before.lastIndexOf("\n") + 1;
        const line = v.slice(lineStart, caret);

        if (isLineOnlyBullet(line)) {
          e.preventDefault();
          const removeFrom = lineStart;
          const removeTo = caret;
          const next = v.slice(0, removeFrom) + v.slice(removeTo);
          setValue(next);
          requestAnimationFrame(() => {
            const pos = Math.max(removeFrom, 0);
            el.setSelectionRange(pos, pos);
          });
        }
      }
    },
    [enabled]
  );

  const onBlur = useCallback(
    (value: string, setValue: (next: string) => void) => {
      if (!enabled) return;
      const norm = normalizeBullets(value);
      if (norm !== value) setValue(norm);
    },
    [enabled]
  );

  const onFocus = useCallback(
    (value: string, setValue: (next: string) => void) => {
      if (!enabled) return;
      if (!String(value ?? "").trim()) {
        setValue("• ");
        requestAnimationFrame(() => {
          const el = ref.current;
          if (!el) return;
          el.setSelectionRange(2, 2);
        });
      } else {
        const norm = normalizeBullets(value);
        if (norm !== value) setValue(norm);
      }
    },
    [enabled]
  );

  return { ref, onKeyDown, onBlur, onFocus };
}

function TSSelect(props: {
  label: string;
  value: TSValue;
  onChange: (v: TSValue) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
      <span className="text-sm">{props.label}</span>
      <select
        className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-sm outline-none"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value as TSValue)}
        disabled={props.disabled}
      >
        <option value="STIMMIG">stimmig</option>
        <option value="OKAY">okay</option>
        <option value="PASST_NICHT">passt nicht</option>
      </select>
    </label>
  );
}

function BulletTextarea(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const bullets = useBulletTextarea(true);

  useEffect(() => {
    if (!bullets.ref.current) return;
  }, [bullets]);

  return (
    <textarea
      ref={bullets.ref}
      className="min-h-[76px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={(e) => bullets.onKeyDown(e, props.value, props.onChange)}
      onBlur={() => bullets.onBlur(props.value, props.onChange)}
      onFocus={() => bullets.onFocus(props.value, props.onChange)}
      placeholder={props.placeholder}
      disabled={props.disabled}
    />
  );
}

export default function TsEditor({ rating, onChange, disabled }: Props) {
  const total = useMemo(() => computeTotal(rating), [rating]);

  useEffect(() => {
    if ((rating.totalPoints ?? 0) !== total) {
      onChange({ ...rating, totalPoints: total }, total);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  function patch(p: Partial<RatingDetail>) {
    const next = { ...rating, ...p };
    const computed = computeTotal(next);
    next.totalPoints = computed;
    onChange(next, computed);
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Törtchen System</div>
        <div className="text-xs opacity-70">{total}/14</div>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <TSSelect label="Umgebung" value={rating.tsUmgebung} onChange={(v) => patch({ tsUmgebung: v })} disabled={disabled} />
        <TSSelect
          label="Platz-Struktur"
          value={rating.tsPlatzStruktur}
          onChange={(v) => patch({ tsPlatzStruktur: v })}
          disabled={disabled}
        />
        <TSSelect label="Sanitär" value={rating.tsSanitaer} onChange={(v) => patch({ tsSanitaer: v })} disabled={disabled} />
        <TSSelect label="Buchung" value={rating.tsBuchung} onChange={(v) => patch({ tsBuchung: v })} disabled={disabled} />
        <TSSelect label="Hilde" value={rating.tsHilde} onChange={(v) => patch({ tsHilde: v })} disabled={disabled} />
        <TSSelect
          label="Preis-Leistung"
          value={rating.tsPreisLeistung}
          onChange={(v) => patch({ tsPreisLeistung: v })}
          disabled={disabled}
        />
        <TSSelect
          label="Nachklang"
          value={rating.tsNachklang}
          onChange={(v) => patch({ tsNachklang: v })}
          disabled={disabled}
        />
      </div>

      <div className="my-3 h-px bg-white/10" />

      <div className="space-y-2">
        <div className="text-xs font-semibold opacity-80">Notizen (Bulletpoints)</div>
        <BulletTextarea
          value={String(rating.note ?? "")}
          onChange={(v) => patch({ note: v })}
          placeholder="• ..."
          disabled={disabled}
        />

        <div className="grid grid-cols-1 gap-2">
          <details className="rounded-xl border border-white/10 bg-white/5">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold">
              Kommentare pro Kategorie (Bulletpoints)
            </summary>
            <div className="space-y-3 px-3 pb-3 pt-2">
              <div>
                <div className="mb-1 text-xs opacity-70">Umgebung</div>
                <BulletTextarea
                  value={String(rating.cUmgebung ?? "")}
                  onChange={(v) => patch({ cUmgebung: v })}
                  placeholder="• ..."
                  disabled={disabled}
                />
              </div>

              <div>
                <div className="mb-1 text-xs opacity-70">Platz-Struktur</div>
                <BulletTextarea
                  value={String(rating.cPlatzStruktur ?? "")}
                  onChange={(v) => patch({ cPlatzStruktur: v })}
                  placeholder="• ..."
                  disabled={disabled}
                />
              </div>

              <div>
                <div className="mb-1 text-xs opacity-70">Sanitär</div>
                <BulletTextarea
                  value={String(rating.cSanitaer ?? "")}
                  onChange={(v) => patch({ cSanitaer: v })}
                  placeholder="• ..."
                  disabled={disabled}
                />
              </div>

              <div>
                <div className="mb-1 text-xs opacity-70">Buchung</div>
                <BulletTextarea
                  value={String(rating.cBuchung ?? "")}
                  onChange={(v) => patch({ cBuchung: v })}
                  placeholder="• ..."
                  disabled={disabled}
                />
              </div>

              <div>
                <div className="mb-1 text-xs opacity-70">Hilde</div>
                <BulletTextarea
                  value={String(rating.cHilde ?? "")}
                  onChange={(v) => patch({ cHilde: v })}
                  placeholder="• ..."
                  disabled={disabled}
                />
              </div>

              <div>
                <div className="mb-1 text-xs opacity-70">Preis-Leistung</div>
                <BulletTextarea
                  value={String(rating.cPreisLeistung ?? "")}
                  onChange={(v) => patch({ cPreisLeistung: v })}
                  placeholder="• ..."
                  disabled={disabled}
                />
              </div>

              <div>
                <div className="mb-1 text-xs opacity-70">Nachklang</div>
                <BulletTextarea
                  value={String(rating.cNachklang ?? "")}
                  onChange={(v) => patch({ cNachklang: v })}
                  placeholder="• ..."
                  disabled={disabled}
                />
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
