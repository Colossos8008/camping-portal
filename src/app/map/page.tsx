// src/app/map/page.tsx
"use client";

import dynamic from "next/dynamic";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Ts21Editor, { TS21Detail } from "./ts21-editor";

import type { Place, PlaceType, SortMode } from "./_lib/types";
import { distanceKm } from "./_lib/geo";
import { safePlacesFromApi } from "./_lib/place";
import { blankRating } from "./_lib/rating";

import FiltersPanel from "./_components/FiltersPanel";
import PlacesList from "./_components/PlacesList";
import TogglePill from "./_components/TogglePill";
import EditorHeader from "./_components/EditorHeader";
import ImagesPanel from "./_components/ImagesPanel";
import Lightbox from "./_components/Lightbox";
import CollapsiblePanel from "./_components/CollapsiblePanel";

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

function safeNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

type EditorSectionId = "BASICS" | "TOGGLES" | "TS" | "IMAGES";

function collapsedSections(): Record<EditorSectionId, boolean> {
  return { BASICS: false, TOGGLES: false, TS: false, IMAGES: false };
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
            ▼
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
  const [selectedId, setSelectedId] = useState<number | null>(null);

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

  const [filtersOpen, setFiltersOpen] = useState(false);

  const [editingNew, setEditingNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickMode, setPickMode] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [pickedFiles, setPickedFiles] = useState<File[]>([]);

  const [lbOpen, setLbOpen] = useState(false);
  const [lbIndex, setLbIndex] = useState(0);

  const [isMobile, setIsMobile] = useState<boolean>(() => (typeof window === "undefined" ? false : isMobileNow()));

  const editorPanelRef = useRef<HTMLDivElement | null>(null);
  const mapPanelRef = useRef<HTMLDivElement | null>(null);

  const editorScrollRef = useRef<HTMLDivElement | null>(null);

  const [panelMapOpen, setPanelMapOpen] = useState(true);
  const [panelEditorOpen, setPanelEditorOpen] = useState(true);
  const [panelPlacesOpen, setPanelPlacesOpen] = useState(true);

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
    thumbnailImageId: null,
  });

  const [navOpen, setNavOpen] = useState(false);

  const [sectionOpen, setSectionOpen] = useState<Record<EditorSectionId, boolean>>(collapsedSections());

  const geoWatchIdRef = useRef<number | null>(null);

  function scrollEditorTop() {
    requestAnimationFrame(() => {
      try {
        editorScrollRef.current?.scrollTo({ top: 0 });
      } catch {}
    });
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
    saveSectionState(sectionOpen);
  }, [sectionOpen]);

  function setSection(id: EditorSectionId, v: boolean) {
    setSectionOpen((s) => ({ ...s, [id]: v }));
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

  async function refreshPlaces(keepSelection = true) {
    const data = await fetch("/api/places", { cache: "no-store" }).then((r) => r.json());
    const arr = safePlacesFromApi(data);
    setPlaces(arr);

    if (!keepSelection) {
      const first = arr[0]?.id ?? null;
      setSelectedId(first);
    } else {
      if (selectedId == null && arr.length) setSelectedId(arr[0].id);
    }
  }

  useEffect(() => {
    refreshPlaces(true).catch(() => setPlaces([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedPlace = useMemo(() => places.find((p) => p.id === selectedId) ?? null, [places, selectedId]);

  const placesWithDistance = useMemo(() => {
    if (!myPos) return places.map((p) => ({ ...p, distanceKm: null } as any));
    return places.map((p) => {
      const km = distanceKm(myPos.lat, myPos.lng, p.lat, p.lng);
      return { ...p, distanceKm: Number.isFinite(km) ? km : null } as any;
    });
  }, [places, myPos]);

  const filteredPlaces = useMemo(() => {
    return placesWithDistance.filter((p: any) => {
      if (p.type === "STELLPLATZ" && !showStellplatz) return false;
      if (p.type === "CAMPINGPLATZ" && !showCampingplatz) return false;
      if (p.type === "SEHENSWUERDIGKEIT" && !showSehens) return false;
      if (p.type === "HVO_TANKSTELLE" && !showHvoTankstelle) return false;

      if (fDog && !p.dogAllowed) return false;
      if (fSan && !p.sanitary) return false;
      if (fYear && !p.yearRound) return false;
      if (fOnline && !p.onlineBooking) return false;
      if (fGastro && !p.gastronomy) return false;

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
  ]);

  function scoreForListOrSort(p: any): number {
    if (!isTsRelevantType(p?.type)) return 0;

    const t21 = ts21TotalFromDetail(p?.ts21);
    if (t21 != null) return t21;

    const t1 = p?.ratingDetail?.totalPoints;
    return typeof t1 === "number" && Number.isFinite(t1) ? t1 : 0;
  }

  const sortedPlaces = useMemo(() => {
    const list = [...filteredPlaces];

    if (sortMode === "ALPHA") {
      list.sort((a: any, b: any) => a.name.localeCompare(b.name, "de"));
      return list;
    }

    if (sortMode === "DIST") {
      list.sort((a: any, b: any) => {
        const da = typeof a.distanceKm === "number" ? a.distanceKm : Number.POSITIVE_INFINITY;
        const db = typeof b.distanceKm === "number" ? b.distanceKm : Number.POSITIVE_INFINITY;
        return da - db;
      });
      return list;
    }

    list.sort((a: any, b: any) => scoreForListOrSort(b) - scoreForListOrSort(a));
    return list;
  }, [filteredPlaces, sortMode]);

  useEffect(() => {
    if (!selectedPlace) return;
    const selectedAny = selectedPlace as any;

    setEditingNew(false);
    setPickMode(false);
    setErrorMsg("");
    setUploadMsg("");
    setPickedFiles([]);

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
      thumbnailImageId: (selectedPlace as any).thumbnailImageId ?? null,
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
    setSelectedId(id);
    setSelectTick((t) => t + 1);
    setFocusToken((t) => t + 1);

    scrollEditorTop();

    if (isMobile) {
      if (source === "list") {
        setPanelMapOpen(true);
        setPanelEditorOpen(true);
        setSectionOpen(collapsedSections());
        scrollToMapIfMobile();
        return;
      }

      setPanelEditorOpen(true);
      scrollToEditorIfMobile();
    }
  }

  function newPlace() {
    setEditingNew(true);
    setSelectedId(null);
    setPickMode(false);
    setErrorMsg("");
    setUploadMsg("");
    setPickedFiles([]);
    setSelectTick((t) => t + 1);

    scrollEditorTop();

    if (isMobile) {
      setPanelEditorOpen(true);
      scrollToEditorIfMobile();
    }

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
      thumbnailImageId: null,
    });
  }

  async function save() {
    setSaving(true);
    setErrorMsg("");

    try {
      const isNew = editingNew || !form.id;

      const payload: any = {
        ...(isNew ? {} : { id: Number(form.id) }),
        name: String(form.name ?? "").trim(),
        type: form.type,
        lat: Number(form.lat),
        lng: Number(form.lng),
        dogAllowed: !!form.dogAllowed,
        sanitary: !!form.sanitary,
        yearRound: !!form.yearRound,
        onlineBooking: !!form.onlineBooking,
        gastronomy: !!form.gastronomy,
        ratingDetail: {
          upsert: {
            create: { ...(form.ratingDetail ?? blankRating()) },
            update: { ...(form.ratingDetail ?? blankRating()) },
          },
        },
        ts2: form.ts2 ?? null,
        ts21: form.ts21 ?? null,
        thumbnailImageId: form.thumbnailImageId ?? null,
      };

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
      const nextId = Number(saved?.id ?? (isNew ? NaN : form.id));

      await refreshPlaces(true);

      if (Number.isFinite(nextId)) {
        setSelectedId(nextId);
        setSelectTick((t) => t + 1);
      }

      setEditingNew(false);
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

      await refreshPlaces(true);
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
        images: Array.isArray(updated?.images) ? updated.images : f.images,
      }));

      await refreshPlaces(true);
    } finally {
      setUploading(false);
    }
  }

  const headerImages = useMemo(() => {
    const imgs = Array.isArray(form.images) ? [...form.images] : [];
    const tid = Number(form.thumbnailImageId);
    if (!Number.isFinite(tid)) return imgs;

    const idx = imgs.findIndex((x: any) => Number(x.id) === tid);
    if (idx <= 0) return imgs;

    const [hit] = imgs.splice(idx, 1);
    return [hit, ...imgs];
  }, [form.images, form.thumbnailImageId]);

  const heroImage = headerImages.length ? headerImages[0] : null;

  function lbList() {
    return Array.isArray(headerImages) && headerImages.length ? headerImages : Array.isArray(form.images) ? form.images : [];
  }

  function openLightbox(index: number) {
    const imgs = lbList();
    if (!imgs.length) return;
    const idx = Math.max(0, Math.min(index, imgs.length - 1));
    setLbIndex(idx);
    setLbOpen(true);
  }

  function openLightboxById(imageId: number) {
    const imgs = lbList();
    if (!imgs.length) return;
    const idx = imgs.findIndex((x: any) => Number(x.id) === Number(imageId));
    openLightbox(idx >= 0 ? idx : 0);
  }

  function closeLightbox() {
    setLbOpen(false);
  }

  function lbPrev() {
    const imgs = lbList();
    if (!imgs.length) return;
    setLbIndex((i) => (i - 1 + imgs.length) % imgs.length);
  }

  function lbNext() {
    const imgs = lbList();
    if (!imgs.length) return;
    setLbIndex((i) => (i + 1) % imgs.length);
  }

  const lbImages = useMemo(() => lbList(), [form.images, headerImages]);

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
    return `${openCount}/4`;
  }, [sectionOpen]);

  function openAllSections() {
    setSectionOpen({ BASICS: true, TOGGLES: true, TS: true, IMAGES: true });
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

  // WICHTIG: stabiler JSX-Block (kein inneres Component), damit kein Remount pro Keystroke
  const editorBody = useMemo(() => {
    return (
      <div className="space-y-3 pt-3">
        {errorMsg ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">{errorMsg}</div> : null}

        <div className="flex items-center justify-between gap-2">
          <div className="text-xs opacity-70">Sektionen {sectionsHint}</div>
          {editorSectionsToolbar}
        </div>

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

            <div className="flex items-center gap-2">
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
                  setPickMode((v) => !v);
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
                onClick={() => setNavOpen(true)}
                className="h-9 shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 text-xs hover:bg-white/10 disabled:opacity-60"
                disabled={saving || !canNavigateNow()}
                title="Navigation starten"
              >
                🧭 Navi
              </button>
            </div>
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
            <Ts21Editor value={(form.ts21 ?? null) as TS21Detail | null} onChange={(next) => setForm((f: any) => ({ ...f, ts21: next }))} disabled={saving} />
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

        <button
          type="button"
          onClick={save}
          className="mt-1 w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold hover:bg-white/15 disabled:opacity-60"
          disabled={saving}
        >
          {saving ? "Speichert..." : "Speichern"}
        </button>
      </div>
    );
  }, [
    errorMsg,
    sectionsHint,
    editorSectionsToolbar,
    sectionOpen,
    form,
    pickMode,
    saving,
    shouldShowTS,
    uploading,
    uploadMsg,
    pickedFiles.length,
  ]);

  const layout = isMobile ? (
    <div className="mx-auto flex h-full max-w-[1800px] flex-col gap-4 px-4 py-4">
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
            onRefresh={() => refreshPlaces(true)}
          />
        </div>
      </div>

      <div className="w-full" ref={mapPanelRef}>
        <CollapsiblePanel title="Map" icon="🗺️" open={panelMapOpen} onOpenChange={setPanelMapOpen}>
          <div className="relative h-[60svh] min-h-[360px] w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            <MapClient
              places={sortedPlaces as any}
              selectedId={selectedId}
              onSelect={(id: number) => selectPlace(id, "map")}
              pickMode={pickMode}
              onPick={(lat: number, lng: number) => {
                setForm((f: any) => ({ ...f, lat, lng }));
                setPickMode(false);
                setSelectTick((t) => t + 1);
              }}
              focusToken={focusToken}
              myPos={myPos}
              myPosFocusToken={myPosFocusToken}
              showMyRings={showMyRings}
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
              formType={String((form.type ?? "CAMPINGPLATZ") as string)}
              score={editorScore}
              heroImage={heroImage ? { filename: heroImage.filename } : null}
              headerImages={headerImages}
              imagesCount={Array.isArray(form.images) ? form.images.length : 0}
              selectedPlace={selectedPlace}
              distanceKm={selectedDistanceKm}
              onOpenLightbox={openLightbox}
              onSave={save}
              onDelete={del}
              onNew={newPlace}
              canDelete={!editingNew && !!form.id}
            />

            <div ref={editorScrollRef} className="min-h-0 flex-1 overflow-auto px-4 pb-4">
              {editorBody}
            </div>
          </div>
        </CollapsiblePanel>
      </div>

      <div className="w-full">
        <CollapsiblePanel title="Orte" icon="📍" open={panelPlacesOpen} onOpenChange={setPanelPlacesOpen}>
          <div className="h-[70svh] min-h-[420px]">
            <PlacesList
              places={sortedPlaces as any}
              selectedId={selectedId}
              onSelect={(id) => selectPlace(id, "list")}
              sortMode={sortMode}
              setSortMode={setSortMode}
              geoStatus={geoStatus}
              onRequestMyLocation={requestMyLocation}
              hasMyPos={!!myPos}
              onZoomToMyPos={zoomToMyPos}
              showMyRings={showMyRings}
              setShowMyRings={setShowMyRings}
            />
          </div>
        </CollapsiblePanel>
      </div>
    </div>
  ) : (
    <div className="mx-auto flex h-full max-w-[1800px] flex-col gap-4 px-4 py-4 lg:flex-row lg:min-h-0">
      <div className="w-[320px] shrink-0 lg:min-h-0">
        <PlacesList
          places={sortedPlaces as any}
          selectedId={selectedId}
          onSelect={(id) => selectPlace(id, "list")}
          sortMode={sortMode}
          setSortMode={setSortMode}
          geoStatus={geoStatus}
          onRequestMyLocation={requestMyLocation}
          hasMyPos={!!myPos}
          onZoomToMyPos={zoomToMyPos}
          showMyRings={showMyRings}
          setShowMyRings={setShowMyRings}
        />
      </div>

      <div className="min-h-0 flex-1">
        <div className="relative h-full min-h-0 w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5">
          <MapClient
            places={sortedPlaces as any}
            selectedId={selectedId}
            onSelect={(id: number) => selectPlace(id, "map")}
            pickMode={pickMode}
            onPick={(lat: number, lng: number) => {
              setForm((f: any) => ({ ...f, lat, lng }));
              setPickMode(false);
              setSelectTick((t) => t + 1);
            }}
            focusToken={focusToken}
            myPos={myPos}
            myPosFocusToken={myPosFocusToken}
            showMyRings={showMyRings}
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
            onRefresh={() => refreshPlaces(true)}
          />

          <div className="min-h-0 flex flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            <div>
              <EditorHeader
                editingNew={editingNew}
                saving={saving}
                formName={String(form.name ?? "")}
                formType={String((form.type ?? "CAMPINGPLATZ") as string)}
                score={editorScore}
                heroImage={heroImage ? { filename: heroImage.filename } : null}
                headerImages={headerImages}
                imagesCount={Array.isArray(form.images) ? form.images.length : 0}
                selectedPlace={selectedPlace}
                distanceKm={selectedDistanceKm}
                onOpenLightbox={openLightbox}
                onSave={save}
                onDelete={del}
                onNew={newPlace}
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

      <Lightbox open={lbOpen} index={lbIndex} images={lbImages as any} onClose={closeLightbox} onPrev={lbPrev} onNext={lbNext} />
    </div>
  );
}