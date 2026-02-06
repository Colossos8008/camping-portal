// src/app/map/_components/CollapsiblePanel.tsx
"use client";

import { useEffect, useId, useState } from "react";

export default function CollapsiblePanel(props: {
  title: string;
  defaultOpen?: boolean;
  rightHint?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(props.defaultOpen ?? true);

  // keep stable default on first render
  useEffect(() => {
    if (props.defaultOpen == null) return;
    setOpen(props.defaultOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`overflow-hidden rounded-2xl border border-white/10 bg-white/5 ${props.className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/5"
        aria-controls={id}
        aria-expanded={open}
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{props.title}</div>
          {props.rightHint ? <div className="mt-0.5 text-[11px] opacity-70">{props.rightHint}</div> : null}
        </div>

        <div className="shrink-0 text-sm opacity-80" aria-hidden="true">
          {open ? "▾" : "▸"}
        </div>
      </button>

      {open ? (
        <div id={id} className="border-t border-white/10">
          {props.children}
        </div>
      ) : null}
    </div>
  );
}
