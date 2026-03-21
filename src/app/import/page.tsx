"use client";

import React, { useEffect, useMemo, useState } from "react";

type ImportRowResult =
  | { status: "created" | "updated" | "skipped"; placeName: string; message?: string }
  | { status: "error"; placeName: string; message: string };

type ImportResponse = {
  ok: boolean;
  error?: string;
  summary?: { created: number; updated: number; skipped: number; error: number };
  results?: ImportRowResult[];
  debug?: {
    httpStatus: number;
    httpStatusText: string;
    rawResponseSnippet?: string;
  };
};

type PlaceType = "CAMPINGPLATZ" | "STELLPLATZ" | "HVO_TANKSTELLE" | "SEHENSWUERDIGKEIT";

type CountsResponse = {
  ok: boolean;
  error?: string;
  countsByType?: Record<PlaceType, number>;
  total?: number;
  debug?: {
    httpStatus: number;
    httpStatusText: string;
    rawResponseSnippet?: string;
  };
};

type DeleteResponse = {
  ok: boolean;
  error?: string;
  deleted?: number;
  type?: PlaceType;
  debug?: {
    httpStatus: number;
    httpStatusText: string;
    rawResponseSnippet?: string;
  };
};

type HeroAutofillAction =
  | "created"
  | "updated"
  | "skipped"
  | "error"
  | "would-create"
  | "would-update";

type HeroAutofillResponse = {
  totalPlaces: number;
  processed: number;
  updated: number;
  skipped: number;
  failed: number;
  nextCursor: string | null;
  counts: { created: number; updated: number; skipped: number; errors: number };
  results: Array<{
    id: string;
    name: string;
    status: "UPDATED" | "SKIPPED" | "FAILED";
    reason: string;
    score?: number;
    source?: "google" | "wikimedia" | "placeholder";
    heroReason?: string;
    placeId: string;
    placeName: string;
    action: HeroAutofillAction;
    chosenUrl?: string;
  }>;
  error?: string;
  capApplied?: { requestedLimit: number; appliedLimit: number; hardCap: number } | null;
};

type SightseeingQualityFailure = {
  id: number;
  name: string;
  type: PlaceType;
  descriptionOk: boolean;
  descriptionLength: number;
  heroOk: boolean;
  heroStatus: number | null;
  heroLocation: string | null;
  heroContentType: string | null;
  heroUsedPlaceholder: string | null;
  thumbnailImageId: number | null;
  heroImageUrl: string | null;
};

type SightseeingQualityResponse = {
  ok: boolean;
  error?: string;
  placeType?: PlaceType;
  checkedAt?: string;
  total?: number;
  passed?: number;
  failed?: number;
  counts?: {
    missingDescription: number;
    brokenHero: number;
  };
  failures?: SightseeingQualityFailure[];
};

type SightseeingQualityRepairResponse = {
  ok: boolean;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
};

