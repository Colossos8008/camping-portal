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
  counts: { created: number; updated: number; skipped: number; errors: number };
  results: Array<{
    placeId: string;
    placeName: string;
    action: HeroAutofillAction;
    chosenUrl?: string;
    source?: "wikimedia";
    reason?: string;
  }>;
  error?: string;
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

  const [heroLimit, setHeroLimit] = useState(50);
  const [heroForce, setHeroForce] = useState(false);
  const [heroDryRun, setHeroDryRun] = useState(true);
  const [heroBusy, setHeroBusy] = useState(false);
  const [heroResp, setHeroResp] = useState<HeroAutofillResponse | null>(null);
  const [heroError, setHeroError] = useState<string | null>(null);

  const hasErrors = useMemo(
    () => (resp?.results ?? []).some((r) => r.status === "error"),
    [resp]
  );

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
      const res = await fetch("/api/admin/hero-autofill", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          limit: heroLimit,
          force: heroForce,
          dryRun: heroDryRun,
        }),
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
            <input
              type="number"
              min={1}
              max={200}
              value={heroLimit}
              onChange={(e) => setHeroLimit(Math.max(1, Number(e.target.value) || 1))}
              style={{
                width: 100,
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.2)",
              }}
            />
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
            <input
              type="checkbox"
              checked={heroForce}
              onChange={(e) => setHeroForce(e.target.checked)}
            />
            Force update existing URLs
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
            <input
              type="checkbox"
              checked={heroDryRun}
              onChange={(e) => setHeroDryRun(e.target.checked)}
            />
            Dry run (no DB write)
          </label>

          <button
            onClick={onHeroAutofill}
            disabled={heroBusy}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.2)",
              cursor: heroBusy ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
          >
            {heroBusy ? "Fetching…" : "Auto fetch hero images"}
          </button>
        </div>

        {heroError && (
          <div style={{ marginTop: 12, color: "crimson", fontWeight: 800 }}>Fehler: {heroError}</div>
        )}

        {heroResp && (
          <>
            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Badge label={`Created: ${heroResp.counts.created}`} />
              <Badge label={`Updated: ${heroResp.counts.updated}`} />
              <Badge label={`Skipped: ${heroResp.counts.skipped}`} />
              <Badge
                label={`Errors: ${heroResp.counts.errors}`}
                tone={heroResp.counts.errors > 0 ? "bad" : "ok"}
              />
            </div>

            <div style={{ marginTop: 12, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Place</th>
                    <th style={th}>Action</th>
                    <th style={th}>Chosen URL</th>
                    <th style={th}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {heroResp.results.map((r) => (
                    <tr key={`${r.placeId}-${r.action}-${r.chosenUrl ?? "none"}`}>
                      <td style={td}>
                        <div style={{ fontWeight: 700 }}>{r.placeName}</div>
                        <div style={{ opacity: 0.7, fontSize: 12 }}>ID: {r.placeId}</div>
                      </td>
                      <td style={td}>
                        <HeroStatusPill status={r.action} />
                      </td>
                      <td style={td}>
                        {r.chosenUrl ? (
                          <a href={r.chosenUrl} target="_blank" rel="noreferrer">
                            {r.chosenUrl}
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td style={td}>{r.reason ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
