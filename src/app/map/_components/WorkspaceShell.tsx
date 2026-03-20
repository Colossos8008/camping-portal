"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type WorkspaceTabId = "PLACES" | "TRIP" | "DETAIL" | "FILTERS";
export type WorkspaceSheetSnap = "peek" | "half" | "full";

type WorkspaceTab = {
  id: WorkspaceTabId;
  label: string;
  badge?: string | number | null;
};

type Props = {
  isMobile: boolean;
  mode: "DISCOVER" | "TRIP";
  onModeChange: (mode: "DISCOVER" | "TRIP") => void;
  toolbar: ReactNode;
  mobileAction?: ReactNode;
  map: ReactNode;
  panelTitle: string;
  panelSubtitle?: string;
  tabs: WorkspaceTab[];
  activeTab: WorkspaceTabId;
  onTabChange: (tab: WorkspaceTabId) => void;
  mobileSnap: WorkspaceSheetSnap;
  onMobileSnapChange: (snap: WorkspaceSheetSnap) => void;
  panelContent: ReactNode;
};

function tabButtonClass(active: boolean) {
  return active
    ? "border-[#f6c453]/40 bg-[#f6c453]/15 text-[#fff1cc]"
    : "border-white/10 bg-white/5 text-white/75 hover:bg-white/10";
}