const PLACE_TYPES: Array<{ type: PlaceType; label: string }> = [
  { type: "CAMPINGPLATZ", label: "Campingplatz" },
  { type: "STELLPLATZ", label: "Stellplatz" },
  { type: "HVO_TANKSTELLE", label: "HVO Tankstelle" },
  { type: "SEHENSWUERDIGKEIT", label: "Sehenswürdigkeit" },
];

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState<ImportResponse | null>(null);

  const [countsBusy, setCountsBusy] = useState(false);
  const [counts, setCounts] = useState<CountsResponse | null>(null);

  const [confirmGlobal, setConfirmGlobal] = useState(false);
  const [confirmByType, setConfirmByType] = useState<Record<PlaceType, boolean>>({
    CAMPINGPLATZ: false,
    STELLPLATZ: false,
    HVO_TANKSTELLE: false,
    SEHENSWUERDIGKEIT: false,
  });
  const [deleteBusyByType, setDeleteBusyByType] = useState<Record<PlaceType, boolean>>({
    CAMPINGPLATZ: false,
    STELLPLATZ: false,
    HVO_TANKSTELLE: false,
    SEHENSWUERDIGKEIT: false,
  });
  const [deleteResp, setDeleteResp] = useState<DeleteResponse | null>(null);

  const [heroLimit, setHeroLimit] = useState(250);
  const [heroForce, setHeroForce] = useState(false);
  const [heroDryRun, setHeroDryRun] = useState(true);
  const [heroProvider, setHeroProvider] = useState<"google" | "wikimedia" | "auto">("auto");
  const [heroRadiusMeters, setHeroRadiusMeters] = useState(200);
  const [heroCursor, setHeroCursor] = useState("");
  const [heroOffset, setHeroOffset] = useState(0);
  const [heroMaxCandidates, setHeroMaxCandidates] = useState(12);
  const [heroTypesInput, setHeroTypesInput] = useState("");
  const [heroBusy, setHeroBusy] = useState(false);
  const [heroResp, setHeroResp] = useState<HeroAutofillResponse | null>(null);
  const [heroError, setHeroError] = useState<string | null>(null);
  const [qualityBusy, setQualityBusy] = useState(false);
  const [qualityResp, setQualityResp] = useState<SightseeingQualityResponse | null>(null);
  const [qualityError, setQualityError] = useState<string | null>(null);
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairResp, setRepairResp] = useState<SightseeingQualityRepairResponse | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [qualityType, setQualityType] = useState<PlaceType>("SEHENSWUERDIGKEIT");

  const hasErrors = useMemo(
    () => (resp?.results ?? []).some((r) => r.status === "error"),
    [resp]
  );

  const heroRequestUrl = useMemo(() => {
    const params = new URLSearchParams();

    params.set("limit", String(heroLimit));
    params.set("provider", heroProvider);
    params.set("radius", String(heroRadiusMeters));
    params.set("maxCandidatesPerPlace", String(heroMaxCandidates));

    if (heroTypesInput !== "") params.set("types", heroTypesInput);
    if (heroForce) params.set("force", "1");
    if (heroDryRun) params.set("dryRun", "1");
    if (heroCursor !== "") params.set("cursor", heroCursor);
    if (heroOffset > 0) params.set("offset", String(heroOffset));

    return `/api/admin/hero-autofill?${params.toString()}`;
  }, [
    heroLimit,
    heroProvider,
    heroRadiusMeters,
    heroMaxCandidates,
    heroTypesInput,
    heroForce,
    heroDryRun,
    heroCursor,
    heroOffset,
  ]);

  async function loadCounts() {
    setCountsBusy(true);
    setCounts(null);

    try {
      const res = await fetch("/api/admin/place-counts", {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      const raw = await res.text();

      let json: CountsResponse | null = null;
      try {
        json = JSON.parse(raw) as CountsResponse;
      } catch {
        // not JSON
      }

      if (json) {
        setCounts(json);
      } else {
        setCounts({
          ok: false,
          error: "API did not return JSON.",
          debug: {
            httpStatus: res.status,
            httpStatusText: res.statusText,
            rawResponseSnippet: raw.slice(0, 800),
          },
        });
      }
    } catch (e: any) {
      setCounts({ ok: false, error: e?.message ?? "Request failed" });
    } finally {
      setCountsBusy(false);
    }
  }

  useEffect(() => {
    void loadCounts();
  }, []);

  async function onImport() {
    if (!file) return;
    setBusy(true);
    setResp(null);

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/import/ina-csv", {
        method: "POST",
        body: form,
        headers: {
          Accept: "application/json",
        },
      });

      const raw = await res.text();

      let json: ImportResponse | null = null;
      try {
        json = JSON.parse(raw) as ImportResponse;
      } catch {
        // not JSON
      }

      if (json) {
        setResp(json);
        void loadCounts();
      } else {
        setResp({
          ok: false,
          error: "API did not return JSON.",
          debug: {
            httpStatus: res.status,
            httpStatusText: res.statusText,
            rawResponseSnippet: raw.slice(0, 500),
          },
        });
      }
    } catch (e: any) {
      setResp({ ok: false, error: e?.message ?? "Request failed" });
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteAllByType(type: PlaceType) {
    setDeleteResp(null);
    if (!confirmGlobal || !confirmByType[type]) return;

    setDeleteBusyByType((p) => ({ ...p, [type]: true }));
    try {
      const res = await fetch("/api/admin/delete-places-by-type", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });

      const raw = await res.text();

      let json: DeleteResponse | null = null;
      try {
        json = JSON.parse(raw) as DeleteResponse;
      } catch {
        // not JSON
      }

      if (json) {
        setDeleteResp(json);
      } else {
        setDeleteResp({
          ok: false,
          error: "API did not return JSON.",
          debug: {
            httpStatus: res.status,
            httpStatusText: res.statusText,
            rawResponseSnippet: raw.slice(0, 800),
          },
        });
      }

      void loadCounts();
    } catch (e: any) {
      setDeleteResp({ ok: false, error: e?.message ?? "Request failed" });
    } finally {
      setDeleteBusyByType((p) => ({ ...p, [type]: false }));
      setConfirmByType((p) => ({ ...p, [type]: false }));
    }
  }

  async function onHeroAutofill() {
    setHeroBusy(true);
    setHeroError(null);
    setHeroResp(null);

    try {
      const res = await fetch(heroRequestUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      });

      const raw = await res.text();

      let json: HeroAutofillResponse | null = null;
      try {
        json = JSON.parse(raw) as HeroAutofillResponse;
      } catch {
        // not JSON
      }

      if (!json) {
        setHeroError(`API did not return JSON (HTTP ${res.status} ${res.statusText})`);
        return;
      }

      setHeroResp(json);
      if (json.error) {
        setHeroError(json.error);
      }
      void loadCounts();
    } catch (e: any) {
      setHeroError(e?.message ?? "Request failed");
    } finally {
      setHeroBusy(false);
    }
  }

  async function loadSightseeingQuality() {
    setQualityBusy(true);
    setQualityError(null);
    setQualityResp(null);

    try {
      const params = new URLSearchParams({ type: qualityType });
      const res = await fetch(`/api/admin/sightseeing-quality-report?${params.toString()}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      });

      const raw = await res.text();

      let json: SightseeingQualityResponse | null = null;
      try {
        json = JSON.parse(raw) as SightseeingQualityResponse;
      } catch {
        // not JSON
      }

      if (!json) {
        setQualityError(`API did not return JSON (HTTP ${res.status} ${res.statusText})`);
        return;
      }

      setQualityResp(json);
      if (!json.ok) {
        setQualityError(json.error ?? "Quality check failed");
      }
    } catch (e: any) {
      setQualityError(e?.message ?? "Request failed");
    } finally {
      setQualityBusy(false);
    }
  }

  async function runSightseeingRepair() {
    setRepairBusy(true);
    setRepairResp(null);
    setRepairError(null);

    try {
      const params = new URLSearchParams({ type: qualityType });
      const res = await fetch(`/api/admin/sightseeing-quality-repair?${params.toString()}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      });

      const raw = await res.text();

      let json: SightseeingQualityRepairResponse | null = null;
      try {
        json = JSON.parse(raw) as SightseeingQualityRepairResponse;
      } catch {
        // not JSON
      }

      if (!json) {
        setRepairError(`API did not return JSON (HTTP ${res.status} ${res.statusText})`);
        return;
      }

      setRepairResp(json);
      if (!json.ok) {
        setRepairError("Auto-Repair failed");
        return;
      }

      await loadSightseeingQuality();
    } catch (e: any) {
      setRepairError(e?.message ?? "Request failed");
    } finally {
      setRepairBusy(false);
    }
  }

  const totalCount = counts?.countsByType
    ? Object.values(counts.countsByType).reduce((a, b) => a + (b ?? 0), 0)
    : 0;

  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
        Import – Ina CSV
      </h1>

      <p style={{ marginTop: 0, opacity: 0.85 }}>
        CSV Upload für den MVP-Import.<br />
        Kommentarzeilen mit <code>#</code> werden ignoriert.<br />
        <strong>Geo-Priorität:</strong> lat+lng (falls vorhanden) → plusCode → googleMapsUrl (Redirect wird aufgelöst).<br />
        <strong>Typ:</strong> placeTypeHint (falls vorhanden) → sonst Heuristik aus placeName.
      </p>

      <section
        style={{
          marginTop: 16,
          padding: 16,
          border: "1px solid rgba(0,0,0,0.15)",
          borderRadius: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>DB – Übersicht pro Typ</h2>
          <button
            onClick={loadCounts}
            disabled={countsBusy}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.2)",
              cursor: countsBusy ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
          >
            {countsBusy ? "Lade…" : "Refresh"}
          </button>
        </div>

        {counts && !counts.ok && (
          <div style={{ marginTop: 10 }}>
            <div style={{ color: "crimson", fontWeight: 800 }}>
              Fehler: {counts.error}
            </div>

            {counts.debug && (
              <div
                style={{
                  marginTop: 10,
                  padding: 12,
                  borderRadius: 10,
                  background: "rgba(0,0,0,0.04)",
                }}
              >
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Debug</div>
                <div>
                  HTTP: {counts.debug.httpStatus} {counts.debug.httpStatusText}
                </div>
                {counts.debug.rawResponseSnippet && (
                  <>
                    <div style={{ marginTop: 8, fontWeight: 700 }}>Response Snippet</div>
                    <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 12 }}>
                      {counts.debug.rawResponseSnippet}
                    </pre>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {counts?.ok && counts.countsByType && (
          <>
            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Badge label={`Total: ${totalCount}`} />
              {PLACE_TYPES.map((t) => (
                <Badge key={t.type} label={`${t.label}: ${counts.countsByType?.[t.type] ?? 0}`} />
              ))}
            </div>

            <div
              style={{
                marginTop: 14,
                padding: 12,
                borderRadius: 10,
                background: "rgba(220,20,60,0.05)",
                border: "1px solid rgba(220,20,60,0.15)",
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Danger Zone</div>

              <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={confirmGlobal}
                  onChange={(e) => setConfirmGlobal(e.target.checked)}
                />
                Ich möchte Löschoperationen aktivieren
              </label>

              <div style={{ marginTop: 12, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>Typ</th>
                      <th style={th}>Count</th>
                      <th style={th}>Checkbox</th>
                      <th style={th}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PLACE_TYPES.map(({ type, label }) => {
                      const count = counts.countsByType?.[type] ?? 0;
                      const checked = confirmByType[type];
                      const canDelete = confirmGlobal && checked && count > 0 && !deleteBusyByType[type];
                      return (
                        <tr key={type}>
                          <td style={td}>
                            <strong>{label}</strong>
                            <div style={{ opacity: 0.75, fontSize: 12 }}>{type}</div>
                          </td>
                          <td style={td}>{count}</td>
                          <td style={td}>
                            <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!confirmGlobal}
                                onChange={(e) =>
                                  setConfirmByType((p) => ({ ...p, [type]: e.target.checked }))
                                }
                              />
                              Delete All für diesen Typ aktivieren
                            </label>
                          </td>
                          <td style={td}>
                            <button
                              onClick={() => onDeleteAllByType(type)}
                              disabled={!canDelete}
                              style={{
                                padding: "10px 14px",
                                borderRadius: 10,
                                border: "1px solid rgba(0,0,0,0.2)",
                                cursor: canDelete ? "pointer" : "not-allowed",
                                fontWeight: 800,
                              }}
                            >
                              {deleteBusyByType[type] ? "Lösche…" : "Delete All"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {deleteResp && (
                <div style={{ marginTop: 12 }}>
                  {deleteResp.ok ? (
                    <div style={{ fontWeight: 800 }}>
                      Gelöscht: {deleteResp.deleted ?? 0} Datensätze ({deleteResp.type})
                    </div>
                  ) : (
                    <div style={{ color: "crimson", fontWeight: 800 }}>
                      Delete Fehler: {deleteResp.error}
                    </div>
                  )}

                  {deleteResp.debug && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: 12,
                        borderRadius: 10,
                        background: "rgba(0,0,0,0.04)",
                      }}
                    >
                      <div style={{ fontWeight: 800, marginBottom: 6 }}>Debug</div>
                      <div>
                        HTTP: {deleteResp.debug.httpStatus} {deleteResp.debug.httpStatusText}
                      </div>
                      {deleteResp.debug.rawResponseSnippet && (
                        <>
                          <div style={{ marginTop: 8, fontWeight: 700 }}>Response Snippet</div>
                          <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 12 }}>
                            {deleteResp.debug.rawResponseSnippet}
                          </pre>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginTop: 16,
          marginBottom: 16,
        }}
      >
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          onClick={onImport}
          disabled={!file || busy}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid rgba(0,0,0,0.2)",
            cursor: !file || busy ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
        >
          {busy ? "Import läuft…" : "Import starten"}
        </button>
      </div>

      <section
        style={{
          marginTop: 16,
          padding: 16,
          border: "1px solid rgba(0,0,0,0.15)",
          borderRadius: 12,
        }}
      >
        <h2 style={{ fontSize: 18, marginTop: 0, marginBottom: 12 }}>Hero images</h2>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontWeight: 700 }}>
            Limit
            <input type="number" min={1} value={heroLimit} onChange={(e) => setHeroLimit(Math.max(1, Number(e.target.value) || 1))} style={{ width: 100, padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.2)" }} />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontWeight: 700 }}>
            Cursor (optional)
            <input type="text" value={heroCursor} onChange={(e) => setHeroCursor(e.target.value)} style={{ width: 130, padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.2)" }} />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontWeight: 700 }}>
            Offset
            <input type="number" min={0} value={heroOffset} onChange={(e) => setHeroOffset(Math.max(0, Number(e.target.value) || 0))} style={{ width: 100, padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.2)" }} />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontWeight: 700 }}>
            Max candidates/place
            <input type="number" min={1} max={30} value={heroMaxCandidates} onChange={(e) => setHeroMaxCandidates(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} style={{ width: 150, padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.2)" }} />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontWeight: 700 }}>
            Provider
            <select value={heroProvider} onChange={(e) => setHeroProvider(e.target.value as "google" | "wikimedia" | "auto")} style={{ minWidth: 140, padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.2)" }}>
              <option value="auto">Auto (Google + Wikimedia)</option>
              <option value="google">Google</option>
              <option value="wikimedia">Wikimedia</option>
            </select>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontWeight: 700 }}>
            Radius (meters)
            <input type="number" min={50} max={5000} value={heroRadiusMeters} onChange={(e) => setHeroRadiusMeters(Math.max(50, Number(e.target.value) || 50))} style={{ width: 130, padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.2)" }} />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontWeight: 700 }}>
            Types filter (optional)
            <input type="text" value={heroTypesInput} onChange={(e) => setHeroTypesInput(e.target.value)} placeholder="CAMPINGPLATZ,HVO_TANKSTELLE" style={{ width: 260, padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.2)" }} />
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}><input type="checkbox" checked={heroForce} onChange={(e) => setHeroForce(e.target.checked)} />Force update existing URLs</label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}><input type="checkbox" checked={heroDryRun} onChange={(e) => setHeroDryRun(e.target.checked)} />Dry run (no DB write)</label>

          <button onClick={onHeroAutofill} disabled={heroBusy} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.2)", cursor: heroBusy ? "not-allowed" : "pointer", fontWeight: 700 }}>{heroBusy ? "Fetching…" : "Auto fetch hero images"}</button>
        </div>

        <div style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Request URL</div>
          <input
            type="text"
            readOnly
            value={heroRequestUrl}
            style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.2)", background: "rgba(0,0,0,0.03)", fontFamily: "monospace", fontSize: 12 }}
          />
        </div>

        {heroError && <div style={{ marginTop: 12, color: "crimson", fontWeight: 800 }}>Fehler: {heroError}</div>}

        {heroResp && (
          <>
            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Badge label={`Total: ${heroResp.totalPlaces}`} />
              <Badge label={`Processed: ${heroResp.processed}`} />
              <Badge label={`Updated: ${heroResp.updated}`} />
              <Badge label={`Skipped: ${heroResp.skipped}`} />
              <Badge label={`Failed: ${heroResp.failed}`} tone={heroResp.failed > 0 ? "bad" : "ok"} />
              <Badge label={`Next cursor: ${heroResp.nextCursor ?? "none"}`} />
              <button
                onClick={() => {
                  if (!heroResp?.nextCursor) return;
                  setHeroCursor(heroResp.nextCursor);
                  setHeroOffset(0);
                }}
                disabled={!heroResp?.nextCursor || heroBusy}
                style={{ padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(0,0,0,0.18)", background: "rgba(0,0,0,0.06)", fontWeight: 700, cursor: !heroResp?.nextCursor || heroBusy ? "not-allowed" : "pointer" }}
              >
                Run next page
              </button>
              <button onClick={() => navigator.clipboard.writeText(JSON.stringify(heroResp, null, 2))} style={{ padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(0,0,0,0.18)", background: "rgba(0,0,0,0.06)", fontWeight: 700, cursor: "pointer" }}>Copy JSON</button>
              <button onClick={() => {
                const blob = new Blob([JSON.stringify(heroResp, null, 2)], { type: "application/json" });
                const href = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = href;
                a.download = `hero-autofill-${Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(href);
              }} style={{ padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(0,0,0,0.18)", background: "rgba(0,0,0,0.06)", fontWeight: 700, cursor: "pointer" }}>Download JSON</button>
            </div>

            {heroResp.capApplied && (
              <div style={{ marginTop: 8, color: "#8a4b00", fontWeight: 700 }}>
                Hard cap applied: requested {heroResp.capApplied.requestedLimit}, using {heroResp.capApplied.appliedLimit} (HERO_AUTOFILL_HARD_CAP={heroResp.capApplied.hardCap})
              </div>
            )}
            <div style={{ marginTop: 12, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr><th style={th}>Place</th><th style={th}>Status</th><th style={th}>Action</th><th style={th}>Source</th><th style={th}>Score</th><th style={th}>Chosen URL</th><th style={th}>Reason</th></tr>
                </thead>
                <tbody>
                  {heroResp.results.map((r) => (
                    <tr key={`${r.placeId}-${r.action}-${r.chosenUrl ?? "none"}`}>
                      <td style={td}><div style={{ fontWeight: 700 }}>{r.placeName}</div><div style={{ opacity: 0.7, fontSize: 12 }}>ID: {r.placeId}</div></td>
                      <td style={td}>{r.status}</td>
                      <td style={td}><HeroStatusPill status={r.action} /></td>
                      <td style={td}>{r.source ?? "-"}</td>
                      <td style={td}>{typeof r.score === "number" ? r.score : "-"}</td>
                      <td style={td}>{r.chosenUrl ? <a href={r.chosenUrl} target="_blank" rel="noreferrer">{r.chosenUrl}</a> : "-"}</td>
                      <td style={td}><div>{r.reason ?? "-"}</div><div style={{ opacity: 0.75, fontSize: 12 }}>{r.heroReason ?? ""}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section
        style={{
          marginTop: 16,
          padding: 16,
          border: "1px solid rgba(0,0,0,0.15)",
          borderRadius: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ fontSize: 18, margin: 0 }}>Place Quality</h2>
            <p style={{ marginTop: 6, marginBottom: 0, opacity: 0.8 }}>
              Prueft den ausgewaehlten Ortstyp gegen Hero-Probleme ohne Placeholder-Fallback. Fuer Sehenswuerdigkeiten wird zusaetzlich die Beschreibung geprueft.
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                fontWeight: 700,
              }}
            >
              Ortstyp
              <select
                value={qualityType}
                onChange={(e) => setQualityType(e.target.value as PlaceType)}
                disabled={qualityBusy || repairBusy}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.2)",
                  minWidth: 180,
                }}
              >
                {PLACE_TYPES.map((placeType) => (
                  <option key={placeType.type} value={placeType.type}>
                    {placeType.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              onClick={loadSightseeingQuality}
              disabled={qualityBusy || repairBusy}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.2)",
                cursor: qualityBusy || repairBusy ? "not-allowed" : "pointer",
                fontWeight: 700,
              }}
            >
              {qualityBusy ? "Pruefe..." : "Qualitaet pruefen"}
            </button>

            <button
              onClick={runSightseeingRepair}
              disabled={repairBusy || qualityBusy}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.2)",
                cursor: repairBusy || qualityBusy ? "not-allowed" : "pointer",
                fontWeight: 700,
                background: "rgba(37,99,235,0.08)",
              }}
            >
              {repairBusy ? "Repariere..." : "Auto-Repair"}
            </button>

            {qualityResp && (
              <button
                onClick={() => navigator.clipboard.writeText(JSON.stringify(qualityResp, null, 2))}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.2)",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                JSON kopieren
              </button>
            )}
          </div>
        </div>

        {qualityError && (
          <div style={{ marginTop: 12, color: "crimson", fontWeight: 800 }}>
            Fehler: {qualityError}
          </div>
        )}

        {repairError && (
          <div style={{ marginTop: 12, color: "crimson", fontWeight: 800 }}>
            Repair-Fehler: {repairError}
          </div>
        )}

        {repairResp && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 10,
              background: repairResp.ok ? "rgba(34,197,94,0.08)" : "rgba(220,20,60,0.06)",
              border: repairResp.ok
                ? "1px solid rgba(34,197,94,0.2)"
                : "1px solid rgba(220,20,60,0.18)",
            }}
          >
            <div style={{ fontWeight: 800 }}>
              {repairResp.ok ? "Auto-Repair abgeschlossen" : "Auto-Repair fehlgeschlagen"}
            </div>
            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
              Dauer: {Math.round(repairResp.durationMs / 1000)}s | Exit-Code: {repairResp.exitCode ?? "-"}
            </div>
            {repairResp.stdoutTail && (
              <>
                <div style={{ marginTop: 10, fontWeight: 700 }}>stdout</div>
                <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 12 }}>
                  {repairResp.stdoutTail}
                </pre>
              </>
            )}
            {repairResp.stderrTail && (
              <>
                <div style={{ marginTop: 10, fontWeight: 700 }}>stderr</div>
                <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 12 }}>
                  {repairResp.stderrTail}
                </pre>
              </>
            )}
          </div>
        )}

        {qualityResp?.ok && (
          <>
            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Badge
                label={`Type: ${
                  PLACE_TYPES.find((item) => item.type === (qualityResp.placeType ?? qualityType))?.label ??
                  (qualityResp.placeType ?? qualityType)
                }`}
              />
              <Badge label={`Total: ${qualityResp.total ?? 0}`} />
              <Badge label={`Passed: ${qualityResp.passed ?? 0}`} tone={(qualityResp.failed ?? 0) > 0 ? undefined : "ok"} />
              <Badge label={`Failed: ${qualityResp.failed ?? 0}`} tone={(qualityResp.failed ?? 0) > 0 ? "bad" : "ok"} />
              <Badge label={`Missing description: ${qualityResp.counts?.missingDescription ?? 0}`} tone={(qualityResp.counts?.missingDescription ?? 0) > 0 ? "bad" : "ok"} />
              <Badge label={`Broken hero: ${qualityResp.counts?.brokenHero ?? 0}`} tone={(qualityResp.counts?.brokenHero ?? 0) > 0 ? "bad" : "ok"} />
            </div>

            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
              Checked at: {qualityResp.checkedAt ? new Date(qualityResp.checkedAt).toLocaleString("de-DE") : "-"}
            </div>

            {(qualityResp.failures?.length ?? 0) === 0 ? (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 10,
                  background: "rgba(34,197,94,0.08)",
                  border: "1px solid rgba(34,197,94,0.2)",
                  fontWeight: 700,
                }}
              >
                Alle Sehenswuerdigkeiten bestehen den Check.
              </div>
            ) : (
              <div style={{ marginTop: 12, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>Place</th>
                      <th style={th}>Beschreibung</th>
                      <th style={th}>Hero</th>
                      <th style={th}>Status</th>
                      <th style={th}>Quelle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qualityResp.failures?.map((failure) => (
                      <tr key={failure.id}>
                        <td style={td}>
                          <div style={{ fontWeight: 700 }}>{failure.name}</div>
                          <div style={{ opacity: 0.7, fontSize: 12 }}>ID: {failure.id} • {failure.type}</div>
                        </td>
                        <td style={td}>
                          <div>{failure.descriptionOk ? "OK" : "Zu kurz/fehlt"}</div>
                          <div style={{ opacity: 0.7, fontSize: 12 }}>Laenge: {failure.descriptionLength}</div>
                        </td>
                        <td style={td}>
                          <div>{failure.heroOk ? "OK" : "Fehlerhaft"}</div>
                          <div style={{ opacity: 0.7, fontSize: 12 }}>
                            Placeholder: {failure.heroUsedPlaceholder === "1" ? "ja" : "nein"}
                          </div>
                        </td>
                        <td style={td}>
                          <div>HTTP: {failure.heroStatus ?? "-"}</div>
                          <div style={{ opacity: 0.7, fontSize: 12 }}>
                            {failure.heroContentType ?? failure.heroLocation ?? "-"}
                          </div>
                        </td>
                        <td style={td}>
                          <div>thumbnailImageId: {failure.thumbnailImageId ?? "-"}</div>
                          <div style={{ opacity: 0.7, fontSize: 12, wordBreak: "break-all" }}>
                            {failure.heroImageUrl ?? "-"}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {resp && (
        <section
          style={{
            padding: 16,
            border: "1px solid rgba(0,0,0,0.15)",
            borderRadius: 12,
          }}
        >
          {!resp.ok && (
            <div style={{ color: "crimson", fontWeight: 700 }}>
              Fehler: {resp.error}
            </div>
          )}

          {resp.debug && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 10,
                background: "rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Debug</div>
              <div>
                HTTP: {resp.debug.httpStatus} {resp.debug.httpStatusText}
              </div>
              {resp.debug.rawResponseSnippet && (
                <>
                  <div style={{ marginTop: 8, fontWeight: 700 }}>
                    Response Snippet
                  </div>
                  <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 12 }}>
                    {resp.debug.rawResponseSnippet}
                  </pre>
                </>
              )}
            </div>
          )}

          {resp.ok && resp.summary && (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12 }}>
              <Badge label={`Created: ${resp.summary.created}`} />
              <Badge label={`Updated: ${resp.summary.updated}`} />
              <Badge label={`Skipped: ${resp.summary.skipped}`} />
              <Badge
                label={`Errors: ${resp.summary.error}`}
                tone={resp.summary.error > 0 ? "bad" : "ok"}
              />
            </div>
          )}

          {resp.results && resp.results.length > 0 && (
            <>
              <h2 style={{ fontSize: 18, marginTop: 16, marginBottom: 8 }}>
                Details
              </h2>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>Status</th>
                      <th style={th}>Place</th>
                      <th style={th}>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resp.results.map((r, idx) => (
                      <tr key={idx}>
                        <td style={td}>
                          <StatusPill status={r.status} />
                        </td>
                        <td style={td}>{r.placeName}</td>
                        <td style={td}>{"message" in r ? r.message : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {hasErrors && (
                <p style={{ marginTop: 12, color: "crimson" }}>
                  Mindestens eine Zeile konnte nicht importiert werden.
                </p>
              )}
            </>
          )}
        </section>
      )}

      <section style={{ marginTop: 18, opacity: 0.85 }}>
        <h3 style={{ marginBottom: 8 }}>Kurz-Check</h3>
        <ol style={{ marginTop: 0 }}>
          <li>API Route existiert: src/app/api/import/ina-csv/route.ts</li>
          <li>Dev-Server neu gestartet</li>
          <li>CSV ist UTF-8 und komma-separiert</li>
        </ol>
      </section>
    </main>
  );
}

function Badge({ label, tone }: { label: string; tone?: "ok" | "bad" }) {
  const bg = tone === "bad" ? "rgba(220,20,60,0.12)" : "rgba(0,0,0,0.06)";
  const bd = tone === "bad" ? "rgba(220,20,60,0.35)" : "rgba(0,0,0,0.18)";
  return (
    <span
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        border: `1px solid ${bd}`,
        background: bg,
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  );
}

function StatusPill({ status }: { status: "created" | "updated" | "skipped" | "error" }) {
  const map: Record<string, { bg: string; bd: string }> = {
    created: { bg: "rgba(34,197,94,0.12)", bd: "rgba(34,197,94,0.35)" },
    updated: { bg: "rgba(59,130,246,0.12)", bd: "rgba(59,130,246,0.35)" },
    skipped: { bg: "rgba(0,0,0,0.06)", bd: "rgba(0,0,0,0.18)" },
    error: { bg: "rgba(220,20,60,0.12)", bd: "rgba(220,20,60,0.35)" },
  };
  const s = map[status];
  return (
    <span
      style={{
        padding: "4px 10px",
        borderRadius: 999,
        border: `1px solid ${s.bd}`,
        background: s.bg,
        fontWeight: 700,
      }}
    >
      {status}
    </span>
  );
}

function HeroStatusPill({ status }: { status: HeroAutofillAction }) {
  const map: Record<HeroAutofillAction, { bg: string; bd: string }> = {
    created: { bg: "rgba(34,197,94,0.12)", bd: "rgba(34,197,94,0.35)" },
    updated: { bg: "rgba(59,130,246,0.12)", bd: "rgba(59,130,246,0.35)" },
    skipped: { bg: "rgba(0,0,0,0.06)", bd: "rgba(0,0,0,0.18)" },
    error: { bg: "rgba(220,20,60,0.12)", bd: "rgba(220,20,60,0.35)" },
    "would-create": { bg: "rgba(16,185,129,0.14)", bd: "rgba(16,185,129,0.4)" },
    "would-update": { bg: "rgba(37,99,235,0.14)", bd: "rgba(37,99,235,0.4)" },
  };
  const s = map[status];

  return (
    <span
      style={{
        padding: "4px 10px",
        borderRadius: 999,
        border: `1px solid ${s.bd}`,
        background: s.bg,
        fontWeight: 700,
      }}
    >
      {status}
    </span>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: 10,
  borderBottom: "1px solid rgba(0,0,0,0.12)",
  fontSize: 12,
  opacity: 0.85,
};

const td: React.CSSProperties = {
  padding: 10,
  borderBottom: "1px solid rgba(0,0,0,0.08)",
  verticalAlign: "top",
};
