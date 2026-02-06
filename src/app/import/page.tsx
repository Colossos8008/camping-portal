"use client";

import React, { useMemo, useState } from "react";

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

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState<ImportResponse | null>(null);

  const hasErrors = useMemo(
    () => (resp?.results ?? []).some((r) => r.status === "error"),
    [resp]
  );

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

  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
        Import – Ina CSV
      </h1>

      <p style={{ marginTop: 0, opacity: 0.85 }}>
        CSV Upload für den MVP-Import.<br />
        Kommentarzeilen mit <code>#</code> werden ignoriert.<br />
        <strong>Geo-Priorität:</strong> lat+lng (falls vorhanden) → plusCode →
        googleMapsUrl (Redirect wird aufgelöst).<br />
        <strong>Typ:</strong> placeTypeHint (falls vorhanden) → sonst Heuristik
        aus placeName.
      </p>

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
                HTTP: {resp.debug.httpStatus}{" "}
                {resp.debug.httpStatusText}
              </div>
              {resp.debug.rawResponseSnippet && (
                <>
                  <div style={{ marginTop: 8, fontWeight: 700 }}>
                    Response Snippet
                  </div>
                  <pre
                    style={{
                      whiteSpace: "pre-wrap",
                      margin: 0,
                      fontSize: 12,
                    }}
                  >
                    {resp.debug.rawResponseSnippet}
                  </pre>
                </>
              )}
            </div>
          )}

          {resp.ok && resp.summary && (
            <div
              style={{
                display: "flex",
                gap: 16,
                flexWrap: "wrap",
                marginTop: 12,
              }}
            >
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
              <h2
                style={{
                  fontSize: 18,
                  marginTop: 16,
                  marginBottom: 8,
                }}
              >
                Details
              </h2>

              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                  }}
                >
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
                        <td style={td}>
                          {"message" in r ? r.message : ""}
                        </td>
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

function Badge({
  label,
  tone,
}: {
  label: string;
  tone?: "ok" | "bad";
}) {
  const bg =
    tone === "bad"
      ? "rgba(220,20,60,0.12)"
      : "rgba(0,0,0,0.06)";
  const bd =
    tone === "bad"
      ? "rgba(220,20,60,0.35)"
      : "rgba(0,0,0,0.18)";
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

function StatusPill({
  status,
}: {
  status: "created" | "updated" | "skipped" | "error";
}) {
  const map: Record<string, { bg: string; bd: string }> = {
    created: {
      bg: "rgba(34,197,94,0.12)",
      bd: "rgba(34,197,94,0.35)",
    },
    updated: {
      bg: "rgba(59,130,246,0.12)",
      bd: "rgba(59,130,246,0.35)",
    },
    skipped: {
      bg: "rgba(0,0,0,0.06)",
      bd: "rgba(0,0,0,0.18)",
    },
    error: {
      bg: "rgba(220,20,60,0.12)",
      bd: "rgba(220,20,60,0.35)",
    },
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
