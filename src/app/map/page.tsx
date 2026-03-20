// src/app/map/page.tsx
"use client";

import dynamic from "next/dynamic";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Ts21Editor, { TS21Detail } from "./ts21-editor";

import type { Place, PlaceHeroCandidate, PlaceType, SortMode, Trip, TripPlaceStatus } from "./_lib/types";
import { distanceKm, estimateDriveMinutesFromKm, formatDistanceKm } from "./_lib/geo";
import { safePlacesFromApi } from "./_lib/place";
import { getPlaceScore, getPlaceTypeLabel } from "./_lib/place-display";
import { blankRating } from "./_lib/rating";
import { normalizeDisplayText } from "./_lib/text";

import FiltersPanel from "./_components/FiltersPanel";
import PlacesList from "./_components/PlacesList";
import TogglePill from "./_components/TogglePill";
import EditorHeader from "./_components/EditorHeader";
import ImagesPanel from "./_components/ImagesPanel";
import HeroCandidatesPanel from "./_components/HeroCandidatesPanel";
import Lightbox from "./_components/Lightbox";
import CollapsiblePanel from "./_components/CollapsiblePanel";
import TripPlannerPanel from "./_components/TripPlannerPanel";
import WorkspaceShell, { type WorkspaceSheetSnap, type WorkspaceTabId } from "./_components/WorkspaceShell";

import { createClient } from "@supabase/supabase-js";

const MapClient = dynamic(() => import("./map-client"), { ssr: false });

const SUPABASE_BUCKET_DEFAULT = "place-images";

function sanitizeFilename(name: string) {
  return String(name || "image")
    .replace(/[^a-zA-Z0-9.\-_]/g, "_")
    .replace(/_+/g, "_");
}

function makeObjectKey(placeId: number, originalName: string) {
  const safe = sanitizeFilename(originalName);
  const rand = Math.random().toString(16).slice(2);
  return `places/${placeId}/${Date.now()}-${rand}-${safe}`;
}

function isMobileNow() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 1023px)").matches;
}

function isIOSNow() {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent || "";
  const isiPhone = /iPhone|iPad|iPod/i.test(ua);
  const isMacTouch = /Macintosh/i.test(ua) && (navigator as any).maxTouchPoints > 1;
  return isiPhone || isMacTouch;
}

type CoordinateReviewStatus = "UNREVIEWED" | "CORRECTED" | "CONFIRMED" | "REJECTED";
type CoordinateReviewFilter = "ALL" | CoordinateReviewStatus;
type TripFormPlacement = {
  id?: number;
  tripId: number;
  sortOrder: number;
  dayNumber: number;
  status: TripPlaceStatus;
  note: string;
};

function normalizeCoordinateReviewStatus(v: any): CoordinateReviewStatus {
  return v === "CORRECTED" || v === "CONFIRMED" || v === "REJECTED" ? v : "UNREVIEWED";
}

function coordinateReviewStatusMeta(v: any): { label: string; className: string } {
  const status = normalizeCoordinateReviewStatus(v);
  if (status === "CORRECTED") {
    return {
      label: "manuell korrigiert",
      className: "border-amber-400/40 bg-amber-500/15 text-amber-100",
    };
  }
  if (status === "CONFIRMED") {
    return {
      label: "manuell bestätigt",
      className: "border-emerald-400/40 bg-emerald-500/15 text-emerald-100",
    };
  }
  return {
    label: "ungeprüft",
    className: "border-white/20 bg-white/10 text-white/90",
  };
}

function reviewStatusActionLabel(v: any): string {
  const status = normalizeCoordinateReviewStatus(v);
  if (status === "CORRECTED") return "manuell korrigiert";
  if (status === "CONFIRMED") return "manuell bestätigt";
  return "ungeprüft";
}

function reviewDateShort(v: any): string {
  const raw = String(v ?? "").trim();
  if (!raw) return "—";
  return raw.slice(0, 10);
}


function safeNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeTripStatus(v: any): TripPlaceStatus {
  return v === "BOOKED" || v === "CONFIRMED" || v === "VISITED" ? v : "GEPLANT";
}

function tripColorForId(id: number | null): string {
  const palette = ["#f97316", "#22c55e", "#38bdf8", "#f43f5e", "#eab308", "#a78bfa", "#14b8a6"];
  if (!Number.isFinite(Number(id))) return palette[0];
  return palette[Math.abs(Number(id)) % palette.length];
}

function safeTripsFromApi(input: any): Trip[] {
  const raw = Array.isArray(input?.trips) ? input.trips : Array.isArray(input) ? input : [];
  return raw
    .map((trip: any) => {
      const id = Number(trip?.id);
      if (!Number.isFinite(id)) return null;
      return {
        id,
        name: normalizeDisplayText(trip?.name ?? ""),
        description: normalizeDisplayText(trip?.description ?? ""),
        isActive: trip?.isActive !== false,
        createdAt: typeof trip?.createdAt === "string" ? trip.createdAt : undefined,
        updatedAt: typeof trip?.updatedAt === "string" ? trip.updatedAt : undefined,
        places: Array.isArray(trip?.places)
          ? trip.places
              .map((item: any) => {
                const placeId = Number(item?.placeId);
                const sortOrder = Number(item?.sortOrder);
                if (!Number.isFinite(placeId) || !Number.isFinite(sortOrder)) return null;
                return {
                  id: Number.isFinite(Number(item?.id)) ? Number(item.id) : 0,
                  tripId: id,
                  placeId,
                  sortOrder,
                  dayNumber: Number.isFinite(Number(item?.dayNumber)) ? Math.max(1, Math.round(Number(item.dayNumber))) : 1,
                  status: normalizeTripStatus(item?.status),
                  note: normalizeDisplayText(item?.note ?? ""),
                  createdAt: typeof item?.createdAt === "string" ? item.createdAt : undefined,
                  updatedAt: typeof item?.updatedAt === "string" ? item.updatedAt : undefined,
                };
              })
              .filter(Boolean)
          : [],
      } as Trip;
    })
    .filter(Boolean) as Trip[];
}

type NavProvider = "AUTO" | "GOOGLE" | "APPLE";

function buildNavUrl(provider: Exclude<NavProvider, "AUTO">, lat: number, lng: number, label?: string) {
  const name = String(label ?? "").trim();

  if (provider === "APPLE") {
    const base = "https://maps.apple.com/";
    const params = new URLSearchParams();
    params.set("daddr", `${lat},${lng}`);
    if (name) params.set("q", name);
    return `${base}?${params.toString()}`;
  }

  const base = "https://www.google.com/maps/dir/?api=1";
  const params = new URLSearchParams();
  params.set("destination", `${lat},${lng}`);
  params.set("travelmode", "driving");
  return `${base}&${params.toString()}`;
}

type EditorSectionId = "BASICS" | "TOGGLES" | "TS" | "IMAGES" | "REVIEW";
type LightboxImage = {
  id?: number;
  filename: string;
  kind: "hero" | "gallery" | "candidate";
  source?: string;
  userFeedback?: "UP" | "DOWN" | null;
  candidateId?: number;
};

type UnifiedGalleryImage = {
  id?: number;
  filename: string;
  isHero: boolean;
};

function lightboxImageKey(image: { candidateId?: number; filename?: string | null }) {
  const candidateId = Number(image?.candidateId);
  if (Number.isFinite(candidateId)) return `candidate:${candidateId}`;
  return `file:${String(image?.filename ?? "").trim()}`;
}

function buildLightboxImages(galleryImages: UnifiedGalleryImage[], candidates: PlaceHeroCandidate[]): LightboxImage[] {
  const combined: LightboxImage[] = galleryImages.map((img) => ({
    id: img.id,
    filename: img.filename,
    kind: img.isHero ? ("hero" as const) : ("gallery" as const),
  }));

  const seen = new Set<string>(combined.map((image) => lightboxImageKey(image)));
  for (const candidate of candidates) {
    const filename = String(candidate.url ?? "").trim();
    if (!filename) continue;

    const candidateImage: LightboxImage = {
      id: candidate.id ?? undefined,
      filename,
      kind: "candidate",
      source: candidate.source,
      userFeedback: candidate.userFeedback ?? null,
      candidateId: candidate.id ?? undefined,
    };

    const key = lightboxImageKey(candidateImage);
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(candidateImage);
  }

  return combined;
}

function collapsedSections(): Record<EditorSectionId, boolean> {
  return { BASICS: false, TOGGLES: false, TS: false, IMAGES: false, REVIEW: false };
}

function loadSectionState(): Record<EditorSectionId, boolean> {
  if (typeof window === "undefined") return collapsedSections();

  try {
    const raw = window.localStorage.getItem("cp.editor.sections.v1");
    if (!raw) return collapsedSections();
    const obj = JSON.parse(raw);

    return {
      BASICS: typeof obj?.BASICS === "boolean" ? obj.BASICS : false,
      TOGGLES: typeof obj?.TOGGLES === "boolean" ? obj.TOGGLES : false,
      TS: typeof obj?.TS === "boolean" ? obj.TS : false,
      IMAGES: typeof obj?.IMAGES === "boolean" ? obj.IMAGES : false,
      REVIEW: typeof obj?.REVIEW === "boolean" ? obj.REVIEW : false,
    };
  } catch {
    return collapsedSections();
  }
}

function saveSectionState(next: Record<EditorSectionId, boolean>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("cp.editor.sections.v1", JSON.stringify(next));
  } catch {}
}

function loadFavoriteIds(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem("cp.favorites.v1");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => Number(value))
      .filter((value, index, arr) => Number.isFinite(value) && arr.indexOf(value) === index);
  } catch {
    return [];
  }
}

function saveFavoriteIds(ids: number[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("cp.favorites.v1", JSON.stringify(ids));
  } catch {}
}

function Section(props: {
  id: EditorSectionId;
  title: string;
  icon: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rightHint?: ReactNode;
  children: ReactNode;
}) {
  const open = !!props.open;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
      <button
        type="button"
        onClick={() => props.onOpenChange(!open)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="shrink-0 text-base leading-none">{props.icon}</div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{props.title}</div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {props.rightHint ? <div className="text-xs opacity-70">{props.rightHint}</div> : null}
          <div className={`text-xs opacity-70 transition-transform ${open ? "rotate-180" : "rotate-0"}`} aria-hidden="true">
            v
          </div>
        </div>
      </button>

      {open ? <div className="px-3 pb-3">{props.children}</div> : null}
    </div>
  );
}

// TS2.1 Score
type TS21Value = "S" | "O" | "X";
function ts21ToPoints(v: TS21Value): number {
  if (v === "S") return 2;
  if (v === "O") return 1;
  return 0;
}
function normTS21Value(v: any): TS21Value {
  return v === "S" || v === "O" || v === "X" ? v : "O";
}
function isTsRelevantType(t: any) {
  return t === "CAMPINGPLATZ" || t === "STELLPLATZ";
}
function ts21TotalFromDetail(raw: any): number | null {
  if (!raw || typeof raw !== "object") return null;

  const src = raw.activeSource === "USER" ? "USER" : "AI";
  const scores =
    (src === "USER" ? raw.user : raw.ai) && typeof (src === "USER" ? raw.user : raw.ai) === "object"
      ? (src === "USER" ? raw.user : raw.ai)
      : {};

  const keys = ["1a", "1b", "2a", "2b", "3", "4a", "4b", "5", "6", "7"];
  let sum = 0;
  for (const k of keys) sum += ts21ToPoints(normTS21Value((scores as any)[k]));
  return sum;
}