export default function WorkspaceShell(props: Props) {
  const mobileHeightFractions: Record<WorkspaceSheetSnap, number> = {
    peek: 0.22,
    half: 0.48,
    full: 0.82,
  };
  const dragStartYRef = useRef<number | null>(null);
  const dragStartHeightRef = useRef<number | null>(null);
  const liveDragHeightRef = useRef<number | null>(null);
  const currentHeightRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [mobileHeightPx, setMobileHeightPx] = useState<number | null>(null);

  useEffect(() => {
    function syncViewportHeight() {
      setViewportHeight(window.innerHeight);
    }

    syncViewportHeight();
    window.addEventListener("resize", syncViewportHeight);
    return () => window.removeEventListener("resize", syncViewportHeight);
  }, []);

  const snapHeightsPx = useMemo(
    () => ({
      peek: Math.round(viewportHeight * mobileHeightFractions.peek),
      half: Math.round(viewportHeight * mobileHeightFractions.half),
      full: Math.round(viewportHeight * mobileHeightFractions.full),
    }),
    [viewportHeight]
  );
  const minHeightPx = useMemo(() => 58, []);
  const maxHeightPx = useMemo(() => Math.max(minHeightPx + 120, viewportHeight), [minHeightPx, viewportHeight]);
  const suggestedHeightPx = snapHeightsPx[props.mobileSnap] ?? Math.round(viewportHeight * 0.48);
  const currentHeightPx = mobileHeightPx ?? Math.max(minHeightPx, Math.min(maxHeightPx, suggestedHeightPx));

  useEffect(() => {
    currentHeightRef.current = currentHeightPx;
    if (!isDragging && sheetRef.current) {
      sheetRef.current.style.transition = "height 240ms cubic-bezier(0.22, 1, 0.36, 1)";
      sheetRef.current.style.height = currentHeightPx > 0 ? `${currentHeightPx}px` : "";
    }
  }, [currentHeightPx, isDragging]);

  useEffect(() => {
    if (!viewportHeight) return;
    setMobileHeightPx((current) => {
      if (current == null) return Math.max(minHeightPx, Math.min(maxHeightPx, suggestedHeightPx));
      return Math.max(minHeightPx, Math.min(maxHeightPx, current));
    });
  }, [maxHeightPx, minHeightPx, suggestedHeightPx, viewportHeight]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  function applyLiveHeight(nextHeight: number) {
    liveDragHeightRef.current = nextHeight;
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const height = liveDragHeightRef.current;
      if (height == null || !sheetRef.current) return;
      sheetRef.current.style.height = `${height}px`;
    });
  }

  function beginDrag(clientY: number) {
    dragStartYRef.current = clientY;
    dragStartHeightRef.current = currentHeightPx;
    liveDragHeightRef.current = currentHeightPx;
    if (sheetRef.current) sheetRef.current.style.transition = "none";
    setIsDragging(true);
  }

  function getDraggedHeight(clientY: number) {
    const startY = dragStartYRef.current;
    const startHeight = dragStartHeightRef.current;
    if (startY == null || startHeight == null) return null;

    const nextHeight = startHeight - (clientY - startY);
    return Math.max(minHeightPx, Math.min(maxHeightPx, nextHeight));
  }

  function updateDrag(clientY: number) {
    const clampedHeight = getDraggedHeight(clientY);
    if (clampedHeight == null) return;
    applyLiveHeight(clampedHeight);
  }

  function finishDrag(clientY: number) {
    const clampedHeight = getDraggedHeight(clientY);
    dragStartYRef.current = null;
    dragStartHeightRef.current = null;
    if (clampedHeight != null) {
      currentHeightRef.current = clampedHeight;
      if (sheetRef.current) sheetRef.current.style.transition = "height 240ms cubic-bezier(0.22, 1, 0.36, 1)";
      setMobileHeightPx(clampedHeight);
    }
    setIsDragging(false);
  }

  if (props.isMobile) {
    return (
      <div className="relative h-[100svh] w-full overflow-hidden bg-[#050607] text-white">
        <div className="absolute inset-0">{props.map}</div>

        <div
          ref={sheetRef}
          className={`absolute inset-x-0 bottom-0 z-[4100] rounded-t-[28px] border border-white/10 ${
            isDragging
              ? "bg-[#111314] shadow-[0_-10px_24px_rgba(0,0,0,0.28)]"
              : "bg-[#111314]/95 shadow-[0_-18px_48px_rgba(0,0,0,0.45)] backdrop-blur-xl"
          }`}
          style={{
            height: currentHeightPx > 0 ? `${currentHeightPx}px` : undefined,
            maxHeight: `${maxHeightPx}px`,
            willChange: "height",
            contain: "layout style paint",
            transform: "translateZ(0)",
          }}
        >
          <div className="flex h-full flex-col">
            <div className={`overflow-hidden px-4 pt-3 ${isDragging ? "select-none" : ""}`}>
              <div
                className="mx-auto flex h-6 w-20 items-center justify-center [touch-action:none]"
                onPointerDown={(event) => beginDrag(event.clientY)}
                onPointerMove={(event) => {
                  if (!isDragging) return;
                  updateDrag(event.clientY);
                }}
                onPointerUp={(event) => finishDrag(event.clientY)}
                onPointerCancel={() => {
                  dragStartYRef.current = null;
                  dragStartHeightRef.current = null;
                  if (sheetRef.current) sheetRef.current.style.transition = "height 240ms cubic-bezier(0.22, 1, 0.36, 1)";
                  setIsDragging(false);
                }}
                onTouchStart={(event) => beginDrag(event.touches[0]?.clientY ?? 0)}
                onTouchMove={(event) => updateDrag(event.touches[0]?.clientY ?? 0)}
                onTouchEnd={(event) => finishDrag(event.changedTouches[0]?.clientY ?? dragStartYRef.current ?? 0)}
                onTouchCancel={() => {
                  dragStartYRef.current = null;
                  dragStartHeightRef.current = null;
                  if (sheetRef.current) sheetRef.current.style.transition = "height 240ms cubic-bezier(0.22, 1, 0.36, 1)";
                  setIsDragging(false);
                }}
              >
                <div className="h-1.5 w-12 rounded-full bg-white/20" />
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-1">
                  <button
                    type="button"
                    onClick={() => props.onModeChange("DISCOVER")}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                      props.mode === "DISCOVER" ? "bg-[#f6c453] text-black" : "text-white/70 hover:text-white"
                    }`}
                  >
                    Entdecken
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onModeChange("TRIP")}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                      props.mode === "TRIP" ? "bg-[#f6c453] text-black" : "text-white/70 hover:text-white"
                    }`}
                  >
                    Trip
                  </button>
                </div>

                {props.mobileAction}
              </div>

              <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                {props.tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => props.onTabChange(tab.id)}
                    className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium ${tabButtonClass(
                      props.activeTab === tab.id
                    )}`}
                  >
                    <span>{tab.label}</span>
                    {tab.badge != null && tab.badge !== "" ? (
                      <span className="rounded-full bg-black/30 px-1.5 py-0.5 text-[10px] text-white/80">{tab.badge}</span>
                    ) : null}
                  </button>
                ))}
              </div>

              <div className="mt-1 min-w-0">
                <div className="text-sm font-semibold">{props.panelTitle}</div>
                {props.panelSubtitle ? <div className="mt-0.5 text-[11px] text-white/55">{props.panelSubtitle}</div> : null}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden px-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
              {props.panelContent}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100svh] w-full flex-col bg-[#050607] text-white">
      <div className="shrink-0 px-4 pb-3 pt-4">
        <div className="rounded-[28px] border border-white/10 bg-black/50 p-3 shadow-[0_18px_55px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          {props.toolbar}
        </div>
      </div>

      <div className="min-h-0 flex-1 px-4 pb-4">
        <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_420px] gap-4">
          <div className="min-h-0 overflow-hidden rounded-[32px] border border-white/10 bg-white/5 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
            {props.map}
          </div>

          <div className="min-h-0 overflow-hidden rounded-[32px] border border-white/10 bg-[#111314]/92 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
            <div className="flex h-full flex-col">
              <div className="border-b border-white/10 px-4 py-4">
                <div className="text-sm font-semibold">{props.panelTitle}</div>
                {props.panelSubtitle ? <div className="mt-1 text-xs text-white/55">{props.panelSubtitle}</div> : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  {props.tabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => props.onTabChange(tab.id)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium ${tabButtonClass(
                        props.activeTab === tab.id
                      )}`}
                    >
                      <span>{tab.label}</span>
                      {tab.badge != null && tab.badge !== "" ? (
                        <span className="rounded-full bg-black/30 px-1.5 py-0.5 text-[10px] text-white/80">{tab.badge}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden p-3">{props.panelContent}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
