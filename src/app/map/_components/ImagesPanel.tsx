// src/app/map/_components/ImagesPanel.tsx
"use client";

import { getSupabasePublicUrl } from "../_lib/image-url";

export default function ImagesPanel(props: {
  placeId: number | null;

  images: any[];
  thumbnailImageId: number | null;

  uploading: boolean;
  saving: boolean;

  uploadMsg: string;
  onPickFiles: (files: File[]) => void;
  pickedFilesCount: number;

  onUpload: () => void;
  onOpenLightboxById: (imageId: number) => void;
  onSetThumbnail: (imageId: number) => void;
  onDeleteImage: (imageId: number) => void;
}) {
  return (
    <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Bilder</div>
        <div className="text-xs opacity-70">{Array.isArray(props.images) ? props.images.length : 0} Stück</div>
      </div>

      {props.uploadMsg ? (
        <div className="mb-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs">{props.uploadMsg}</div>
      ) : null}

      <input
        type="file"
        multiple
        className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
        onChange={(e) => props.onPickFiles(Array.from(e.target.files ?? []))}
        disabled={props.uploading || props.saving}
      />

      <button
        onClick={props.onUpload}
        className="mt-2 w-full rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm hover:bg-white/15 disabled:opacity-60"
        disabled={props.uploading || props.saving || props.pickedFilesCount === 0}
      >
        {props.uploading ? "Lädt hoch..." : "Bilder hochladen"}
      </button>

      {props.placeId ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(Array.isArray(props.images) ? props.images : []).map((img: any) => {
            const isThumb = Number(props.thumbnailImageId) === Number(img.id);
            const src = getSupabasePublicUrl(String(img.filename ?? ""));

            return (
              <div key={img.id} className="rounded-xl border border-white/10 bg-black/30 p-1">
                <button type="button" onClick={() => props.onOpenLightboxById(Number(img.id))} className="w-full" title="Bild öffnen">
                  {src ? (
                    <img
                      src={src}
                      alt=""
                      className={`h-20 w-full rounded-lg object-cover ${isThumb ? "ring-2 ring-white/60" : ""}`}
                      loading="lazy"
                    />
                  ) : (
                    <div className={`h-20 w-full rounded-lg bg-black/30 ${isThumb ? "ring-2 ring-white/60" : ""}`} />
                  )}
                </button>

                <button
                  onClick={() => props.onSetThumbnail(Number(img.id))}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-[11px] hover:bg-white/15 disabled:opacity-60"
                  disabled={props.uploading || props.saving}
                >
                  {isThumb ? "Thumbnail" : "Als Thumbnail"}
                </button>

                <button
                  onClick={() => props.onDeleteImage(Number(img.id))}
                  className="mt-1 w-full rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] hover:bg-red-500/20 disabled:opacity-60"
                  disabled={props.uploading || props.saving}
                >
                  Löschen
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-2 text-xs opacity-70">Ort erst speichern, dann Bilder hochladen.</div>
      )}
    </div>
  );
}