export default function MapPage() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  const [tripOnlyMode, setTripOnlyMode] = useState(true);
  const [listScrollSelectedToken, setListScrollSelectedToken] = useState(0);

  const [selectTick, setSelectTick] = useState(0);
  const [focusToken, setFocusToken] = useState(0);

  const [sortMode, setSortMode] = useState<SortMode>("DIST");

  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);
  const [geoStatus, setGeoStatus] = useState<string>("");

  const [myPosFocusToken, setMyPosFocusToken] = useState(0);
  const [showMyRings, setShowMyRings] = useState(true);

  const [showStellplatz, setShowStellplatz] = useState(true);
  const [showCampingplatz, setShowCampingplatz] = useState(true);
  const [showSehens, setShowSehens] = useState(true);
  const [showHvoTankstelle, setShowHvoTankstelle] = useState(true);

  const [fDog, setFDog] = useState(false);
  const [fSan, setFSan] = useState(false);
  const [fYear, setFYear] = useState(false);
  const [fOnline, setFOnline] = useState(false);
  const [fGastro, setFGastro] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<CoordinateReviewFilter>("ALL");
  const [favoriteIds, setFavoriteIds] = useState<number[]>([]);

  const [filtersOpen, setFiltersOpen] = useState(false);

  const [editingNew, setEditingNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickMode, setPickMode] = useState(false);
  const [mapPickedCoord, setMapPickedCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [pickedFiles, setPickedFiles] = useState<File[]>([]);

  const [lbOpen, setLbOpen] = useState(false);
  const [lbIndex, setLbIndex] = useState(0);
  const [lbOverrideImages, setLbOverrideImages] = useState<LightboxImage[] | null>(null);
  const [heroCandidates, setHeroCandidates] = useState<PlaceHeroCandidate[]>([]);
  const [heroCandidatesLoading, setHeroCandidatesLoading] = useState(false);
  const [heroCandidatesError, setHeroCandidatesError] = useState("");
  const [heroCandidatesReloadInfo, setHeroCandidatesReloadInfo] = useState<{ newCount: number; preservedCount: number } | null>(null);
  const [heroReloadTick, setHeroReloadTick] = useState(0);

  const [isMobile, setIsMobile] = useState<boolean>(false);

  const editorPanelRef = useRef<HTMLDivElement | null>(null);
  const mapPanelRef = useRef<HTMLDivElement | null>(null);

  const editorScrollRef = useRef<HTMLDivElement | null>(null);
  const tripAssignmentRef = useRef<HTMLDivElement | null>(null);

  const [panelMapOpen, setPanelMapOpen] = useState(true);
  const [panelEditorOpen, setPanelEditorOpen] = useState(true);
  const [panelTripOpen, setPanelTripOpen] = useState(true);
  const [panelPlacesOpen, setPanelPlacesOpen] = useState(true);
  const [workspaceMode, setWorkspaceMode] = useState<"DISCOVER" | "TRIP">("DISCOVER");
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTabId>("PLACES");
  const [mobileSheetSnap, setMobileSheetSnap] = useState<WorkspaceSheetSnap>("half");
  const [detailFocusTab, setDetailFocusTab] = useState<"CORE" | "TS" | "MEDIA" | "REVIEW" | "ALL">("CORE");

  const [form, setForm] = useState<any>({
    name: "",
    type: "CAMPINGPLATZ",
    lat: 50.33,
    lng: 7.6,
    dogAllowed: false,
    sanitary: false,
    yearRound: false,
    onlineBooking: false,
    gastronomy: false,
    ratingDetail: blankRating(),
    ts2: null,
    ts21: null,
    images: [],
    heroImageUrl: null,
    datasetHeroImageUrl: null,
    thumbnailImageId: null,
    coordinateReviewStatus: "UNREVIEWED",
    coordinateReviewSource: null,
    coordinateReviewReviewedAt: null,
    coordinateReviewNote: "",
    tripPlacements: [],
  });

  const [navOpen, setNavOpen] = useState(false);
  const [activeTripPlacementId, setActiveTripPlacementId] = useState<number | null>(null);
  const [tripPositionDraft, setTripPositionDraft] = useState("1");
  const [tripDayDraft, setTripDayDraft] = useState("1");

  const [sectionOpen, setSectionOpen] = useState<Record<EditorSectionId, boolean>>(collapsedSections());

  const geoWatchIdRef = useRef<number | null>(null);

  const handleMapPick = useCallback((lat: number, lng: number) => {
    setMapPickedCoord({ lat, lng });
  }, []);

  function scrollEditorTop() {
    requestAnimationFrame(() => {
      try {
        editorScrollRef.current?.scrollTo({ top: 0 });
      } catch {}
    });
  }

  function scrollToTripAssignment() {
    setWorkspaceTab("DETAIL");
    setDetailFocusTab("CORE");
    setSectionOpen((current) => ({ ...current, BASICS: true }));
    if (isMobile) setMobileSheetSnap("full");
    requestAnimationFrame(() => {
      try {
        tripAssignmentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {}
    });
  }

  function nextTempTripPlacementId() {
    return -Date.now() - Math.floor(Math.random() * 1000);
  }

  useEffect(() => {
    function onResize() {
      setIsMobile(isMobileNow());
    }

    setIsMobile(isMobileNow());

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    setSectionOpen(loadSectionState());
  }, []);

  useEffect(() => {
    setFavoriteIds(loadFavoriteIds());
  }, []);

  useEffect(() => {
    if (!statusMsg) return;
    const timeout = window.setTimeout(() => setStatusMsg(""), 3500);
    return () => window.clearTimeout(timeout);
  }, [statusMsg]);

  useEffect(() => {
    saveSectionState(sectionOpen);
  }, [sectionOpen]);

  useEffect(() => {
    saveFavoriteIds(favoriteIds);
  }, [favoriteIds]);

  function setSection(id: EditorSectionId, v: boolean) {
    setSectionOpen((s) => ({ ...s, [id]: v }));
  }

  function openWorkspaceTab(tab: WorkspaceTabId, snap: WorkspaceSheetSnap = "half") {
    setWorkspaceTab(tab);
    if (isMobile) setMobileSheetSnap(snap);
  }

  function applyDetailFocus(tab: "CORE" | "TS" | "MEDIA" | "REVIEW" | "ALL") {
    setDetailFocusTab(tab);
    if (tab === "CORE") {
      setSectionOpen({ BASICS: true, TOGGLES: true, TS: false, IMAGES: false, REVIEW: false });
      return;
    }
    if (tab === "TS") {
      setSectionOpen({ BASICS: false, TOGGLES: false, TS: true, IMAGES: false, REVIEW: false });
      return;
    }
    if (tab === "MEDIA") {
      setSectionOpen({ BASICS: false, TOGGLES: false, TS: false, IMAGES: true, REVIEW: false });
      return;
    }
    if (tab === "REVIEW") {
      setSectionOpen({ BASICS: false, TOGGLES: false, TS: false, IMAGES: false, REVIEW: true });
      return;
    }
    setSectionOpen({ BASICS: true, TOGGLES: true, TS: true, IMAGES: true, REVIEW: true });
  }

  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anon) return null;

    return createClient(url, anon);
  }, []);

  const supabaseBucket = useMemo(() => {
    return (process.env.NEXT_PUBLIC_SUPABASE_BUCKET || SUPABASE_BUCKET_DEFAULT).trim() || SUPABASE_BUCKET_DEFAULT;
  }, []);

  async function refreshTrips() {
    const data = await fetch("/api/trips", { cache: "no-store" }).then((r) => r.json());
    const nextTrips = safeTripsFromApi(data);
    setTrips(nextTrips);

    if (selectedTripId != null && !nextTrips.some((trip) => trip.id === selectedTripId)) {
      setSelectedTripId(null);
    }
  }

  async function refreshPlaces(keepSelection = true) {
    const data = await fetch("/api/places", { cache: "no-store" }).then((r) => r.json());
    const arr = safePlacesFromApi(data).map((p) => {
      const raw = (Array.isArray(data?.places) ? data.places : Array.isArray(data) ? data : []).find((x: any) => x?.id === p.id);
      return {
        ...p,
        coordinateReviewStatus: normalizeCoordinateReviewStatus(raw?.coordinateReviewStatus),
        coordinateReviewSource: typeof raw?.coordinateReviewSource === "string" && raw.coordinateReviewSource.trim() ? raw.coordinateReviewSource.trim() : null,
        coordinateReviewReviewedAt: typeof raw?.coordinateReviewReviewedAt === "string" && raw.coordinateReviewReviewedAt.trim() ? raw.coordinateReviewReviewedAt.trim() : null,
        coordinateReviewNote: typeof raw?.coordinateReviewNote === "string" ? raw.coordinateReviewNote : "",
      } as any;
    });
    setPlaces(arr);

    if (!keepSelection) {
      const first = arr[0]?.id ?? null;
      setSelectedId(first);
    } else {
      if (selectedId == null && arr.length) setSelectedId(arr[0].id);
    }
  }

  useEffect(() => {
    Promise.all([refreshPlaces(true), refreshTrips()]).catch(() => {
      setPlaces([]);
      setTrips([]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedPlace = useMemo(() => places.find((p) => p.id === selectedId) ?? null, [places, selectedId]);
  const selectedTrip = useMemo(() => trips.find((trip) => trip.id === selectedTripId) ?? null, [trips, selectedTripId]);
  const selectedTripColor = useMemo(() => tripColorForId(selectedTripId), [selectedTripId]);
  const activeFormTripPlacements = useMemo(
    () =>
      selectedTripId != null && Array.isArray(form?.tripPlacements)
        ? (form.tripPlacements as TripFormPlacement[]).filter((item) => item.tripId === selectedTripId)
        : [],
    [form?.tripPlacements, selectedTripId]
  );
  const activeFormTripPlacement = useMemo(() => {
    if (!activeFormTripPlacements.length) return null;
    if (activeTripPlacementId != null) {
      const match = activeFormTripPlacements.find((item) => Number(item.id) === activeTripPlacementId);
      if (match) return match;
    }
    return activeFormTripPlacements[0] ?? null;
  }, [activeFormTripPlacements, activeTripPlacementId]);
  const selectedTripStops = useMemo(() => {
    if (!selectedTrip) return [];

    const placesById = new Map(places.map((place) => [place.id, place]));
    let previousPoint: { lat: number; lng: number } | null = myPos ? { lat: myPos.lat, lng: myPos.lng } : null;

    return [...(selectedTrip.places ?? [])]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((stop) => {
        const place = placesById.get(stop.placeId);
        if (!place) return null;

        const dayNumber = Number.isFinite(Number(stop.dayNumber)) ? Math.max(1, Number(stop.dayNumber)) : 1;
        const legDistanceKm =
          previousPoint != null ? distanceKm(previousPoint.lat, previousPoint.lng, place.lat, place.lng) : null;
        const legLabel =
          previousPoint != null
            ? dayNumber === 1 && stop.sortOrder === 1 && myPos
              ? `${formatDistanceKm(legDistanceKm) ?? "-"} von deiner Position`
              : `${formatDistanceKm(legDistanceKm) ?? "-"} vom letzten Stopp`
            : null;
        previousPoint = { lat: place.lat, lng: place.lng };

        return {
          tripPlaceId: stop.id,
          placeId: place.id,
          name: place.name,
          typeLabel: getPlaceTypeLabel(place.type),
          sortOrder: stop.sortOrder,
          dayNumber,
          status: stop.status,
          note: stop.note,
          legDistanceKm,
          legDriveMinutes: estimateDriveMinutesFromKm(legDistanceKm),
          legLabel,
          lat: place.lat,
          lng: place.lng,
        };
      })
      .filter(Boolean) as Array<{
      tripPlaceId: number;
      placeId: number;
      name: string;
      typeLabel: string;
      sortOrder: number;
      dayNumber: number;
      status: TripPlaceStatus;
      note: string;
      legDistanceKm: number | null;
      legDriveMinutes: number;
      legLabel: string | null;
      lat: number;
      lng: number;
    }>;
  }, [myPos, places, selectedTrip]);

  useEffect(() => {
    if (!activeFormTripPlacements.length) {
      if (activeTripPlacementId != null) setActiveTripPlacementId(null);
      return;
    }
    if (activeTripPlacementId != null && activeFormTripPlacements.some((item) => Number(item.id) === activeTripPlacementId)) return;
    setActiveTripPlacementId(Number(activeFormTripPlacements[0]?.id ?? null));
  }, [activeFormTripPlacements, activeTripPlacementId]);

  useEffect(() => {
    setTripPositionDraft(String(activeFormTripPlacement?.sortOrder ?? 1));
    setTripDayDraft(String(activeFormTripPlacement?.dayNumber ?? 1));
  }, [activeFormTripPlacement?.id, activeFormTripPlacement?.sortOrder, activeFormTripPlacement?.dayNumber]);

  const selectedTripGroups = useMemo(() => {
    const groups = new Map<number, { dayNumber: number; stops: typeof selectedTripStops; totalDistanceKm: number; totalDriveMinutes: number }>();
    for (const stop of selectedTripStops) {
      const current = groups.get(stop.dayNumber) ?? { dayNumber: stop.dayNumber, stops: [], totalDistanceKm: 0, totalDriveMinutes: 0 };
      current.stops.push(stop);
      current.totalDistanceKm += typeof stop.legDistanceKm === "number" ? stop.legDistanceKm : 0;
      current.totalDriveMinutes += stop.legDriveMinutes;
      groups.set(stop.dayNumber, current);
    }
    return Array.from(groups.values()).sort((a, b) => a.dayNumber - b.dayNumber);
  }, [selectedTripStops]);
  const selectedTripRoute = useMemo(
    () => selectedTripStops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
    [selectedTripStops]
  );
  const favoriteIdSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const favoritesCount = favoriteIds.length;
  const selectedPlaceIsFavorite = selectedId != null && favoriteIdSet.has(selectedId);

  const placesWithDistance = useMemo(() => {
    if (!myPos) return places.map((p) => ({ ...p, distanceKm: null, isFavorite: favoriteIdSet.has(p.id) } as any));
    return places.map((p) => {
      const km = distanceKm(myPos.lat, myPos.lng, p.lat, p.lng);
      return { ...p, distanceKm: Number.isFinite(km) ? km : null, isFavorite: favoriteIdSet.has(p.id) } as any;
    });
  }, [favoriteIdSet, places, myPos]);

  const filteredPlaces = useMemo(() => {
    return placesWithDistance.filter((p: Place) => {
      if (p.type === "STELLPLATZ" && !showStellplatz) return false;
      if (p.type === "CAMPINGPLATZ" && !showCampingplatz) return false;
      if (p.type === "SEHENSWUERDIGKEIT" && !showSehens) return false;
      if (p.type === "HVO_TANKSTELLE" && !showHvoTankstelle) return false;

      if (fDog && !p.dogAllowed) return false;
      if (fSan && !p.sanitary) return false;
      if (fYear && !p.yearRound) return false;
      if (fOnline && !p.onlineBooking) return false;
      if (fGastro && !p.gastronomy) return false;
      if (favoritesOnly && !p.isFavorite) return false;
      if (reviewFilter !== "ALL" && normalizeCoordinateReviewStatus((p as any)?.coordinateReviewStatus) !== reviewFilter) return false;
      if (selectedTripId != null && tripOnlyMode && !(p.tripPlacements ?? []).some((item) => item.tripId === selectedTripId)) return false;

      return true;
    });
  }, [
    placesWithDistance,
    showStellplatz,
    showCampingplatz,
    showSehens,
    showHvoTankstelle,
    fDog,
    fSan,
    fYear,
    fOnline,
    fGastro,
    favoritesOnly,
    reviewFilter,
    selectedTripId,
    tripOnlyMode,
  ]);

  function scoreForListOrSort(p: any): number {
    if (p?.type === "SEHENSWUERDIGKEIT") {
      const sightScore = Number(p?.sightseeingTotalScore);
      return Number.isFinite(sightScore) ? sightScore : Number.NEGATIVE_INFINITY;
    }

    if (!isTsRelevantType(p?.type)) return Number.NEGATIVE_INFINITY;

    const t21 = ts21TotalFromDetail(p?.ts21);
    if (t21 != null) return t21;

    const t1 = p?.ratingDetail?.totalPoints;
    return typeof t1 === "number" && Number.isFinite(t1) ? t1 : Number.NEGATIVE_INFINITY;
  }

  const sortedPlaces = useMemo(() => {
    const list = [...filteredPlaces];
    const favoriteRank = (place: Place) => (place.isFavorite ? 0 : 1);

    if (sortMode === "FAVORITES") {
      list.sort((a: any, b: any) => favoriteRank(a) - favoriteRank(b) || a.name.localeCompare(b.name, "de"));
    } else if (sortMode === "ALPHA") {
      list.sort((a: any, b: any) => a.name.localeCompare(b.name, "de"));
    } else if (sortMode === "DIST") {
      list.sort((a: any, b: any) => {
        const da = typeof a.distanceKm === "number" ? a.distanceKm : Number.POSITIVE_INFINITY;
        const db = typeof b.distanceKm === "number" ? b.distanceKm : Number.POSITIVE_INFINITY;
        return da - db;
      });
    } else {
      list.sort((a: any, b: any) => scoreForListOrSort(b) - scoreForListOrSort(a));
    }

    return list;
  }, [filteredPlaces, sortMode]);

  const mapPlaces = useMemo(
    () =>
      sortedPlaces.map((place: Place) => {
        const activeTripPlacement =
          selectedTripId != null ? (place.tripPlacements ?? []).find((item) => item.tripId === selectedTripId) ?? null : null;
        return {
          ...place,
          activeTripOrder: activeTripPlacement?.sortOrder ?? null,
          activeTripStatus: activeTripPlacement?.status ?? null,
          activeTripColor: activeTripPlacement ? selectedTripColor : null,
        };
      }),
    [selectedTripColor, selectedTripId, sortedPlaces]
  );

  const aggregateQuery = useMemo(
    () => ({
      showStellplatz,
      showCampingplatz,
      showSehens,
      showHvoTankstelle,
      dog: fDog,
      san: fSan,
      year: fYear,
      online: fOnline,
      gastro: fGastro,
      reviewFilter,
      selectedTripId,
      tripOnlyMode,
    }),
    [
      showStellplatz,
      showCampingplatz,
      showSehens,
      showHvoTankstelle,
      fDog,
      fSan,
      fYear,
      fOnline,
      fGastro,
      reviewFilter,
      selectedTripId,
      tripOnlyMode,
    ]
  );

  useEffect(() => {
    if (!selectedPlace) return;
    const selectedAny = selectedPlace as any;

    setEditingNew(false);
    setPickMode(false);
    setMapPickedCoord(null);
    setErrorMsg("");
    setUploadMsg("");
    setPickedFiles([]);
    setHeroCandidatesError("");

    setForm({
      id: selectedPlace.id,
      name: selectedPlace.name ?? "",
      type: selectedPlace.type,
      lat: selectedPlace.lat,
      lng: selectedPlace.lng,
      dogAllowed: !!(selectedPlace as any).dogAllowed,
      sanitary: !!(selectedPlace as any).sanitary,
      yearRound: !!(selectedPlace as any).yearRound,
      onlineBooking: !!(selectedPlace as any).onlineBooking,
      gastronomy: !!(selectedPlace as any).gastronomy,
      ratingDetail: (selectedPlace.ratingDetail ?? blankRating()) as any,
      ts2: selectedAny?.ts2 ?? null,
      ts21: selectedAny?.ts21 ?? null,
      images: Array.isArray((selectedPlace as any).images) ? (selectedPlace as any).images : [],
      heroImageUrl: (selectedPlace as any).heroImageUrl ?? null,
      datasetHeroImageUrl: (selectedPlace as any).datasetHeroImageUrl ?? null,
      thumbnailImageId: (selectedPlace as any).thumbnailImageId ?? null,
      sightseeingTotalScore: selectedAny?.sightseeingTotalScore ?? null,
      sightRelevanceType: selectedAny?.sightRelevanceType ?? null,
      sightVisitModePrimary: selectedAny?.sightVisitModePrimary ?? null,
      sightVisitModeSecondary: selectedAny?.sightVisitModeSecondary ?? null,
      bestVisitHint: selectedAny?.bestVisitHint ?? null,
      summaryWhyItMatches: selectedAny?.summaryWhyItMatches ?? null,
      sightDescription: selectedAny?.sightDescription ?? null,
      coordinateReviewStatus: normalizeCoordinateReviewStatus(selectedAny?.coordinateReviewStatus),
      coordinateReviewSource: selectedAny?.coordinateReviewSource ?? null,
      coordinateReviewReviewedAt: selectedAny?.coordinateReviewReviewedAt ?? null,
      coordinateReviewNote: typeof selectedAny?.coordinateReviewNote === "string" ? selectedAny.coordinateReviewNote : "",
      tripPlacements: Array.isArray(selectedAny?.tripPlacements) ? selectedAny.tripPlacements : [],
    });
  }, [selectedPlace]);

  function scrollToEditorIfMobile() {
    if (!isMobile) return;
    requestAnimationFrame(() => {
      editorPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function scrollToMapIfMobile() {
    if (!isMobile) return;
    requestAnimationFrame(() => {
      mapPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function selectPlace(id: number, source: "list" | "map" = "list") {
    const nextPlace = places.find((p) => p.id === id) ?? null;

    if (nextPlace) {
      const nextAny = nextPlace as any;
      setEditingNew(false);
      setPickMode(false);
      setMapPickedCoord(null);
      setErrorMsg("");
      setStatusMsg("");
      setUploadMsg("");
      setPickedFiles([]);
      setHeroCandidates([]);
      setHeroCandidatesError("");

      const nextPlacements = Array.isArray(nextAny?.tripPlacements) ? nextAny.tripPlacements : [];
      const nextActivePlacement =
        selectedTripId != null ? nextPlacements.find((item: any) => Number(item?.tripId) === selectedTripId) ?? null : null;

      setForm({
        id: nextPlace.id,
        name: nextPlace.name ?? "",
        type: nextPlace.type,
        lat: nextPlace.lat,
        lng: nextPlace.lng,
        dogAllowed: !!(nextPlace as any).dogAllowed,
        sanitary: !!(nextPlace as any).sanitary,
        yearRound: !!(nextPlace as any).yearRound,
        onlineBooking: !!(nextPlace as any).onlineBooking,
        gastronomy: !!(nextPlace as any).gastronomy,
        ratingDetail: (nextPlace.ratingDetail ?? blankRating()) as any,
        ts2: nextAny?.ts2 ?? null,
        ts21: nextAny?.ts21 ?? null,
        images: Array.isArray((nextPlace as any).images) ? (nextPlace as any).images : [],
        heroImageUrl: (nextPlace as any).heroImageUrl ?? null,
        datasetHeroImageUrl: (nextPlace as any).datasetHeroImageUrl ?? null,
        thumbnailImageId: (nextPlace as any).thumbnailImageId ?? null,
        sightseeingTotalScore: nextAny?.sightseeingTotalScore ?? null,
        sightRelevanceType: nextAny?.sightRelevanceType ?? null,
        sightVisitModePrimary: nextAny?.sightVisitModePrimary ?? null,
        sightVisitModeSecondary: nextAny?.sightVisitModeSecondary ?? null,
        bestVisitHint: nextAny?.bestVisitHint ?? null,
        summaryWhyItMatches: nextAny?.summaryWhyItMatches ?? null,
        sightDescription: nextAny?.sightDescription ?? null,
        coordinateReviewStatus: normalizeCoordinateReviewStatus(nextAny?.coordinateReviewStatus),
        coordinateReviewSource: nextAny?.coordinateReviewSource ?? null,
        coordinateReviewReviewedAt: nextAny?.coordinateReviewReviewedAt ?? null,
        coordinateReviewNote: typeof nextAny?.coordinateReviewNote === "string" ? nextAny.coordinateReviewNote : "",
        tripPlacements: nextPlacements,
      });
      setActiveTripPlacementId(Number.isFinite(Number(nextActivePlacement?.id)) ? Number(nextActivePlacement.id) : null);
    }

    setSelectedId(id);
    if (source === "map") setListScrollSelectedToken((t) => t + 1);
    setSelectTick((t) => t + 1);
    setFocusToken((t) => t + 1);
    setWorkspaceTab("DETAIL");
    setDetailFocusTab("CORE");
    if (isMobile) setMobileSheetSnap("full");

    scrollEditorTop();

    if (isMobile) {
      setSectionOpen({ BASICS: true, TOGGLES: true, TS: false, IMAGES: false, REVIEW: false });
      return;
    }
  }

  function toggleSelectedPlaceFavorite() {
    if (selectedId == null) return;

    setFavoriteIds((current) => {
      const next = current.includes(selectedId) ? current.filter((id) => id !== selectedId) : [...current, selectedId];
      return next.sort((a, b) => a - b);
    });
    setStatusMsg(selectedPlaceIsFavorite ? "Favorit entfernt" : "Als Favorit gespeichert");
    setErrorMsg("");
  }

  function newPlace() {
    const initialTripPlacementId = selectedTripId != null ? nextTempTripPlacementId() : null;
    setEditingNew(true);
    setSelectedId(null);
    setPickMode(false);
    setMapPickedCoord(null);
    setErrorMsg("");
    setUploadMsg("");
    setPickedFiles([]);
    setActiveTripPlacementId(initialTripPlacementId);
    setSelectTick((t) => t + 1);
    setWorkspaceTab("DETAIL");
    setDetailFocusTab("CORE");
    if (isMobile) setMobileSheetSnap("full");
    setSectionOpen({ BASICS: true, TOGGLES: true, TS: false, IMAGES: false, REVIEW: false });

    scrollEditorTop();

    setForm({
      name: "",
      type: "CAMPINGPLATZ",
      lat: 50.33,
      lng: 7.6,
      dogAllowed: false,
      sanitary: false,
      yearRound: false,
      onlineBooking: false,
      gastronomy: false,
      ratingDetail: blankRating(),
      ts2: null,
      ts21: null,
      images: [],
      heroImageUrl: null,
      datasetHeroImageUrl: null,
      thumbnailImageId: null,
      sightseeingTotalScore: null,
      sightRelevanceType: null,
      sightVisitModePrimary: null,
      sightVisitModeSecondary: null,
      bestVisitHint: null,
      summaryWhyItMatches: null,
      sightDescription: null,
      coordinateReviewStatus: "UNREVIEWED",
      coordinateReviewSource: null,
      coordinateReviewReviewedAt: null,
      coordinateReviewNote: "",
      tripPlacements:
        selectedTripId != null
          ? [
              {
                id: initialTripPlacementId ?? nextTempTripPlacementId(),
                tripId: selectedTripId,
                sortOrder: (selectedTrip?.places?.length ?? 0) + 1,
                dayNumber: 1,
                status: "GEPLANT" as TripPlaceStatus,
                note: "",
              },
            ]
          : [],
    });
  }

  async function createTrip() {
    const name = window.prompt("Name des neuen Trips?");
    if (!name || !name.trim()) return;

    const res = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });

    if (!res.ok) {
      setErrorMsg("Trip konnte nicht angelegt werden");
      return;
    }

    const created = await res.json().catch(() => null);
    await refreshTrips();
    if (Number.isFinite(Number(created?.id))) setSelectedTripId(Number(created.id));
  }

  async function renameSelectedTrip() {
    if (selectedTripId == null) return;
    const currentName = selectedTrip?.name ?? "";
    const name = window.prompt("Neuer Trip-Name?", currentName);
    if (!name || !name.trim() || name.trim() === currentName) return;

    const res = await fetch("/api/trips", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selectedTripId, name: name.trim() }),
    });

    if (!res.ok) {
      setErrorMsg("Trip konnte nicht umbenannt werden");
      return;
    }

    await refreshTrips();
  }

  async function deleteSelectedTrip() {
    if (selectedTripId == null) return;
    if (!window.confirm(`Trip "${selectedTrip?.name ?? "Trip"}" löschen?`)) return;

    const res = await fetch("/api/trips", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selectedTripId }),
    });

    if (!res.ok) {
      setErrorMsg("Trip konnte nicht gelöscht werden");
      return;
    }

    setSelectedTripId(null);
    await Promise.all([refreshTrips(), refreshPlaces(true)]);
  }

  async function saveSelectedTripPlaces(
    updater: (
      currentPlaces: NonNullable<Trip["places"]>
    ) => Array<{ placeId: number; sortOrder: number; dayNumber: number; status: TripPlaceStatus; note: string }>
  ) {
    if (!selectedTrip) return;

    const nextPlaces = updater([...(selectedTrip.places ?? [])])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item, index) => ({
        placeId: item.placeId,
        sortOrder: index + 1,
        dayNumber: Number.isFinite(Number(item.dayNumber)) ? Math.max(1, Number(item.dayNumber)) : 1,
        status: item.status,
        note: item.note,
      }));

    const res = await fetch("/api/trips", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: selectedTrip.id,
        name: selectedTrip.name,
        description: selectedTrip.description,
        isActive: selectedTrip.isActive,
        places: nextPlaces,
      }),
    });

    if (!res.ok) {
      setErrorMsg("Trip konnte nicht aktualisiert werden");
      return;
    }

    await Promise.all([refreshTrips(), refreshPlaces(true)]);
  }

  async function reorderSelectedTripStops(sourceTripPlaceId: number, targetTripPlaceId: number, position: "before" | "after") {
    await saveSelectedTripPlaces((currentPlaces) => {
      const ordered = [...currentPlaces].sort((a, b) => a.sortOrder - b.sortOrder);
      const sourceIndex = ordered.findIndex((item) => item.id === sourceTripPlaceId);
      const targetIndex = ordered.findIndex((item) => item.id === targetTripPlaceId);
      if (sourceIndex < 0 || targetIndex < 0) return ordered;
      const [moved] = ordered.splice(sourceIndex, 1);
      const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      const insertIndex = position === "after" ? adjustedTargetIndex + 1 : adjustedTargetIndex;
      ordered.splice(Math.max(0, Math.min(insertIndex, ordered.length)), 0, moved);
      return ordered.map((item, index) => ({ ...item, sortOrder: index + 1 }));
    });
  }

  async function duplicateSelectedTripStop(tripPlaceId: number) {
    await saveSelectedTripPlaces((currentPlaces) => {
      const ordered = [...currentPlaces].sort((a, b) => a.sortOrder - b.sortOrder);
      const sourceIndex = ordered.findIndex((item) => item.id === tripPlaceId);
      if (sourceIndex < 0) return ordered;
      const source = ordered[sourceIndex];
      const clone = {
        ...source,
        id: -Date.now(),
        sortOrder: source.sortOrder + 1,
      };
      ordered.splice(sourceIndex + 1, 0, clone);
      return ordered.map((item, index) => ({ ...item, sortOrder: index + 1 }));
    });
  }

  async function removeSelectedTripStop(tripPlaceId: number) {
    await saveSelectedTripPlaces((currentPlaces) =>
      currentPlaces
        .filter((item) => item.id !== tripPlaceId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item, index) => ({ ...item, sortOrder: index + 1 }))
    );
  }

  async function changeSelectedTripStopStatus(tripPlaceId: number, status: TripPlaceStatus) {
    await saveSelectedTripPlaces((currentPlaces) =>
      currentPlaces.map((item) => (item.id === tripPlaceId ? { ...item, status } : item))
    );
  }

  async function changeSelectedTripStopDay(tripPlaceId: number, dayNumber: number) {
    await saveSelectedTripPlaces((currentPlaces) =>
      currentPlaces.map((item) =>
        item.id === tripPlaceId
          ? { ...item, dayNumber: Number.isFinite(Number(dayNumber)) ? Math.max(1, Math.round(Number(dayNumber))) : 1 }
          : item
      )
    );
  }

  async function startNewDayFromTripStop(tripPlaceId: number) {
    await saveSelectedTripPlaces((currentPlaces) => {
      const ordered = [...currentPlaces].sort((a, b) => a.sortOrder - b.sortOrder);
      const index = ordered.findIndex((item) => item.id === tripPlaceId);
      if (index < 0) return ordered;

      return ordered.map((item, currentIndex) =>
        currentIndex < index ? item : { ...item, dayNumber: Math.max(1, item.dayNumber) + 1 }
      );
    });
  }

  function upsertTripPlacementForForm(partial: Partial<TripFormPlacement>) {
    if (selectedTripId == null) return;
    let nextPlacementId: number | null = null;

    setForm((current: any) => {
      const placements: TripFormPlacement[] = Array.isArray(current?.tripPlacements) ? [...current.tripPlacements] : [];
      const index =
        activeTripPlacementId != null
          ? placements.findIndex((item) => Number(item.id) === activeTripPlacementId)
          : placements.findIndex((item) => item.tripId === selectedTripId);
      const maxSortOrder = Math.max(
        0,
        ...placements.filter((item) => item.tripId === selectedTripId).map((item) => Number(item.sortOrder) || 0),
        ...((selectedTrip?.places ?? []).map((item) => Number(item.sortOrder) || 0))
      );
      const currentPlacement =
        index >= 0
          ? placements[index]
          : {
              id: nextTempTripPlacementId(),
              tripId: selectedTripId,
              sortOrder: maxSortOrder + 1,
              dayNumber: 1,
              status: "GEPLANT" as TripPlaceStatus,
              note: "",
            };

      const nextPlacement = {
        ...currentPlacement,
        ...partial,
        id: Number.isFinite(Number(partial.id)) ? Number(partial.id) : currentPlacement.id,
        tripId: selectedTripId,
      };
      nextPlacementId = Number(nextPlacement.id);

      if (index >= 0) placements[index] = nextPlacement;
      else placements.push(nextPlacement);

      return { ...current, tripPlacements: placements };
    });
    if (nextPlacementId != null) setActiveTripPlacementId(nextPlacementId);
  }

  function addTripPlacementToForm() {
    if (selectedTripId == null) return;
    const nextId = nextTempTripPlacementId();
    setForm((current: any) => {
      const placements: TripFormPlacement[] = Array.isArray(current?.tripPlacements) ? [...current.tripPlacements] : [];
      const maxSortOrder = Math.max(
        0,
        ...placements.filter((item) => item.tripId === selectedTripId).map((item) => Number(item.sortOrder) || 0),
        ...((selectedTrip?.places ?? []).map((item) => Number(item.sortOrder) || 0))
      );
      placements.push({
        id: nextId,
        tripId: selectedTripId,
        sortOrder: maxSortOrder + 1,
        dayNumber: activeFormTripPlacement?.dayNumber ?? 1,
        status: activeFormTripPlacement?.status ?? ("GEPLANT" as TripPlaceStatus),
        note: "",
      });
      return { ...current, tripPlacements: placements };
    });
    setActiveTripPlacementId(nextId);
  }

  function removeTripPlacementFromForm(tripPlacementId?: number | null) {
    const targetId = Number.isFinite(Number(tripPlacementId)) ? Number(tripPlacementId) : activeTripPlacementId;
    if (targetId == null) return;
    setForm((current: any) => ({
      ...current,
      tripPlacements: Array.isArray(current?.tripPlacements)
        ? current.tripPlacements.filter((item: any) => Number(item?.id) !== targetId)
        : [],
    }));
    if (activeTripPlacementId === targetId) setActiveTripPlacementId(null);
  }

  function commitTripPlacementNumberField(field: "sortOrder" | "dayNumber", rawValue: string) {
    const digitsOnly = String(rawValue ?? "").replace(/[^\d]/g, "");
    const nextValue = Math.max(1, Number(digitsOnly) || 1);
    if (field === "sortOrder") {
      setTripPositionDraft(String(nextValue));
      upsertTripPlacementForForm({ sortOrder: nextValue });
      return;
    }
    setTripDayDraft(String(nextValue));
    upsertTripPlacementForForm({ dayNumber: nextValue });
  }

  async function save(
    formOverride?: typeof form,
    options?: {
      coordinateReviewDecision?: "CONFIRMED";
      successMessage?: string;
    }
  ) {
    setSaving(true);
    setErrorMsg("");
    setStatusMsg("");

    try {
      const maybeFormOverride = formOverride as any;
      const hasValidOverride =
        !!maybeFormOverride &&
        typeof maybeFormOverride === "object" &&
        "type" in maybeFormOverride &&
        "lat" in maybeFormOverride &&
        "lng" in maybeFormOverride;

      const currentForm = hasValidOverride ? maybeFormOverride : form;
      const isNew = editingNew || !currentForm.id;

      const payload: any = {
        ...(isNew ? {} : { id: Number(currentForm.id) }),
        type: currentForm.type,
        lat: Number(currentForm.lat),
        lng: Number(currentForm.lng),
        dogAllowed: !!currentForm.dogAllowed,
        sanitary: !!currentForm.sanitary,
        yearRound: !!currentForm.yearRound,
        onlineBooking: !!currentForm.onlineBooking,
        gastronomy: !!currentForm.gastronomy,
        ratingDetail: {
          upsert: {
            create: { ...(currentForm.ratingDetail ?? blankRating()) },
            update: { ...(currentForm.ratingDetail ?? blankRating()) },
          },
        },
        ts2: currentForm.ts2 ?? null,
        ts21: currentForm.ts21 ?? null,
        heroImageUrl:
          typeof currentForm.datasetHeroImageUrl === "string" && currentForm.datasetHeroImageUrl.trim()
            ? currentForm.datasetHeroImageUrl.trim()
            : typeof currentForm.heroImageUrl === "string"
              ? currentForm.heroImageUrl.trim()
              : null,
        thumbnailImageId: currentForm.thumbnailImageId ?? null,
        coordinateReviewNote: normalizeDisplayText(currentForm.coordinateReviewNote),
        tripPlacements: Array.isArray(currentForm.tripPlacements)
          ? currentForm.tripPlacements.map((item: any) => ({
              tripId: Number(item?.tripId),
              sortOrder: Number(item?.sortOrder),
              dayNumber: Number(item?.dayNumber),
              status: normalizeTripStatus(item?.status),
              note: normalizeDisplayText(item?.note),
            }))
          : [],
      };

      const trimmedName = String(currentForm.name ?? "").trim();
      if (trimmedName || isNew) {
        payload.name = trimmedName;
      }

      if (options?.coordinateReviewDecision) {
        payload.coordinateReviewDecision = options.coordinateReviewDecision;
      }

      const url = "/api/places";
      const method = isNew ? "POST" : "PUT";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        setErrorMsg(txt || "Speichern fehlgeschlagen");
        return;
      }

      const saved = await res.json().catch(() => null);
      const nextId = Number(saved?.id ?? (isNew ? NaN : currentForm.id));

      await Promise.all([refreshPlaces(true), refreshTrips()]);

      if (Number.isFinite(nextId)) {
        setSelectedId(nextId);
        setSelectTick((t) => t + 1);
      }

      if (saved) {
        setForm((prev: any) => ({
          ...prev,
          coordinateReviewStatus: normalizeCoordinateReviewStatus(saved?.coordinateReviewStatus),
          coordinateReviewSource: typeof saved?.coordinateReviewSource === "string" && saved.coordinateReviewSource.trim() ? saved.coordinateReviewSource.trim() : null,
          coordinateReviewReviewedAt: typeof saved?.coordinateReviewReviewedAt === "string" && saved.coordinateReviewReviewedAt.trim() ? saved.coordinateReviewReviewedAt.trim() : null,
          coordinateReviewNote: typeof saved?.coordinateReviewNote === "string" ? normalizeDisplayText(saved.coordinateReviewNote) : "",
        }));
      }

      setEditingNew(false);
      setStatusMsg(options?.successMessage ?? "Koordinate gespeichert - manuelle Korrektur vorgemerkt");
      return true;
    } catch {
      setErrorMsg("Speichern fehlgeschlagen");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!form.id) return;
    setSaving(true);
    setErrorMsg("");

    try {
      const res = await fetch(`/api/places/${form.id}`, { method: "DELETE" });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        setErrorMsg(txt || "Löschen fehlgeschlagen");
        return;
      }

      await Promise.all([refreshPlaces(true), refreshTrips()]);
      newPlace();
    } finally {
      setSaving(false);
    }
  }

  const editorScore = useMemo(() => {
    if (!isTsRelevantType(form?.type)) return null;

    const t21 = ts21TotalFromDetail(form?.ts21);
    if (t21 != null) return { value: t21, max: 20, title: "Törtchensystem" };

    const t1 = form?.ratingDetail?.totalPoints;
    const n = typeof t1 === "number" && Number.isFinite(t1) ? t1 : 0;
    return { value: n, max: 14, title: "Törtchensystem" };
  }, [form?.type, form?.ts21, form?.ratingDetail?.totalPoints]);

  const editorDisplayScore = useMemo(
    () =>
      getPlaceScore({
        id: Number(form?.id ?? 0),
        name: String(form?.name ?? ""),
        type: (form?.type ?? "CAMPINGPLATZ") as PlaceType,
        lat: Number(form?.lat ?? 0),
        lng: Number(form?.lng ?? 0),
        dogAllowed: !!form?.dogAllowed,
        sanitary: !!form?.sanitary,
        yearRound: !!form?.yearRound,
        onlineBooking: !!form?.onlineBooking,
        gastronomy: !!form?.gastronomy,
        ratingDetail: form?.ratingDetail ?? null,
        ts21: form?.ts21 ?? null,
        sightseeingTotalScore: typeof form?.sightseeingTotalScore === "number" ? form.sightseeingTotalScore : null,
      } as Place),
    [form]
  );

  function stopGeoWatch() {
    if (geoWatchIdRef.current != null && navigator.geolocation) {
      try {
        navigator.geolocation.clearWatch(geoWatchIdRef.current);
      } catch {}
    }
    geoWatchIdRef.current = null;
  }

  function startGeoWatch() {
    setGeoStatus("");

    if (!navigator.geolocation) {
      setGeoStatus("Geolocation nicht verfügbar");
      return;
    }

    stopGeoWatch();

    setGeoStatus("Eigenposition - wartet auf GPS…");

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoStatus("Eigenposition aktiv");
      },
      () => {
        setGeoStatus("Eigenposition nicht erlaubt / fehlgeschlagen");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
    );

    geoWatchIdRef.current = id as any;
  }

  useEffect(() => {
    if (typeof window === "undefined") return;

    startGeoWatch();

    return () => {
      stopGeoWatch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function requestMyLocation() {
    startGeoWatch();
  }

  function zoomToMyPos() {
    if (!myPos) return;
    setMyPosFocusToken((t) => t + 1);
  }

  async function uploadImages() {
    setUploadMsg("");

    if (!supabase) {
      setUploadMsg("Supabase ENV fehlt im Client-Bundle - Upload wird blockiert (kein Crash).");
      return;
    }

    if (!form.id) {
      setUploadMsg("Ort erst speichern, dann Bilder hochladen.");
      return;
    }
    if (!pickedFiles.length) {
      setUploadMsg("Bitte Dateien auswählen.");
      return;
    }

    setUploading(true);
    try {
      const placeId = Number(form.id);
      const objectKeys: string[] = [];

      for (const f of pickedFiles) {
        const objectKey = makeObjectKey(placeId, f.name);

        const { error } = await supabase.storage.from(supabaseBucket).upload(objectKey, f, {
          contentType: f.type || "application/octet-stream",
          upsert: false,
        });

        if (error) {
          setUploadMsg(`Supabase Upload fehlgeschlagen: ${error.message}`);
          return;
        }

        objectKeys.push(objectKey);
      }

      const res = await fetch(`/api/places/${placeId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: objectKeys.map((filename) => ({ filename })),
        }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        setUploadMsg(txt || "Upload (Register) fehlgeschlagen");
        return;
      }

      setPickedFiles([]);
      setUploadMsg("Upload ok");
      await refreshPlaces(true);
    } finally {
      setUploading(false);
    }
  }

  async function deleteImage(imageId: number) {
    setUploadMsg("");
    if (!form.id) return;

    setUploading(true);
    try {
      const res = await fetch(`/api/places/${form.id}/images?imageId=${imageId}`, { method: "DELETE" });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        setUploadMsg(txt || "Löschen fehlgeschlagen");
        return;
      }

      setUploadMsg("Bild gelöscht");
      await refreshPlaces(true);
    } finally {
      setUploading(false);
    }
  }

  async function setThumbnail(imageId: number) {
    setUploadMsg("");
    if (!form.id) return;

    setUploading(true);
    try {
      const res = await fetch(`/api/places/${form.id}/thumbnail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId }),
      });

      const txt = await res.text().catch(() => "");
      if (!res.ok) {
        setUploadMsg(txt || "Thumbnail setzen fehlgeschlagen");
        return;
      }

      const updated = JSON.parse(txt);
      setUploadMsg("Thumbnail gesetzt");

      setForm((f: any) => ({
        ...f,
        thumbnailImageId: updated?.thumbnailImageId ?? null,
        datasetHeroImageUrl: updated?.datasetHeroImageUrl ?? f?.datasetHeroImageUrl ?? null,
        images: Array.isArray(updated?.images) ? updated.images : f.images,
      }));

      await refreshPlaces(true);
    } finally {
      setUploading(false);
    }
  }

  const headerImages = useMemo<UnifiedGalleryImage[]>(() => {
    const gallery = Array.isArray(form.images) ? [...form.images] : [];
    const heroFilename = String(form.heroImageUrl ?? "").trim();
    const thumbnailImageId = Number(form.thumbnailImageId);

    if (Number.isFinite(thumbnailImageId)) {
      const thumbnailIndex = gallery.findIndex((img: any) => Number(img?.id) === thumbnailImageId);
      if (thumbnailIndex > 0) {
        const [thumbnail] = gallery.splice(thumbnailIndex, 1);
        gallery.unshift(thumbnail);
      }
    }

    const seen = new Set<string>();
    const combined: UnifiedGalleryImage[] = [];

    const pushImage = (image: UnifiedGalleryImage) => {
      const key = String(image.filename ?? "").trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      combined.push(image);
    };

    if (heroFilename) {
      const matchingGalleryImage = gallery.find((img: any) => String(img?.filename ?? "").trim() === heroFilename);
      pushImage({
        id: matchingGalleryImage?.id,
        filename: heroFilename,
        isHero: true,
      });
    }

    for (const image of gallery) {
      const filename = String(image?.filename ?? "").trim();
      if (!filename) continue;
      pushImage({
        id: image?.id,
        filename,
        isHero: filename === heroFilename,
      });
    }

    return combined;
  }, [form.heroImageUrl, form.images, form.thumbnailImageId]);

  const heroImage = String(form.heroImageUrl ?? "").trim()
    ? { filename: String(form.heroImageUrl).trim() }
    : headerImages.length
      ? headerImages[0]
      : null;

  const heroCandidateHeaderImages = useMemo(
    () =>
      heroCandidates.map((candidate) => ({
        id: candidate.id,
        filename: String(candidate.thumbUrl ?? candidate.url ?? "").trim(),
        source: candidate.source,
      })),
    [heroCandidates]
  );

  const lbImages = useMemo<LightboxImage[]>(() => buildLightboxImages(headerImages, heroCandidates), [headerImages, heroCandidates]);

  const activeLightboxImages = lbOverrideImages ?? lbImages;

  async function loadStoredHeroCandidates(placeId: number) {
    setHeroCandidatesLoading(true);
    setHeroCandidatesError("");
    setHeroCandidatesReloadInfo(null);
    try {
      const res = await fetch(`/api/places/${placeId}/hero-candidates`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error ?? "Hero-Vorschläge konnten nicht geladen werden."));
      const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
      const sortedCandidates = sortHeroCandidates(candidates);
      setHeroCandidates(sortedCandidates);
      setHeroReloadTick(0);
      return sortedCandidates;
    } catch (error: any) {
      setHeroCandidates([]);
      setHeroCandidatesError(String(error?.message ?? "Hero-Vorschläge konnten nicht geladen werden."));
      return [];
    } finally {
      setHeroCandidatesLoading(false);
    }
  }

  async function ensureUnifiedLightboxImages() {
    if (heroCandidates.length > 0 || !selectedPlace?.id) {
      return { images: lbImages, fromOverride: false };
    }

    const loadedCandidates = await loadStoredHeroCandidates(selectedPlace.id);
    return {
      images: buildLightboxImages(headerImages, loadedCandidates),
      fromOverride: true,
    };
  }

  function sortHeroCandidates(items: PlaceHeroCandidate[]): PlaceHeroCandidate[] {
    const next = [...items];
    next.sort((a, b) => {
      const aPinned = a.userFeedback === "UP" ? 1 : 0;
      const bPinned = b.userFeedback === "UP" ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return Number(b.score ?? 0) - Number(a.score ?? 0);
    });
    return next.map((item, idx) => ({ ...item, rank: idx + 1 }));
  }

  function currentNeutralCandidateKeys(): string[] {
    return heroCandidates
      .filter((candidate) => candidate.userFeedback !== "UP" && candidate.userFeedback !== "DOWN")
      .map((candidate) => `${String(candidate.source ?? "").trim().toLowerCase()}::${String(candidate.url ?? "").trim()}`)
      .filter(Boolean);
  }

  function centerSelectedPlaceOnMap() {
    const targetId = typeof form.id === "number" ? form.id : selectedId;
    if (!Number.isFinite(Number(targetId))) return;
    setSelectedId(Number(targetId));
    setFocusToken((t) => t + 1);
    if (isMobile) {
      setPanelMapOpen(true);
      scrollToMapIfMobile();
    }
  }

  async function fetchHeroCandidates(force = true) {
    if (!form.id) return;
    setHeroCandidatesLoading(true);
    setHeroCandidatesError("");
    try {
      const res = await fetch(`/api/places/${form.id}/hero-candidates`, {
        method: force ? "POST" : "GET",
        headers: force ? { "Content-Type": "application/json" } : undefined,
        body: force
          ? JSON.stringify({ limit: 10, excludeKeys: currentNeutralCandidateKeys(), reloadRound: heroReloadTick + 1 })
          : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error ?? "Hero-Vorschläge konnten nicht geladen werden."));
      const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
      setHeroCandidates(sortHeroCandidates(candidates));
      const reloadInfo = force
        ? {
            newCount: Math.max(0, Number(data?.newCandidatesLoaded ?? 0)),
            preservedCount: Math.max(0, Number(data?.preservedPositiveCount ?? 0)),
          }
        : null;
      setHeroCandidatesReloadInfo(reloadInfo);
      if (force) {
        setHeroReloadTick((value) => value + 1);
        setStatusMsg(`Hero-Vorschläge neu geladen: ${reloadInfo?.newCount ?? 0} neu, ${reloadInfo?.preservedCount ?? 0} behalten`);
      }
    } catch (error: any) {
      setHeroCandidatesError(String(error?.message ?? "Hero-Vorschläge konnten nicht geladen werden."));
    } finally {
      setHeroCandidatesLoading(false);
    }
  }

  async function chooseHeroCandidateById(candidateId: number) {
    const candidate = heroCandidates.find((item) => Number(item.id) === Number(candidateId));
    if (!candidate?.id || !form.id) return;
    setSaving(true);
    setErrorMsg("");
    try {
      const res = await fetch(`/api/places/${form.id}/hero-candidates/${candidate.id}/select`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error ?? "Hero-Bild konnte nicht gesetzt werden."));
      const nextHero = String(data?.heroImageUrl ?? candidate.url ?? "").trim() || null;
      setForm((f: any) => ({
        ...f,
        heroImageUrl: nextHero,
        datasetHeroImageUrl: nextHero,
      }));
      setStatusMsg("Hero-Bild aktualisiert");
      await refreshPlaces(true);
    } catch (error: any) {
      setErrorMsg(String(error?.message ?? "Hero-Bild konnte nicht gesetzt werden."));
    } finally {
      setSaving(false);
    }
  }

  async function chooseHeroCandidate(index: number) {
    const candidate = heroCandidates[index];
    if (!candidate?.id) return;
    await chooseHeroCandidateById(candidate.id);
  }

  async function setHeroFromGalleryImage(imageId: number) {
    if (!form.id) return;

    setSaving(true);
    setErrorMsg("");

    try {
      const res = await fetch(`/api/places/${form.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          heroImageUrl: null,
          thumbnailImageId: imageId,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error ?? data?.details ?? "Hero-Bild konnte nicht gesetzt werden."));

      setForm((current: any) => ({
        ...current,
        heroImageUrl: data?.heroImageUrl ?? null,
        datasetHeroImageUrl: data?.datasetHeroImageUrl ?? null,
        thumbnailImageId: data?.thumbnailImageId ?? imageId,
        images: Array.isArray(data?.images) ? data.images : current.images,
      }));

      setStatusMsg("Hero-Bild aktualisiert");
      await refreshPlaces(true);
    } catch (error: any) {
      setErrorMsg(String(error?.message ?? "Hero-Bild konnte nicht gesetzt werden."));
    } finally {
      setSaving(false);
    }
  }

  async function rateHeroCandidateById(candidateId: number, vote: "UP" | "DOWN") {
    if (!candidateId || !form.id) return;
    const candidate = heroCandidates.find((item) => item.id === candidateId);
    if (!candidate) return;

    try {
      const res = await fetch(`/api/places/${form.id}/hero-candidates/${candidateId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error ?? "Bildbewertung konnte nicht gespeichert werden."));

      setHeroCandidates((current) => {
        if (vote === "DOWN") {
          return current.filter((item) => item.id !== candidateId);
        }

        return sortHeroCandidates(
          current.map((item) =>
            item.id === candidateId
              ? {
                  ...item,
                  userFeedback: "UP" as const,
                }
              : item
          )
        );
      });

      setLbOverrideImages((current) => {
        if (!current) return current;

        const next = current
          .map((item) =>
            item.candidateId === candidateId
              ? {
                  ...item,
                  userFeedback: vote,
                }
              : item
          )
          .filter((item) => !(vote === "DOWN" && item.candidateId === candidateId));

        if (!next.length) {
          setLbOpen(false);
          return null;
        }

        setLbIndex((currentIndex) => Math.min(currentIndex, next.length - 1));
        return next;
      });

      setStatusMsg(vote === "UP" ? "Bild positiv bewertet - bleibt beim Neuladen erhalten" : "Bild negativ bewertet - wird entfernt");
    } catch (error: any) {
      setErrorMsg(String(error?.message ?? "Bildbewertung konnte nicht gespeichert werden."));
    }
  }

  async function rateHeroCandidate(index: number, vote: "UP" | "DOWN") {
    const candidate = heroCandidates[index];
    if (!candidate?.id) return;
    await rateHeroCandidateById(candidate.id, vote);
  }

  async function openCandidateLightbox(index: number) {
    const candidate = heroCandidates[index];
    if (!candidate) return;

    const { images, fromOverride } = await ensureUnifiedLightboxImages();
    if (!images.length) return;

    setLbOverrideImages(fromOverride ? images : null);
    const idx = images.findIndex(
      (image) =>
        Number(image.candidateId) === Number(candidate.id) ||
        String(image.filename ?? "").trim() === String(candidate.url ?? "").trim()
    );

    setLbIndex(idx >= 0 ? idx : 0);
    setLbOpen(true);
  }

  useEffect(() => {
    if (!selectedPlace?.id) {
      setHeroCandidates([]);
      setHeroCandidatesReloadInfo(null);
      setHeroReloadTick(0);
      setHeroCandidatesError("");
      return;
    }
    loadStoredHeroCandidates(selectedPlace.id).catch(() => {
      setHeroCandidates([]);
    });
  }, [selectedPlace?.id, selectedPlace?.type]);

  async function openLightbox(index: number) {
    const { images, fromOverride } = await ensureUnifiedLightboxImages();
    if (!images.length) return;

    setLbOverrideImages(fromOverride ? images : null);
    const idx = Math.max(0, Math.min(index, images.length - 1));
    setLbIndex(idx);
    setLbOpen(true);
  }

  async function openHeroLightbox() {
    const { images, fromOverride } = await ensureUnifiedLightboxImages();
    if (!images.length) return;

    setLbOverrideImages(fromOverride ? images : null);
    const heroIndex = images.findIndex((item) => item.kind === "hero");
    const fallbackIndex = images.findIndex((item) => item.kind === "gallery" || item.kind === "candidate");
    setLbIndex(heroIndex >= 0 ? heroIndex : fallbackIndex >= 0 ? fallbackIndex : 0);
    setLbOpen(true);
  }

  async function openLightboxById(imageId: number) {
    const { images, fromOverride } = await ensureUnifiedLightboxImages();
    if (!images.length) return;

    setLbOverrideImages(fromOverride ? images : null);
    const idx = images.findIndex((x: any) => Number(x.id) === Number(imageId));
    setLbIndex(idx >= 0 ? idx : 0);
    setLbOpen(true);
  }

  function closeLightbox() {
    setLbOpen(false);
    setLbOverrideImages(null);
  }

  function lbPrev() {
    if (!activeLightboxImages.length) return;
    setLbIndex((i) => (i - 1 + activeLightboxImages.length) % activeLightboxImages.length);
  }

  function lbNext() {
    if (!activeLightboxImages.length) return;
    setLbIndex((i) => (i + 1) % activeLightboxImages.length);
  }

  const selectedDistanceKm = useMemo(() => {
    if (!myPos || !selectedPlace) return null;
    const km = distanceKm(myPos.lat, myPos.lng, selectedPlace.lat, selectedPlace.lng);
    return Number.isFinite(km) ? km : null;
  }, [myPos, selectedPlace]);

  function canNavigateNow() {
    const lat = safeNum(form.lat);
    const lng = safeNum(form.lng);
    return lat != null && lng != null;
  }

  function openNav(provider: NavProvider) {
    const lat = safeNum(form.lat);
    const lng = safeNum(form.lng);
    if (lat == null || lng == null) return;

    const label = String(form.name ?? "").trim();

    let effective: Exclude<NavProvider, "AUTO"> = "GOOGLE";
    if (provider === "AUTO") {
      effective = isIOSNow() ? "APPLE" : "GOOGLE";
    } else {
      effective = provider;
    }

    const url = buildNavUrl(effective, lat, lng, label);
    setNavOpen(false);

    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      window.location.href = url;
    }
  }

  const sectionsHint = useMemo(() => {
    const openCount = Object.values(sectionOpen).filter(Boolean).length;
    return `${openCount}/${Object.keys(sectionOpen).length}`;
  }, [sectionOpen]);

  function openAllSections() {
    setSectionOpen({ BASICS: true, TOGGLES: true, TS: true, IMAGES: true, REVIEW: true });
  }

  function closeAllSections() {
    setSectionOpen(collapsedSections());
  }

  const editorSectionsToolbar = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={openAllSections}
        className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs hover:bg-white/10"
        title="Alles aufklappen"
      >
        + Alles
      </button>
      <button
        type="button"
        onClick={closeAllSections}
        className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs hover:bg-white/10"
        title="Alles einklappen"
      >
        - Alles
      </button>
    </div>
  );

  const shouldShowTS = form.type === "CAMPINGPLATZ" || form.type === "STELLPLATZ";
  const shouldShowSightseeing = form.type === "SEHENSWUERDIGKEIT";
  const reviewStatusMeta = coordinateReviewStatusMeta(form?.coordinateReviewStatus);
  const reviewActionLabel = reviewStatusActionLabel(form?.coordinateReviewStatus);
  const reviewSourceLabel = String(form?.coordinateReviewSource ?? "").trim() || "—";
  const reviewDateLabel = reviewDateShort(form?.coordinateReviewReviewedAt);

  // WICHTIG: stabiler JSX-Block (kein inneres Component), damit kein Remount pro Keystroke
  const editorBody = useMemo(() => {
    return (
      <div className="space-y-3 pt-3">
        {errorMsg ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">{errorMsg}</div> : null}
        {statusMsg ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs">{statusMsg}</div> : null}

        <div className="flex items-center justify-between gap-2">
          <div className="text-xs opacity-70">Sektionen {sectionsHint}</div>
          {editorSectionsToolbar}
        </div>

        {shouldShowTS ? (
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-white/60">Notiz (optional)</div>
            <textarea
              className="min-h-[76px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
              placeholder="Kontext zur Törtchensystem-Bewertung"
              value={String(form?.ts21?.note ?? "")}
              onChange={(e) =>
                setForm((f: any) => ({
                  ...f,
                  ts21: {
                    ...(f?.ts21 ?? { activeSource: "AI", ai: {}, user: {}, dna: false, explorer: false, dnaExplorerNote: "", note: "" }),
                    note: e.target.value,
                  },
                }))
              }
            />
          </div>
        ) : null}

        {shouldShowSightseeing ? (
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            <div className="px-3 py-2.5 text-sm font-semibold">TS Sehenswürdigkeit</div>
            <div className="space-y-2 px-3 pb-3 text-xs">
              <div className="flex flex-wrap gap-3">
                <span>Score: {typeof (form as any).sightseeingTotalScore === "number" ? `${Math.round((form as any).sightseeingTotalScore)}/100` : "-"}</span>
                <span>Relevance: {(form as any).sightRelevanceType ?? "-"}</span>
                <span>Visit: {(form as any).sightVisitModePrimary ?? "-"}{(form as any).sightVisitModeSecondary ? ` + ${(form as any).sightVisitModeSecondary}` : ""}</span>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-white/60">Beschreibung</div>
                <div className="whitespace-pre-wrap opacity-90">{(form as any).sightDescription ?? "Keine Beschreibung vorhanden."}</div>
              </div>
              <div className="opacity-85">{(form as any).bestVisitHint ?? "Kein Visit-Hinweis vorhanden."}</div>
              <div className="opacity-85">{(form as any).summaryWhyItMatches ?? "Noch keine Zusammenfassung vorhanden."}</div>
            </div>
          </div>
        ) : null}

        <Section id="BASICS" title="Basics" icon="🧱" open={sectionOpen.BASICS} onOpenChange={(vv) => setSection("BASICS", vv)}>
          <div className="space-y-2">
            <input
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
              placeholder="Name"
              value={String(form.name ?? "")}
              onChange={(e) => setForm((f: any) => ({ ...f, name: e.target.value }))}
            />

            <select
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
              value={(form.type ?? "CAMPINGPLATZ") as string}
              onChange={(e) => setForm((f: any) => ({ ...f, type: e.target.value as PlaceType }))}
            >
              <option value="CAMPINGPLATZ">Campingplatz</option>
              <option value="STELLPLATZ">Stellplatz</option>
              <option value="SEHENSWUERDIGKEIT">Sehenswürdigkeit</option>
              <option value="HVO_TANKSTELLE">HVO Tankstelle</option>
            </select>

            {selectedTripId != null ? (
              <div ref={tripAssignmentRef} className="rounded-xl border border-sky-400/20 bg-sky-500/10 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-sky-100/80">Trip-Zuordnung</div>
                    <div className="text-sm font-semibold">{selectedTrip?.name ?? "Aktiver Trip"}</div>
                    <div className="mt-1 text-xs text-sky-100/70">
                      {activeFormTripPlacements.length
                        ? `${activeFormTripPlacements.length} Stopps fuer diesen Ort im aktiven Trip`
                        : "Dieser Ort ist aktuell nicht Teil des ausgewaehlten Trips."}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={activeFormTripPlacements.length ? addTripPlacementToForm : () => upsertTripPlacementForForm({})}
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
                    >
                      {activeFormTripPlacements.length ? "Weiteren Stopp hinzufuegen" : "Zum Trip hinzufuegen"}
                    </button>
                    {activeFormTripPlacement ? (
                      <button
                        type="button"
                        onClick={() => removeTripPlacementFromForm(activeFormTripPlacement.id ?? null)}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
                      >
                        Aktiven Stopp entfernen
                      </button>
                    ) : null}
                  </div>
                </div>

                {activeFormTripPlacements.length ? (
                  <>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {activeFormTripPlacements
                        .slice()
                        .sort((a, b) => a.sortOrder - b.sortOrder)
                        .map((placement, index) => {
                          const isActive = Number(placement.id) === Number(activeFormTripPlacement?.id);
                          return (
                            <button
                              key={String(placement.id ?? `${placement.tripId}-${placement.sortOrder}-${index}`)}
                              type="button"
                              onClick={() => setActiveTripPlacementId(Number(placement.id))}
                              className={`rounded-full border px-3 py-1.5 text-xs transition ${
                                isActive
                                  ? "border-sky-300/60 bg-sky-400/20 text-sky-50"
                                  : "border-white/10 bg-black/20 text-white/75 hover:bg-white/10"
                              }`}
                            >
                              {`Stopp ${index + 1} - Tag ${placement.dayNumber}`}
                            </button>
                          );
                        })}
                    </div>

                    {activeFormTripPlacement ? (
                      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                        <label className="grid gap-1">
                          <span className="text-xs font-medium text-sky-100/80">Position des Stopps</span>
                          <input
                            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={tripPositionDraft}
                            onChange={(e) => {
                              const next = e.target.value.replace(/[^\d]/g, "");
                              setTripPositionDraft(next);
                            }}
                            onBlur={() => commitTripPlacementNumberField("sortOrder", tripPositionDraft)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitTripPlacementNumberField("sortOrder", tripPositionDraft);
                              }
                            }}
                          />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-xs font-medium text-sky-100/80">Tag</span>
                          <input
                            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={tripDayDraft}
                            onChange={(e) => {
                              const next = e.target.value.replace(/[^\d]/g, "");
                              setTripDayDraft(next);
                            }}
                            onBlur={() => commitTripPlacementNumberField("dayNumber", tripDayDraft)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitTripPlacementNumberField("dayNumber", tripDayDraft);
                              }
                            }}
                          />
                        </label>
                        <label className="grid gap-1 sm:col-span-2">
                          <span className="text-xs font-medium text-sky-100/80">Status</span>
                          <select
                            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
                            value={activeFormTripPlacement.status}
                            onChange={(e) => upsertTripPlacementForForm({ status: e.target.value as TripPlaceStatus })}
                          >
                            <option value="GEPLANT">geplant</option>
                            <option value="BOOKED">angefragt</option>
                            <option value="CONFIRMED">bestaetigt</option>
                            <option value="VISITED">besucht</option>
                          </select>
                        </label>
                        <label className="grid gap-1 sm:col-span-2">
                          <span className="text-xs font-medium text-sky-100/80">Notiz</span>
                          <textarea
                            className="min-h-[68px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
                            placeholder="Notiz zum Trip-Stopp"
                            value={String(activeFormTripPlacement.note ?? "")}
                            onChange={(e) => upsertTripPlacementForForm({ note: e.target.value })}
                          />
                        </label>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <input
                className="h-9 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none"
                placeholder="Lat"
                value={String(form.lat ?? "")}
                onChange={(e) => setForm((f: any) => ({ ...f, lat: Number(e.target.value) }))}
              />
              <input
                className="h-9 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none"
                placeholder="Lng"
                value={String(form.lng ?? "")}
                onChange={(e) => setForm((f: any) => ({ ...f, lng: Number(e.target.value) }))}
              />

              <button
                type="button"
                onClick={() => {
                  setPickMode((v) => {
                    const next = !v;
                    if (!next) setMapPickedCoord(null);
                    return next;
                  });
                  setSelectTick((t) => t + 1);
                }}
                className={`h-9 shrink-0 rounded-xl border px-3 text-xs hover:opacity-95 ${
                  pickMode ? "border-white/25 bg-white/10" : "border-white/10 bg-white/5"
                }`}
                disabled={saving}
                title={pickMode ? "Karten-Pick beenden" : "Koordinaten aus Karte wählen"}
              >
                📍 Karte
              </button>


              <button
                type="button"
                onClick={async () => {
                  if (!mapPickedCoord) return;
                  const nextForm = { ...form, lat: mapPickedCoord.lat, lng: mapPickedCoord.lng };
                  setForm(nextForm);
                  const saved = await save(nextForm);
                  if (saved) {
                    setMapPickedCoord(null);
                    setPickMode(false);
                  }
                }}
                className="h-9 shrink-0 rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 text-xs hover:bg-emerald-500/20 disabled:opacity-60"
                disabled={saving || !mapPickedCoord}
                title="Ausgewählte Kartenposition speichern"
              >
                ✅ Koordinate speichern
              </button>

              <button
                type="button"
                onClick={() => setNavOpen(true)}
                className="hidden"
                disabled={saving || !canNavigateNow()}
                title="Navigation starten"
              >
                🧭 Navi
              </button>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/75">
              <div>
                Aktuell: {Number(form.lat).toFixed(6)}, {Number(form.lng).toFixed(6)}
              </div>
              <div>
                Karte: {mapPickedCoord ? `${mapPickedCoord.lat.toFixed(6)}, ${mapPickedCoord.lng.toFixed(6)}` : "noch nicht gewählt"}
              </div>
            </div>

            {normalizeCoordinateReviewStatus(form?.coordinateReviewStatus) === "UNREVIEWED" ? (
              <button
                type="button"
                onClick={async () => {
                  await save(form, {
                    coordinateReviewDecision: "CONFIRMED",
                    successMessage: "Koordinate bestätigt - manuell bestätigt gespeichert",
                  });
                }}
                className="w-full rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-2 text-sm font-semibold hover:bg-emerald-500/20 disabled:opacity-60"
                disabled={saving || editingNew || !form.id}
                title="Aktuelle Koordinate ohne Änderung als korrekt bestätigen"
              >
                Koordinate als korrekt bestätigen
              </button>
            ) : null}

            <input
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
              placeholder="Hero Image URL"
              type="url"
              value={String(form.heroImageUrl ?? "")}
              onChange={(e) => setForm((f: any) => ({ ...f, heroImageUrl: e.target.value }))}
            />
          </div>
        </Section>

        <Section id="TOGGLES" title="Kriterien" icon="✅" open={sectionOpen.TOGGLES} onOpenChange={(vv) => setSection("TOGGLES", vv)}>
          <div className="flex flex-wrap items-center gap-2">
            <TogglePill on={!!form.dogAllowed} icon="🐕" label="Hunde" onClick={() => setForm((f: any) => ({ ...f, dogAllowed: !f.dogAllowed }))} />
            <TogglePill on={!!form.sanitary} icon="🚿" label="Sanitär" onClick={() => setForm((f: any) => ({ ...f, sanitary: !f.sanitary }))} />
            <TogglePill on={!!form.yearRound} icon="📆" label="Ganzjährig" onClick={() => setForm((f: any) => ({ ...f, yearRound: !f.yearRound }))} />
            <TogglePill on={!!form.onlineBooking} icon="🌐" label="Online" onClick={() => setForm((f: any) => ({ ...f, onlineBooking: !f.onlineBooking }))} />
            <TogglePill on={!!form.gastronomy} icon="🍽️" label="Gastro" onClick={() => setForm((f: any) => ({ ...f, gastronomy: !f.gastronomy }))} />
          </div>
        </Section>

        <Section id="TS" title="Törtchensystem" icon="🍰" open={sectionOpen.TS} onOpenChange={(vv) => setSection("TS", vv)}>
          {shouldShowTS ? (
            <Ts21Editor
              value={(form.ts21 ?? null) as TS21Detail | null}
              onChange={(next) => setForm((f: any) => ({ ...f, ts21: next }))}
              disabled={saving}
              showGeneralNote={false}
            />
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs opacity-80">
              TS ist nur für Campingplatz und Stellplatz verfügbar.
            </div>
          )}
        </Section>

        <Section
          id="IMAGES"
          title="Bilder"
          icon="🖼️"
          open={sectionOpen.IMAGES}
          onOpenChange={(vv) => setSection("IMAGES", vv)}
          rightHint={<span className="opacity-80">{Array.isArray(form.images) ? form.images.length : 0}</span>}
        >
          <HeroCandidatesPanel
            placeId={form.id ? Number(form.id) : null}
            placeType={String(form.type ?? "CAMPINGPLATZ")}
            candidates={heroCandidates}
            loading={heroCandidatesLoading}
            error={heroCandidatesError}
            reloadInfo={heroCandidatesReloadInfo}
            onLoad={() => {
              void fetchHeroCandidates(true);
            }}
            onSelect={openCandidateLightbox}
            onChooseHero={(index) => {
              void chooseHeroCandidate(index);
            }}
            onFeedback={(index, vote) => {
              void rateHeroCandidate(index, vote);
            }}
            activeHeroUrl={typeof form.datasetHeroImageUrl === "string" && form.datasetHeroImageUrl.trim() ? form.datasetHeroImageUrl : form.heroImageUrl}
          />

          <ImagesPanel
            placeId={form.id ? Number(form.id) : null}
            images={Array.isArray(form.images) ? form.images : []}
            thumbnailImageId={Number.isFinite(Number(form.thumbnailImageId)) ? Number(form.thumbnailImageId) : null}
            uploading={uploading}
            saving={saving}
            uploadMsg={uploadMsg}
            onPickFiles={(files) => setPickedFiles(files)}
            pickedFilesCount={pickedFiles.length}
            onUpload={uploadImages}
            onOpenLightboxById={openLightboxById}
            onSetThumbnail={setThumbnail}
            onDeleteImage={deleteImage}
          />
        </Section>

        <Section id="REVIEW" title="Review-/Lernstatus" icon="Review" open={sectionOpen.REVIEW} onOpenChange={(vv) => setSection("REVIEW", vv)}>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className={`inline-flex items-center rounded-lg border px-2 py-1 text-xs font-semibold ${reviewStatusMeta.className}`}>
                {reviewStatusMeta.label}
              </div>
              <div className="text-[11px] text-white/60">
                {reviewActionLabel} - Quelle: {reviewSourceLabel} - {reviewDateLabel}
              </div>
            </div>
            <textarea
              className="min-h-[68px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
              placeholder="Kurze Review-Notiz (z. B. passt in der UI)"
              value={String(form.coordinateReviewNote ?? "")}
              onChange={(e) => setForm((f: any) => ({ ...f, coordinateReviewNote: e.target.value }))}
            />
          </div>
        </Section>

        <button
          type="button"
          onClick={() => save()}
          className="mt-1 w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold hover:bg-white/15 disabled:opacity-60"
          disabled={saving}
        >
          {saving ? "Speichert..." : "Speichern"}
        </button>
      </div>
    );
  }, [
    errorMsg,
    statusMsg,
    sectionsHint,
    editorSectionsToolbar,
    sectionOpen,
    form,
    pickMode,
    saving,
    shouldShowTS,
    shouldShowSightseeing,
    selectedTripId,
    selectedTrip,
    activeFormTripPlacement,
    removeTripPlacementFromForm,
    upsertTripPlacementForForm,
    uploading,
    uploadMsg,
    pickedFiles.length,
  ]);

  const legacyLayout = isMobile ? (
    <div className="mx-auto flex h-full max-w-[1800px] flex-col gap-4 px-4 py-4">
      {statusMsg ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">{statusMsg}</div>
      ) : null}

      <div className="w-full">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
          <FiltersPanel
            filtersOpen={filtersOpen}
            setFiltersOpen={setFiltersOpen}
            showStellplatz={showStellplatz}
            setShowStellplatz={setShowStellplatz}
            showCampingplatz={showCampingplatz}
            setShowCampingplatz={setShowCampingplatz}
            showSehens={showSehens}
            setShowSehens={setShowSehens}
            showHvoTankstelle={showHvoTankstelle}
            setShowHvoTankstelle={setShowHvoTankstelle}
            fDog={fDog}
            setFDog={setFDog}
            fSan={fSan}
            setFSan={setFSan}
            fYear={fYear}
            setFYear={setFYear}
            fOnline={fOnline}
            setFOnline={setFOnline}
            fGastro={fGastro}
            setFGastro={setFGastro}
            favoritesOnly={favoritesOnly}
            setFavoritesOnly={setFavoritesOnly}
            favoritesCount={favoritesCount}
            reviewFilter={reviewFilter}
            setReviewFilter={setReviewFilter}
            geoStatus={geoStatus}
            hasMyPos={!!myPos}
            showMyRings={showMyRings}
            setShowMyRings={setShowMyRings}
            onRequestMyLocation={requestMyLocation}
            onZoomToMyPos={zoomToMyPos}
            onRefresh={() => {
              void Promise.all([refreshPlaces(true), refreshTrips()]);
            }}
          />
        </div>
      </div>

      <div className="w-full" ref={mapPanelRef}>
        <CollapsiblePanel title="Map" icon="🗺️" open={panelMapOpen} onOpenChange={setPanelMapOpen}>
          <div className="relative h-[60svh] min-h-[360px] w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            <MapClient
              places={mapPlaces as any}
              selectedId={selectedId}
              onSelect={(id: number) => selectPlace(id, "map")}
              pickMode={pickMode}
              onPick={handleMapPick}
              focusToken={focusToken}
              myPos={myPos}
              myPosFocusToken={myPosFocusToken}
              showMyRings={showMyRings}
              tripRoute={selectedTripRoute}
              tripColor={selectedTripColor}
              aggregateQuery={aggregateQuery}
            />
          </div>
        </CollapsiblePanel>
      </div>

      <div className="w-full" ref={editorPanelRef}>
        <CollapsiblePanel title="Editor" icon="📝" open={panelEditorOpen} onOpenChange={setPanelEditorOpen}>
          <div className="min-h-0 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            <EditorHeader
              editingNew={editingNew}
              saving={saving}
              formName={String(form.name ?? "")}
              formType={getPlaceTypeLabel((form.type ?? "CAMPINGPLATZ") as PlaceType)}
              score={editorDisplayScore}
              heroImage={heroImage ? { filename: heroImage.filename } : null}
              placeId={typeof form.id === "number" ? form.id : null}
              headerImages={headerImages}
              heroCandidateImages={heroCandidateHeaderImages}
              imagesCount={Array.isArray(form.images) ? form.images.length : 0}
              selectedPlace={selectedPlace}
              isFavorite={selectedPlaceIsFavorite}
              distanceKm={selectedDistanceKm}
              onOpenHeroLightbox={openHeroLightbox}
              onOpenLightboxByImageId={openLightboxById}
              onOpenCandidateLightbox={openCandidateLightbox}
              onOpenNav={() => setNavOpen(true)}
              onToggleFavorite={toggleSelectedPlaceFavorite}
              onSave={save}
              onCenterOnMap={centerSelectedPlaceOnMap}
              onJumpToTripAssignment={scrollToTripAssignment}
              onDelete={del}
              onNew={newPlace}
              canNavigate={canNavigateNow()}
              canDelete={!editingNew && !!form.id}
            />

            <div ref={editorScrollRef} className="min-h-0 flex-1 overflow-auto px-4 pb-4">
              {editorBody}
            </div>
          </div>
        </CollapsiblePanel>
      </div>

      <div className="w-full">
        <CollapsiblePanel title="Trip" icon="🧭" open={panelTripOpen} onOpenChange={setPanelTripOpen}>
          <div className="h-[42svh] min-h-[260px]">
            <TripPlannerPanel
              trips={trips.map((trip) => ({ id: trip.id, name: trip.name }))}
              trip={selectedTrip}
              color={selectedTripColor}
              stops={selectedTripStops}
              groups={selectedTripGroups}
              tripOnlyMode={tripOnlyMode}
              selectedPlaceId={selectedId}
              selectedTripId={selectedTripId}
              onSelectTrip={setSelectedTripId}
              onSetTripOnlyMode={setTripOnlyMode}
              onSelectPlace={(id) => selectPlace(id, "list")}
              onCreateTrip={createTrip}
              onRenameTrip={renameSelectedTrip}
              onDeleteTrip={deleteSelectedTrip}
              onDuplicateStop={duplicateSelectedTripStop}
              onReorderStops={reorderSelectedTripStops}
              onRemoveStop={removeSelectedTripStop}
              onChangeStopStatus={changeSelectedTripStopStatus}
              onChangeStopDay={changeSelectedTripStopDay}
              onStartNewDayFromStop={startNewDayFromTripStop}
            />
          </div>
        </CollapsiblePanel>
      </div>

      <div className="w-full">
        <CollapsiblePanel title="Orte" icon="📍" open={panelPlacesOpen} onOpenChange={setPanelPlacesOpen}>
          <div className="h-[70svh] min-h-[420px]">
            <PlacesList
              places={mapPlaces as any}
              selectedId={selectedId}
              scrollToSelectedToken={listScrollSelectedToken}
              onSelect={(id) => selectPlace(id, "list")}
              sortMode={sortMode}
              setSortMode={setSortMode}
              selectedTripId={selectedTripId}
            />
          </div>
        </CollapsiblePanel>
      </div>
    </div>
  ) : (
    <div className="mx-auto flex h-full max-w-[1800px] flex-col gap-4 px-4 py-4 lg:flex-row lg:min-h-0">
      <div className="w-[320px] shrink-0 lg:min-h-0">
        <div className="flex h-full min-h-0 flex-col gap-4">
          <div className="h-[42%] min-h-[240px]">
            <TripPlannerPanel
              trips={trips.map((trip) => ({ id: trip.id, name: trip.name }))}
              trip={selectedTrip}
              color={selectedTripColor}
              stops={selectedTripStops}
              groups={selectedTripGroups}
              tripOnlyMode={tripOnlyMode}
              selectedPlaceId={selectedId}
              selectedTripId={selectedTripId}
              onSelectTrip={setSelectedTripId}
              onSetTripOnlyMode={setTripOnlyMode}
              onSelectPlace={(id) => selectPlace(id, "list")}
              onCreateTrip={createTrip}
              onRenameTrip={renameSelectedTrip}
              onDeleteTrip={deleteSelectedTrip}
              onDuplicateStop={duplicateSelectedTripStop}
              onReorderStops={reorderSelectedTripStops}
              onRemoveStop={removeSelectedTripStop}
              onChangeStopStatus={changeSelectedTripStopStatus}
              onChangeStopDay={changeSelectedTripStopDay}
              onStartNewDayFromStop={startNewDayFromTripStop}
            />
          </div>

          <div className="min-h-0 flex-1">
            <PlacesList
              places={mapPlaces as any}
              selectedId={selectedId}
              scrollToSelectedToken={listScrollSelectedToken}
              onSelect={(id) => selectPlace(id, "list")}
              sortMode={sortMode}
              setSortMode={setSortMode}
              selectedTripId={selectedTripId}
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <div className="relative h-full min-h-0 w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5">
          <MapClient
            places={mapPlaces as any}
            selectedId={selectedId}
            onSelect={(id: number) => selectPlace(id, "map")}
            pickMode={pickMode}
            onPick={handleMapPick}
            focusToken={focusToken}
            myPos={myPos}
            myPosFocusToken={myPosFocusToken}
            showMyRings={showMyRings}
            tripRoute={selectedTripRoute}
            tripColor={selectedTripColor}
            aggregateQuery={aggregateQuery}
          />
        </div>
      </div>

      <div className="w-[420px] shrink-0 lg:min-h-0">
        <div className="flex h-full min-h-0 flex-col gap-4">
          <FiltersPanel
            filtersOpen={filtersOpen}
            setFiltersOpen={setFiltersOpen}
            showStellplatz={showStellplatz}
            setShowStellplatz={setShowStellplatz}
            showCampingplatz={showCampingplatz}
            setShowCampingplatz={setShowCampingplatz}
            showSehens={showSehens}
            setShowSehens={setShowSehens}
            showHvoTankstelle={showHvoTankstelle}
            setShowHvoTankstelle={setShowHvoTankstelle}
            fDog={fDog}
            setFDog={setFDog}
            fSan={fSan}
            setFSan={setFSan}
            fYear={fYear}
            setFYear={setFYear}
            fOnline={fOnline}
            setFOnline={setFOnline}
            fGastro={fGastro}
            setFGastro={setFGastro}
            favoritesOnly={favoritesOnly}
            setFavoritesOnly={setFavoritesOnly}
            favoritesCount={favoritesCount}
            reviewFilter={reviewFilter}
            setReviewFilter={setReviewFilter}
            geoStatus={geoStatus}
            hasMyPos={!!myPos}
            showMyRings={showMyRings}
            setShowMyRings={setShowMyRings}
            onRequestMyLocation={requestMyLocation}
            onZoomToMyPos={zoomToMyPos}
            onRefresh={() => {
              void Promise.all([refreshPlaces(true), refreshTrips()]);
            }}
          />

          <div className="min-h-0 flex flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            <div>
              <EditorHeader
                editingNew={editingNew}
                saving={saving}
                formName={String(form.name ?? "")}
                formType={getPlaceTypeLabel((form.type ?? "CAMPINGPLATZ") as PlaceType)}
                score={editorDisplayScore}
                heroImage={heroImage ? { filename: heroImage.filename } : null}
                placeId={typeof form.id === "number" ? form.id : null}
                headerImages={headerImages}
                heroCandidateImages={heroCandidateHeaderImages}
                imagesCount={Array.isArray(form.images) ? form.images.length : 0}
                selectedPlace={selectedPlace}
                isFavorite={selectedPlaceIsFavorite}
                distanceKm={selectedDistanceKm}
                onOpenHeroLightbox={openHeroLightbox}
                onOpenLightboxByImageId={openLightboxById}
                onOpenCandidateLightbox={openCandidateLightbox}
                onOpenNav={() => setNavOpen(true)}
                onToggleFavorite={toggleSelectedPlaceFavorite}
                onSave={save}
                onCenterOnMap={centerSelectedPlaceOnMap}
                onJumpToTripAssignment={scrollToTripAssignment}
                onDelete={del}
                onNew={newPlace}
                canNavigate={canNavigateNow()}
                canDelete={!editingNew && !!form.id}
              />
            </div>

            <div ref={editorScrollRef} className="min-h-0 flex-1 overflow-auto px-4 pb-4">
              {editorBody}
            </div>
          </div>

          <div className="text-xs opacity-70">Sortierung wirkt nur auf die Liste (kein Zoom).</div>
        </div>
      </div>
    </div>
  );

  const workspaceTabs = [
    { id: "PLACES" as WorkspaceTabId, label: "Orte", badge: mapPlaces.length },
    { id: "TRIP" as WorkspaceTabId, label: "Trip", badge: selectedTrip ? selectedTripStops.length : null },
    { id: "DETAIL" as WorkspaceTabId, label: editingNew ? "Neu" : "Details", badge: selectedPlace ? 1 : editingNew ? "neu" : null },
    { id: "FILTERS" as WorkspaceTabId, label: "Filter", badge: null },
  ];

  const panelTitle =
    workspaceTab === "TRIP"
      ? "Trip-Workspace"
      : workspaceTab === "DETAIL"
        ? editingNew
          ? "Neuen Ort anlegen"
          : "Ort im Fokus"
        : workspaceTab === "FILTERS"
          ? "Filter & Review"
          : "Orte entdecken";
  const panelSubtitle =
    workspaceTab === "TRIP"
      ? selectedTrip
        ? `${selectedTrip.name} - ${selectedTripGroups.length || 1} Tage - ${selectedTripStops.length} Stopps`
        : "Waehle einen Trip oder lege einen neuen an"
      : workspaceTab === "DETAIL"
        ? editingNew
          ? "Schneller Einstieg fuer neue Orte und Trip-Zuordnung"
          : selectedPlace
            ? `${selectedPlace.name} - ${getPlaceTypeLabel(selectedPlace.type)}`
            : "Waehle einen Ort auf Karte oder Liste"
        : workspaceTab === "FILTERS"
          ? "Schnell filtern statt dauerhaft Platz zu belegen"
          : `${mapPlaces.length} Orte im aktuellen Fokus`;

  const mapSurface = (
    <div className="relative h-full w-full overflow-hidden bg-[#0a0b0d]" ref={mapPanelRef}>
      <MapClient
        places={mapPlaces as any}
        selectedId={selectedId}
        onSelect={(id: number) => selectPlace(id, "map")}
        pickMode={pickMode}
        onPick={handleMapPick}
        focusToken={focusToken}
        myPos={myPos}
        myPosFocusToken={myPosFocusToken}
        showMyRings={showMyRings}
        tripRoute={selectedTripRoute}
        tripColor={selectedTripColor}
        aggregateQuery={aggregateQuery}
      />

      <div className="absolute left-[10px] top-[86px] z-[4050] flex flex-col gap-1.5">
        <button
          type="button"
          onClick={myPos ? zoomToMyPos : requestMyLocation}
          className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[4px] border border-black/20 bg-white/95 text-[#1f2937] shadow-[0_1px_4px_rgba(0,0,0,0.28)] hover:bg-white"
          title={myPos ? "Auf Eigenposition zentrieren" : "Erst Eigenposition holen"}
        >
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" opacity="0.4" />
            <path d="M12 6.25a5.75 5.75 0 1 0 5.75 5.75" opacity="0.75" />
            <circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none" />
            <path d="M17.85 6.15 20.5 3.5" />
            <path d="M20.5 6.9V3.5h-3.4" />
          </svg>
        </button>
      </div>

      {statusMsg ? (
        <div className="pointer-events-none absolute bottom-4 left-4 right-4 z-[4300] rounded-2xl border border-emerald-400/25 bg-emerald-500/12 px-3 py-2 text-xs text-emerald-100 shadow-[0_10px_30px_rgba(0,0,0,0.25)] backdrop-blur">
          {statusMsg}
        </div>
      ) : null}

      {errorMsg ? (
        <div className="pointer-events-none absolute bottom-4 left-4 right-4 z-[4300] rounded-2xl border border-red-400/25 bg-red-500/12 px-3 py-2 text-xs text-red-100 shadow-[0_10px_30px_rgba(0,0,0,0.25)] backdrop-blur sm:bottom-20">
          {errorMsg}
        </div>
      ) : null}
    </div>
  );

  const placesPanel = (
    <div className="h-full min-h-0">
      <PlacesList
        places={mapPlaces as any}
        selectedId={selectedId}
        scrollToSelectedToken={listScrollSelectedToken}
        onSelect={(id) => selectPlace(id, "list")}
        sortMode={sortMode}
        setSortMode={setSortMode}
        selectedTripId={selectedTripId}
      />
    </div>
  );

  const tripPanel = (
    <div className="h-full min-h-0">
      <TripPlannerPanel
        trips={trips.map((trip) => ({ id: trip.id, name: trip.name }))}
        trip={selectedTrip}
        color={selectedTripColor}
        stops={selectedTripStops}
        groups={selectedTripGroups}
        tripOnlyMode={tripOnlyMode}
        selectedPlaceId={selectedId}
        selectedTripId={selectedTripId}
        onSelectTrip={(tripId) => {
          setSelectedTripId(tripId);
          setWorkspaceMode("TRIP");
        }}
        onSetTripOnlyMode={setTripOnlyMode}
        onSelectPlace={(id) => selectPlace(id, "list")}
        onCreateTrip={createTrip}
        onRenameTrip={renameSelectedTrip}
        onDeleteTrip={deleteSelectedTrip}
        onDuplicateStop={duplicateSelectedTripStop}
        onReorderStops={reorderSelectedTripStops}
        onRemoveStop={removeSelectedTripStop}
        onChangeStopStatus={changeSelectedTripStopStatus}
        onChangeStopDay={changeSelectedTripStopDay}
        onStartNewDayFromStop={startNewDayFromTripStop}
      />
    </div>
  );

  const filtersPanel = (
    <div className="h-full overflow-auto rounded-[24px] border border-white/10 bg-white/5 p-1">
      <FiltersPanel
        filtersOpen={filtersOpen}
        setFiltersOpen={setFiltersOpen}
        alwaysOpen={isMobile}
        showStellplatz={showStellplatz}
        setShowStellplatz={setShowStellplatz}
        showCampingplatz={showCampingplatz}
        setShowCampingplatz={setShowCampingplatz}
        showSehens={showSehens}
        setShowSehens={setShowSehens}
        showHvoTankstelle={showHvoTankstelle}
        setShowHvoTankstelle={setShowHvoTankstelle}
        fDog={fDog}
        setFDog={setFDog}
        fSan={fSan}
        setFSan={setFSan}
        fYear={fYear}
        setFYear={setFYear}
        fOnline={fOnline}
        setFOnline={setFOnline}
        fGastro={fGastro}
        setFGastro={setFGastro}
        favoritesOnly={favoritesOnly}
        setFavoritesOnly={setFavoritesOnly}
        favoritesCount={favoritesCount}
        reviewFilter={reviewFilter}
        setReviewFilter={setReviewFilter}
        geoStatus={geoStatus}
        hasMyPos={!!myPos}
        showMyRings={showMyRings}
        setShowMyRings={setShowMyRings}
        onRequestMyLocation={requestMyLocation}
        onZoomToMyPos={zoomToMyPos}
        onRefresh={() => {
          void Promise.all([refreshPlaces(true), refreshTrips()]);
        }}
      />
    </div>
  );

  const detailPanel = (
    <div
      ref={(node) => {
        editorPanelRef.current = node;
        editorScrollRef.current = node;
      }}
      className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain rounded-[24px] border border-white/10 bg-white/5 [webkit-overflow-scrolling:touch]"
    >
      <EditorHeader
        editingNew={editingNew}
        saving={saving}
        formName={String(form.name ?? "")}
        formType={getPlaceTypeLabel((form.type ?? "CAMPINGPLATZ") as PlaceType)}
        score={editorDisplayScore}
        heroImage={heroImage ? { filename: heroImage.filename } : null}
        placeId={typeof form.id === "number" ? form.id : null}
        headerImages={headerImages}
        heroCandidateImages={heroCandidateHeaderImages}
        imagesCount={Array.isArray(form.images) ? form.images.length : 0}
        selectedPlace={selectedPlace}
        isFavorite={selectedPlaceIsFavorite}
        distanceKm={selectedDistanceKm}
        onOpenHeroLightbox={openHeroLightbox}
        onOpenLightboxByImageId={openLightboxById}
        onOpenCandidateLightbox={openCandidateLightbox}
        onOpenNav={() => setNavOpen(true)}
        onToggleFavorite={toggleSelectedPlaceFavorite}
        onSave={save}
        onCenterOnMap={centerSelectedPlaceOnMap}
        onJumpToTripAssignment={scrollToTripAssignment}
        onDelete={del}
        onNew={newPlace}
        canNavigate={canNavigateNow()}
        canDelete={!editingNew && !!form.id}
      />

      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[
            { id: "CORE" as const, label: "Kern" },
            { id: "TS" as const, label: "Törtchen" },
            { id: "MEDIA" as const, label: "Bilder" },
            { id: "REVIEW" as const, label: "Review" },
            { id: "ALL" as const, label: "Alles" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => applyDetailFocus(tab.id)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${
                detailFocusTab === tab.id
                  ? "border-[#f6c453]/40 bg-[#f6c453]/15 text-[#fff1cc]"
                  : "border-white/10 bg-white/5 text-white/75 hover:bg-white/10"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-8">
        {editorBody}
      </div>
    </div>
  );

  const workspacePanelContent =
    workspaceTab === "TRIP" ? tripPanel : workspaceTab === "DETAIL" ? detailPanel : workspaceTab === "FILTERS" ? filtersPanel : placesPanel;

  const toolbar = (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-1">
          <button
            type="button"
            onClick={() => {
              setWorkspaceMode("DISCOVER");
              openWorkspaceTab("PLACES", "half");
            }}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              workspaceMode === "DISCOVER" ? "bg-[#f6c453] text-black" : "text-white/70 hover:text-white"
            }`}
          >
            Entdecken
          </button>
          <button
            type="button"
            onClick={() => {
              setWorkspaceMode("TRIP");
              openWorkspaceTab("TRIP", "half");
            }}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              workspaceMode === "TRIP" ? "bg-[#f6c453] text-black" : "text-white/70 hover:text-white"
            }`}
          >
            Trip
          </button>
        </div>

        {selectedTrip ? (
          <button
            type="button"
            onClick={() => {
              setWorkspaceMode("TRIP");
              openWorkspaceTab("TRIP", "half");
            }}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85 hover:bg-white/10"
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: selectedTripColor }} />
            <span className="max-w-[180px] truncate">{selectedTrip.name}</span>
            <span className="text-xs text-white/55">{selectedTripStops.length} Stopps</span>
          </button>
        ) : null}

        {selectedPlace ? (
          <button
            type="button"
            onClick={() => openWorkspaceTab("DETAIL", "full")}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85 hover:bg-white/10"
          >
            <span className="max-w-[180px] truncate">{selectedPlace.name}</span>
            <span className="text-xs text-white/55">{getPlaceTypeLabel(selectedPlace.type)}</span>
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => openWorkspaceTab("FILTERS", isMobile ? "half" : "full")}
          className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10"
        >
          Filter
        </button>
        <button
          type="button"
          onClick={() => setFavoritesOnly((current) => !current)}
          className={`rounded-full border px-3 py-2 text-xs ${
            favoritesOnly
              ? "border-amber-300/35 bg-amber-400/15 text-amber-50"
              : "border-white/10 bg-white/5 text-white/85 hover:bg-white/10"
          }`}
        >
          {favoritesOnly ? "Favoriten aktiv" : "Favoriten"} {favoritesCount ? `${favoritesCount}` : ""}
        </button>
        <button
          type="button"
          onClick={() => openWorkspaceTab(workspaceMode === "TRIP" ? "TRIP" : "PLACES", "half")}
          className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10"
        >
          Workspace
        </button>
        <button
          type="button"
          onClick={() => openWorkspaceTab("DETAIL", "full")}
          className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10"
        >
          Details
        </button>
        <button
          type="button"
          onClick={newPlace}
          className="rounded-full border border-[#f6c453]/40 bg-[#f6c453]/15 px-3 py-2 text-xs font-semibold text-[#fff1cc] hover:bg-[#f6c453]/20"
        >
          + Ort
        </button>
      </div>
    </div>
  );

  const layout = (
    <WorkspaceShell
      isMobile={isMobile}
      mode={workspaceMode}
      onModeChange={(mode) => {
        setWorkspaceMode(mode);
        openWorkspaceTab(mode === "TRIP" ? "TRIP" : "PLACES", "half");
      }}
      toolbar={toolbar}
      mobileAction={
        <button
          type="button"
          onClick={newPlace}
          className="rounded-full border border-[#f6c453]/40 bg-[#f6c453]/15 px-3 py-2 text-xs font-semibold text-[#fff1cc] hover:bg-[#f6c453]/20"
        >
          + Ort
        </button>
      }
      map={mapSurface}
      panelTitle={panelTitle}
      panelSubtitle={panelSubtitle}
      tabs={workspaceTabs}
      activeTab={workspaceTab}
      onTabChange={(tab) => {
        setWorkspaceTab(tab);
        if (tab === "TRIP") setWorkspaceMode("TRIP");
        if (tab === "PLACES") setWorkspaceMode("DISCOVER");
      }}
      mobileSnap={mobileSheetSnap}
      onMobileSnapChange={setMobileSheetSnap}
      panelContent={workspacePanelContent}
    />
  );

  return (
    <div className="h-[100svh] w-full bg-black text-white">
      {layout}

      {navOpen ? (
        <div className="fixed inset-0 z-[9999]">
          <div className="absolute inset-0 bg-black/70" onClick={() => setNavOpen(false)} />
          <div className="absolute left-1/2 top-1/2 w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-black/85 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.60)] backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">Navigation starten</div>
                <div className="mt-1 text-xs opacity-70">
                  Ziel - {String(form.name ?? "Ort").trim() || "Ort"} - {String(form.lat ?? "")} - {String(form.lng ?? "")}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setNavOpen(false)}
                className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
                title="Schließen"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 grid gap-2">
              <button
                type="button"
                onClick={() => openNav("AUTO")}
                className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold hover:bg-white/15 disabled:opacity-60"
                disabled={!canNavigateNow()}
                title="Automatisch - iOS Apple Karten - sonst Google Maps"
              >
                🧭 Automatisch
              </button>

              <button
                type="button"
                onClick={() => openNav("GOOGLE")}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm hover:bg-white/10 disabled:opacity-60"
                disabled={!canNavigateNow()}
              >
                🗺️ Google Maps
              </button>

              <button
                type="button"
                onClick={() => openNav("APPLE")}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm hover:bg-white/10 disabled:opacity-60"
                disabled={!canNavigateNow()}
              >
                🍎 Apple Karten
              </button>
            </div>

            <div className="mt-3 text-xs opacity-60">Hinweis - auf Desktop öffnet sich ein neuer Tab - auf Mobile springt die Maps App meist direkt an.</div>
          </div>
        </div>
      ) : null}

      <Lightbox
        open={lbOpen}
        index={lbIndex}
        images={activeLightboxImages as any}
        placeId={typeof form.id === "number" ? form.id : null}
        choosingHero={saving}
        onClose={closeLightbox}
        onPrev={lbPrev}
        onNext={lbNext}
        onRate={(candidateId, vote) => {
          void rateHeroCandidateById(candidateId, vote);
        }}
        onChooseHero={(image) => {
          if (image.kind === "candidate" && image.candidateId) {
            void chooseHeroCandidateById(image.candidateId);
            return;
          }
          if (typeof image.id === "number") {
            void setHeroFromGalleryImage(image.id);
          }
        }}
      />
    </div>
  );
}
