"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Trip, TripPlaceStatus } from "../_lib/types";
import { formatDistanceKm, formatDriveDuration } from "../_lib/geo";

type TripStop = {
  tripPlaceId: number;
  placeId: number;
  name: string;
  typeLabel: string;
  sortOrder: number;
  dayNumber: number;
  status: TripPlaceStatus;
  note: string;
  legDistanceKm: number | null;
  legLabel: string | null;
};

type TripDayGroup = {
  dayNumber: number;
  stops: TripStop[];
  totalDistanceKm: number;
  totalDriveMinutes: number;
};

type Props = {
  trips: Array<{ id: number; name: string }>;
  trip: Trip | null;
  color: string;
  stops: TripStop[];
  groups: TripDayGroup[];
  tripOnlyMode: boolean;
  selectedPlaceId: number | null;
  selectedTripId: number | null;
  onSelectTrip: (tripId: number | null) => void;
  onSetTripOnlyMode: (next: boolean) => void;
  onSelectPlace: (placeId: number) => void;
  onCreateTrip: () => void;
  onRenameTrip: () => void;
  onDeleteTrip: () => void;
  onDuplicateStop: (tripPlaceId: number) => void;
  onReorderStops: (sourceTripPlaceId: number, targetTripPlaceId: number, position: "before" | "after") => void;
  onRemoveStop: (tripPlaceId: number) => void;
  onChangeStopStatus: (tripPlaceId: number, status: TripPlaceStatus) => void;
  onChangeStopDay: (tripPlaceId: number, dayNumber: number) => void;
  onStartNewDayFromStop: (tripPlaceId: number) => void;
};

const STATUS_LABELS: Record<TripPlaceStatus, string> = {
  GEPLANT: "geplant",
  BOOKED: "angefragt",
  CONFIRMED: "bestaetigt",
  VISITED: "besucht",
};

