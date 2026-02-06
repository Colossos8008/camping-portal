// src/app/map/_components/CollapsiblePanel.tsx
"use client";

import { useEffect, useId, useState } from "react";

export default function CollapsiblePanel(props: {
  title: string;
  defaultOpen?: boolean;

  // optional controlled mode
  open?: boolean;
  onOpenChange?: (v: boolean) => void;

  rightHint?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  const id = useId();

  const isControlled = typeof props.open === "boolean" && typeof props.onOpenChange === "function";
  const [uncontrolledOpen, setUncontrolledOpen] = useState(props.defaultOpen ?? true);

  useEffect(() => {
    if (props.defaultOpen == null) return;
    if (isControlled) return;
    setUncontrolledOpen(props.defaultOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = isControlled ? (props.open as boolean) : uncontrolledOpen;

  function setOpen(next: boolean) {
    if (isControlled) {
      props.onOpenChange?.(next);
      return;
    }
    setUncontrolledOpen(next);
  }

  return (
    <div className={`overflow-hidden rounded-2xl border border-white/10 bg-white/5 ${props.className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
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
