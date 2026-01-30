"use client";

import { useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type Image = {
  id: number;
  filename: string; // storage object key
};

type Props = {
  placeId: number;
  images: Image[];
  onRefresh: () => void;
};

const BUCKET = "place-images";

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

export default function PlaceImages({ placeId, images, onRefresh }: Props) {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    // Kein stilles Raten: wenn das fehlt, soll es sofort sichtbar crashen
    if (!url) throw new Error("Missing env NEXT_PUBLIC_SUPABASE_URL");
    if (!anon) throw new Error("Missing env NEXT_PUBLIC_SUPABASE_ANON_KEY");

    return createClient(url, anon);
  }, []);

  function publicUrlForObjectKey(objectKey: string) {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!base) return "";
    return `${base}/storage/v1/object/public/${BUCKET}/${objectKey}`;
  }

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;

    setErrorMsg(null);
    setLoading(true);

    try {
      const objectKeys: string[] = [];

      for (const file of Array.from(files)) {
        const objectKey = makeObjectKey(placeId, file.name);

        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(objectKey, file, {
            contentType: file.type || "application/octet-stream",
            upsert: false,
          });

        if (error) {
          throw new Error(`Supabase upload failed: ${error.message}`);
        }

        objectKeys.push(objectKey);
      }

      // Jetzt nur noch Metadaten registrieren (JSON, klein)
      const res = await fetch(`/api/places/${placeId}/images`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          images: objectKeys.map((filename) => ({ filename })),
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`API register failed: ${res.status} ${txt}`);
      }

      onRefresh();
    } catch (e: any) {
      setErrorMsg(e?.message || "Upload fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  async function remove(imageId: number) {
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/places/${placeId}/images?imageId=${imageId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Delete failed: ${res.status} ${txt}`);
      }

      onRefresh();
    } catch (e: any) {
      setErrorMsg(e?.message || "Loeschen fehlgeschlagen");
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm opacity-70">Bilder</label>

      <input
        type="file"
        multiple
        className="text-sm"
        onChange={(e) => upload(e.target.files)}
        disabled={loading}
      />

      {errorMsg && (
        <div className="text-xs text-red-400 whitespace-pre-wrap">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {images.map((img) => (
          <div
            key={img.id}
            className="relative rounded overflow-hidden border border-neutral-700"
          >
            <img
              src={publicUrlForObjectKey(img.filename)}
              className="object-cover w-full h-24"
            />

            <button
              onClick={() => remove(img.id)}
              className="absolute top-1 right-1 text-xs bg-black/70 text-white px-2 py-1 rounded opacity-0 hover:opacity-100"
              type="button"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {loading && <div className="text-xs opacity-60">Upload läuft…</div>}
    </div>
  );
}