export default function TripPlannerPanel(props: Props) {
  const [draggingTripPlaceId, setDraggingTripPlaceId] = useState<number | null>(null);
  const [dropTargetTripPlaceId, setDropTargetTripPlaceId] = useState<number | null>(null);
  const [dropPosition, setDropPosition] = useState<"before" | "after">("before");
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const totalDistanceKm = useMemo(
    () => props.stops.reduce((sum, stop) => sum + (typeof stop.legDistanceKm === "number" ? stop.legDistanceKm : 0), 0),
    [props.stops]
  );
  const totalDriveMinutes = useMemo(
    () => props.groups.reduce((sum, group) => sum + group.totalDriveMinutes, 0),
    [props.groups]
  );
  const maxDayNumber = useMemo(() => Math.max(1, ...props.stops.map((stop) => stop.dayNumber)), [props.stops]);

  useEffect(() => {
    if (props.selectedPlaceId == null) return;
    const activeStop = props.stops.find((stop) => stop.placeId === props.selectedPlaceId);
    if (!activeStop) return;
    const node = itemRefs.current.get(activeStop.tripPlaceId);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [props.selectedPlaceId, props.stops]);

  function handleDrop(targetTripPlaceId: number) {
    if (draggingTripPlaceId == null || draggingTripPlaceId === targetTripPlaceId) return;
    props.onReorderStops(draggingTripPlaceId, targetTripPlaceId, dropPosition);
    setDraggingTripPlaceId(null);
    setDropTargetTripPlaceId(null);
    setDropPosition("before");
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5">
      <div className="border-b border-white/10 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Trip</div>
            <div className="truncate text-[10px] text-white/50">
              {props.trip ? `${props.trip.name} - ${props.stops.length} Stopps` : "Kein Trip ausgewaehlt"}
            </div>
          </div>

          <button onClick={props.onCreateTrip} className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-[11px] hover:bg-white/15">
            Neu
          </button>
        </div>

        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
          <select
            value={props.selectedTripId == null ? "" : String(props.selectedTripId)}
            onChange={(e) => props.onSelectTrip(e.target.value ? Number(e.target.value) : null)}
            className="min-w-0 rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-sm outline-none"
          >
            <option value="">kein Trip</option>
            {props.trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.name}
              </option>
            ))}
          </select>

          <button onClick={props.onRenameTrip} disabled={!props.trip} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] hover:bg-white/10 disabled:opacity-40">
            Umbenennen
          </button>
          <button onClick={props.onDeleteTrip} disabled={!props.trip} className="rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-[11px] hover:bg-red-500/15 disabled:opacity-40">
            Loeschen
          </button>
        </div>

        {props.trip ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
            <div className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">{formatDistanceKm(totalDistanceKm) ?? "0 km"}</div>
            <div className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">{props.groups.length || 1} Tage</div>
            <div className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">{formatDriveDuration(totalDriveMinutes)}</div>
            <label className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-white/75">
              <input
                type="checkbox"
                checked={props.tripOnlyMode}
                onChange={(e) => props.onSetTripOnlyMode(e.target.checked)}
                disabled={props.selectedTripId == null}
              />
              Nur Trip-Orte
            </label>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 overscroll-contain [webkit-overflow-scrolling:touch]">
        {props.trip && !props.stops.length ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-3 py-4 text-sm text-white/65">
            Noch keine Stopps. Oeffne einen Ort und fuege ihn dem Trip hinzu.
          </div>
        ) : null}

        {props.groups.map((group) => (
          <div key={group.dayNumber} className="mb-2.5">
            <div className="mb-1.5 flex items-center justify-between px-1">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/70">Tag {group.dayNumber}</div>
                <div className="text-[10px] text-white/50">{formatDriveDuration(group.totalDriveMinutes)}</div>
              </div>
              <div className="text-[11px] text-white/65">{formatDistanceKm(group.totalDistanceKm) ?? "0 km"}</div>
            </div>

            {group.stops.map((stop) => {
              const isSelected = stop.placeId === props.selectedPlaceId;
              const isDropTarget = dropTargetTripPlaceId === stop.tripPlaceId && draggingTripPlaceId !== stop.tripPlaceId;
              const previous = props.stops.find((item) => item.sortOrder === stop.sortOrder - 1);
              const next = props.stops.find((item) => item.sortOrder === stop.sortOrder + 1);

              return (
                <div key={stop.tripPlaceId} className="mb-1.5">
                  {stop.legLabel ? <div className="px-2 pb-1 text-[10px] text-white/45">{stop.legLabel}</div> : null}

                  <div
                    ref={(node) => {
                      if (node) itemRefs.current.set(stop.tripPlaceId, node);
                      else itemRefs.current.delete(stop.tripPlaceId);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (draggingTripPlaceId == null || draggingTripPlaceId === stop.tripPlaceId) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const nextPosition = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                      setDropTargetTripPlaceId(stop.tripPlaceId);
                      setDropPosition(nextPosition);
                    }}
                    onDragLeave={() => {
                      if (dropTargetTripPlaceId === stop.tripPlaceId) setDropTargetTripPlaceId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDrop(stop.tripPlaceId);
                    }}
                    className={`relative rounded-2xl border px-2.5 py-2 transition ${
                      isDropTarget
                        ? "border-sky-300 bg-sky-400/15 shadow-[0_0_0_1px_rgba(125,211,252,0.35)]"
                        : isSelected
                          ? "border-white/30 bg-white/12"
                          : "border-white/10 bg-white/5"
                    }`}
                    style={draggingTripPlaceId === stop.tripPlaceId ? { opacity: 0.55 } : undefined}
                  >
                    {isDropTarget ? (
                      <div
                        className={`pointer-events-none absolute left-3 right-3 h-1 rounded-full bg-sky-300 shadow-[0_0_12px_rgba(125,211,252,0.65)] ${
                          dropPosition === "before" ? "top-0 -translate-y-1/2" : "bottom-0 translate-y-1/2"
                        }`}
                      />
                    ) : null}

                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          setDraggingTripPlaceId(stop.tripPlaceId);
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", String(stop.tripPlaceId));
                        }}
                        onDragEnd={() => {
                          setDraggingTripPlaceId(null);
                          setDropTargetTripPlaceId(null);
                        }}
                        title="Stopp verschieben"
                        className="mt-0.5 inline-flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded-full border border-white/10 bg-white/5 text-[10px] active:cursor-grabbing"
                      >
                        ::
                      </button>

                      <button type="button" onClick={() => props.onSelectPlace(stop.placeId)} className="min-w-0 flex-1 text-left">
                        <div className="flex items-start gap-2">
                          <div
                            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-black text-black"
                            style={{ backgroundColor: props.color }}
                          >
                            {stop.sortOrder}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-semibold leading-tight">{stop.name}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-white/55">
                              <span>{stop.typeLabel}</span>
                              <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5">
                                {STATUS_LABELS[stop.status]}
                              </span>
                              <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5">Tag {stop.dayNumber}</span>
                            </div>
                            {stop.note ? <div className="mt-1 line-clamp-1 text-[10px] text-white/70">{stop.note}</div> : null}
                          </div>
                        </div>
                      </button>
                    </div>

                    <div className="mt-1.5 grid grid-cols-5 gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (previous) props.onReorderStops(stop.tripPlaceId, previous.tripPlaceId, "before");
                        }}
                        disabled={!previous}
                        className="rounded-full border border-white/10 bg-white/5 px-1.5 py-1 text-[10px] hover:bg-white/10 disabled:opacity-35"
                      >
                        Hoch
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (next) props.onReorderStops(stop.tripPlaceId, next.tripPlaceId, "after");
                        }}
                        disabled={!next}
                        className="rounded-full border border-white/10 bg-white/5 px-1.5 py-1 text-[10px] hover:bg-white/10 disabled:opacity-35"
                      >
                        Runter
                      </button>
                      <button
                        type="button"
                        onClick={() => props.onDuplicateStop(stop.tripPlaceId)}
                        className="rounded-full border border-white/10 bg-white/5 px-1.5 py-1 text-[10px] hover:bg-white/10"
                      >
                        Nochmal
                      </button>
                      <select
                        value={String(stop.dayNumber)}
                        onChange={(e) => props.onChangeStopDay(stop.tripPlaceId, Number(e.target.value))}
                        className="rounded-full border border-white/10 bg-black/30 px-1.5 py-1 text-[10px]"
                      >
                        {Array.from({ length: maxDayNumber + 1 }, (_, index) => index + 1).map((day) => (
                          <option key={day} value={day}>
                            Tag {day}
                          </option>
                        ))}
                      </select>
                      <select
                        value={stop.status}
                        onChange={(e) => props.onChangeStopStatus(stop.tripPlaceId, e.target.value as TripPlaceStatus)}
                        className="rounded-full border border-white/10 bg-black/30 px-1.5 py-1 text-[10px]"
                      >
                        {Object.entries(STATUS_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => props.onStartNewDayFromStop(stop.tripPlaceId)}
                        className="rounded-full border border-white/10 bg-white/5 px-1.5 py-1 text-[10px] hover:bg-white/10"
                      >
                        Neuer Tag ab hier
                      </button>
                      <button
                        type="button"
                        onClick={() => props.onRemoveStop(stop.tripPlaceId)}
                        className="rounded-full border border-white/10 bg-white/5 px-1.5 py-1 text-[10px] hover:bg-white/10"
                      >
                        Entfernen
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
