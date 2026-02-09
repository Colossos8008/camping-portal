// src/app/map/_components/CollapsiblePanel.tsx
"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";

type Props = {
  title: string;

  icon?: string;

  defaultOpen?: boolean;

  open?: boolean;
  onOpenChange?: (v: boolean) => void;

  rightHint?: string | ReactNode;

  className?: string;

  children: ReactNode;
};

function isControlled(open: unknown): open is boolean {
  return typeof open === "boolean";
}

export default function CollapsiblePanel(props: Props) {
  const controlled = useMemo(() => isControlled(props.open), [props.open]);

  const [internalOpen, setInternalOpen] = useState<boolean>(props.defaultOpen ?? true);

  useEffect(() => {
    if (!controlled) return;
    setInternalOpen(!!props.open);
  }, [controlled, props.open]);

  const open = controlled ? !!props.open : internalOpen;

  function setOpen(next: boolean) {
    if (!controlled) setInternalOpen(next);
    props.onOpenChange?.(next);
  }

  return (
    <div className={`rounded-2xl border border-white/10 bg-white/5 ${props.className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-center gap-2">
          {props.icon ? <div className="shrink-0 text-base leading-none">{props.icon}</div> : null}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{props.title}</div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {props.rightHint ? <div className="text-xs opacity-70">{props.rightHint}</div> : null}

          <div
            className={`text-xs opacity-70 transition-transform ${open ? "rotate-180" : "rotate-0"}`}
            aria-hidden="true"
          >
            ▼
          </div>
        </div>
      </button>

      {open ? <div className="px-4 pb-4">{props.children}</div> : null}
    </div>
  );
}
