// src/app/map/page.tsx
"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import TsEditor, { RatingDetail } from "./ts-editor";

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

export default function MapPage() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [selectTick, setSelectTick] = useState(0);
  const [focusToken, setFocusToken] = useState(0);

  const [sortMode, setSortMode] = useState<SortMode>("SCORE");

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

  const [isMobile, setIsMobile] = useState(false);

  const editorPanelRef = useRef<HTMLDivElement | null>(null);

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
    images: [],
    thumbnailImageId: null,
  });

  useEffect(() => {
    setIsMobile(isMobileNow());

    function onResize() {
      setIsMobile(isMobileNow());
    }

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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
    if (!myPos) return places.map((p) => ({ ...p, distanceKm: null }));
    return places.map((p) => {
      const km = distanceKm(myPos.lat, myPos.lng, p.lat, p.lng);
      return { ...p, distanceKm: Number.isFinite(km) ? km : null };
    });
  }, [places, myPos]);

  const filteredPlaces = useMemo(() => {
    return placesWithDistance.filter((p) => {
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

  const sortedPlaces = useMemo(() => {
    const list = [...filteredPlaces];

    if (sortMode === "ALPHA") {
      list.sort((a, b) => a.name.localeCompare(b.name, "de"));
      return list;
    }

    if (sortMode === "DIST") {
      list.sort((a, b) => {
        const da = typeof a.distanceKm === "number" ? a.distanceKm : Number.POSITIVE_INFINITY;
        const db = typeof b.distanceKm === "number" ? b.distanceKm : Number.POSITIVE_INFINITY;
        return da - db;
      });
      return list;
    }

    list.sort((a, b) => (b.ratingDetail?.totalPoints ?? 0) - (a.ratingDetail?.totalPoints ?? 0));
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
      dogAllowed: !!selectedPlace.dogAllowed,
      sanitary: !!selectedPlace.sanitary,
      yearRound: !!selectedPlace.yearRound,
      onlineBooking: !!selectedPlace.onlineBooking,
      gastronomy: !!selectedPlace.gastronomy,
      ratingDetail: (selectedPlace.ratingDetail ?? blankRating()) as RatingDetail,
      ts2: selectedAny?.ts2 ?? null,
      images: Array.isArray(selectedPlace.images) ? selectedPlace.images : [],
      thumbnailImageId: selectedPlace.thumbnailImageId ?? null,
    });
  }, [selectedPlace]);

  function scrollToEditorIfMobile() {
    if (!isMobile) return;
    requestAnimationFrame(() => {
      editorPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function selectPlace(id: number, source: "list" | "map" = "list") {
    setSelectedId(id);
    setSelectTick((t) => t + 1);
    setFocusToken((t) => t + 1);

    if (isMobile) {
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
      };

      const url = isNew ? "/api/places" : `/api/places/${form.id}`;
      const method = isNew ? "POST" : "PATCH";

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

  const totalPoints = useMemo(() => {
    const rd = (form.ratingDetail ?? blankRating()) as RatingDetail;
    return rd.totalPoints ?? 0;
  }, [form.ratingDetail]);

  const editorKey = `${editingNew ? "new" : selectedId ?? "none"}-${selectTick}`;

  function requestMyLocation() {
    setGeoStatus("");
    if (!navigator.geolocation) {
      setGeoStatus("Geolocation nicht verfügbar");
      return;
    }

    setGeoStatus("Bitte Browser-Erlaubnis geben…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoStatus("Eigenposition gesetzt");
      },
      () => setGeoStatus("Nicht erlaubt / fehlgeschlagen"),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
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

  return (
    <div className="h-[100svh] w-full bg-black text-white">
      <div className="mx-auto flex h-full max-w-[1800px] flex-col gap-4 px-4 py-4 lg:flex-row lg:min-h-0">
        {/* MOBILE ORDER: Filter -> Map -> Editor -> Orte */}
        <div className="w-full lg:hidden">
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

        <div className="w-full lg:hidden">
          <CollapsiblePanel title="Map" icon="🗺️" open={panelMapOpen} onOpenChange={setPanelMapOpen}>
            <div className="relative h-[60svh] min-h-[360px] w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5">
              <MapClient
                places={sortedPlaces}
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

        <div className="w-full lg:hidden" ref={editorPanelRef}>
          <CollapsiblePanel title="Editor" icon="📝" open={panelEditorOpen} onOpenChange={setPanelEditorOpen}>
            <div className="min-h-0 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5">
              <EditorHeader
                editingNew={editingNew}
                saving={saving}
                formName={String(form.name ?? "")}
                formType={String((form.type ?? "CAMPINGPLATZ") as string)}
                totalPoints={totalPoints}
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

              <div key={editorKey} className="min-h-0 flex-1 overflow-auto px-4 pb-4">
                <div className="space-y-2 pt-3">
                  {errorMsg ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">{errorMsg}</div> : null}

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
                      onClick={() => {
                        setPickMode((v) => !v);
                        setSelectTick((t) => t + 1);
                      }}
                      className={`h-9 shrink-0 rounded-xl border px-3 text-xs hover:opacity-95 ${pickMode ? "border-white/25 bg-white/10" : "border-white/10 bg-white/5"}`}
                      disabled={saving}
                      title={pickMode ? "Karten-Pick beenden" : "Koordinaten aus Karte wählen"}
                    >
                      📍 Karte
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <TogglePill on={!!form.dogAllowed} icon="🐕" label="Hunde" onClick={() => setForm((f: any) => ({ ...f, dogAllowed: !f.dogAllowed }))} />
                    <TogglePill on={!!form.sanitary} icon="🚿" label="Sanitär" onClick={() => setForm((f: any) => ({ ...f, sanitary: !f.sanitary }))} />
                    <TogglePill on={!!form.yearRound} icon="📆" label="Ganzjährig" onClick={() => setForm((f: any) => ({ ...f, yearRound: !f.yearRound }))} />
                    <TogglePill on={!!form.onlineBooking} icon="🌐" label="Online" onClick={() => setForm((f: any) => ({ ...f, onlineBooking: !f.onlineBooking }))} />
                    <TogglePill on={!!form.gastronomy} icon="🍽️" label="Gastro" onClick={() => setForm((f: any) => ({ ...f, gastronomy: !f.gastronomy }))} />
                  </div>

                  <div className="my-2 h-px bg-white/10" />

                  <TsEditor
                    rating={(form.ratingDetail ?? blankRating()) as RatingDetail}
                    onChange={(next, computedTotal) => {
                      setForm((f: any) => ({ ...f, ratingDetail: { ...next, totalPoints: computedTotal } }));
                    }}
                    disabled={saving}
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

                  <button
                    onClick={save}
                    className="mt-3 w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold hover:bg-white/15 disabled:opacity-60"
                    disabled={saving}
                  >
                    {saving ? "Speichert..." : "Speichern"}
                  </button>
                </div>
              </div>
            </div>
          </CollapsiblePanel>
        </div>

        <div className="w-full lg:hidden">
          <CollapsiblePanel title="Orte" icon="📍" open={panelPlacesOpen} onOpenChange={setPanelPlacesOpen}>
            <div className="h-[70svh] min-h-[420px]">
              <PlacesList
                places={sortedPlaces}
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

        {/* DESKTOP LAYOUT: Orte links, Map Mitte, rechts Filter + Editor */}
        <div className="hidden w-full lg:flex lg:flex-row lg:gap-4 lg:min-h-0">
          <div className="w-[320px] shrink-0 lg:min-h-0">
            <PlacesList
              places={sortedPlaces}
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
            {/* FIX: keep height on desktop - do NOT use lg:h-auto */}
            <div className="relative h-full min-h-0 w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5">
              <MapClient
                places={sortedPlaces}
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
                <div ref={editorPanelRef}>
                  <EditorHeader
                    editingNew={editingNew}
                    saving={saving}
                    formName={String(form.name ?? "")}
                    formType={String((form.type ?? "CAMPINGPLATZ") as string)}
                    totalPoints={totalPoints}
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

                <div key={editorKey} className="min-h-0 flex-1 overflow-auto px-4 pb-4">
                  <div className="space-y-2 pt-3">
                    {errorMsg ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">{errorMsg}</div> : null}

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
                        onClick={() => {
                          setPickMode((v) => !v);
                          setSelectTick((t) => t + 1);
                        }}
                        className={`h-9 shrink-0 rounded-xl border px-3 text-xs hover:opacity-95 ${pickMode ? "border-white/25 bg-white/10" : "border-white/10 bg-white/5"}`}
                        disabled={saving}
                        title={pickMode ? "Karten-Pick beenden" : "Koordinaten aus Karte wählen"}
                      >
                        📍 Karte
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <TogglePill on={!!form.dogAllowed} icon="🐕" label="Hunde" onClick={() => setForm((f: any) => ({ ...f, dogAllowed: !f.dogAllowed }))} />
                      <TogglePill on={!!form.sanitary} icon="🚿" label="Sanitär" onClick={() => setForm((f: any) => ({ ...f, sanitary: !f.sanitary }))} />
                      <TogglePill on={!!form.yearRound} icon="📆" label="Ganzjährig" onClick={() => setForm((f: any) => ({ ...f, yearRound: !f.yearRound }))} />
                      <TogglePill on={!!form.onlineBooking} icon="🌐" label="Online" onClick={() => setForm((f: any) => ({ ...f, onlineBooking: !f.onlineBooking }))} />
                      <TogglePill on={!!form.gastronomy} icon="🍽️" label="Gastro" onClick={() => setForm((f: any) => ({ ...f, gastronomy: !f.gastronomy }))} />
                    </div>

                    <div className="my-2 h-px bg-white/10" />

                    <TsEditor
                      rating={(form.ratingDetail ?? blankRating()) as RatingDetail}
                      onChange={(next, computedTotal) => {
                        setForm((f: any) => ({ ...f, ratingDetail: { ...next, totalPoints: computedTotal } }));
                      }}
                      disabled={saving}
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

                    <button
                      onClick={save}
                      className="mt-3 w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold hover:bg-white/15 disabled:opacity-60"
                      disabled={saving}
                    >
                      {saving ? "Speichert..." : "Speichern"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="text-xs opacity-70">Sortierung wirkt nur auf die Liste (kein Zoom).</div>
            </div>
          </div>
        </div>
      </div>

      <Lightbox open={lbOpen} index={lbIndex} images={lbImages} onClose={closeLightbox} onPrev={lbPrev} onNext={lbNext} />
    </div>
  );
}
