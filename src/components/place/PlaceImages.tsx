"use client"

import { useState } from "react"

type Image = {
  id: number
  filename: string
}

type Props = {
  placeId: number
  images: Image[]
  onRefresh: () => void
}

export default function PlaceImages({
  placeId,
  images,
  onRefresh,
}: Props) {
  const [loading, setLoading] = useState(false)

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return

    const formData = new FormData()
    Array.from(files).forEach((file) =>
      formData.append("images", file)
    )

    setLoading(true)
    await fetch(`/api/places/${placeId}/images`, {
      method: "POST",
      body: formData,
    })
    setLoading(false)
    onRefresh()
  }

  async function remove(imageId: number) {
    await fetch(`/api/places/${placeId}/images`, {
      method: "DELETE",
      body: JSON.stringify({ imageId }),
    })
    onRefresh()
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm opacity-70">
        Bilder
      </label>

      <input
        type="file"
        multiple
        className="text-sm"
        onChange={(e) => upload(e.target.files)}
      />

      <div className="grid grid-cols-3 gap-2">
        {images.map((img) => (
          <div
            key={img.id}
            className="relative rounded overflow-hidden border border-neutral-700"
          >
            <img
              src={`/uploads/${img.filename}`}
              className="object-cover w-full h-24"
            />

            <button
              onClick={() => remove(img.id)}
              className="absolute top-1 right-1 text-xs bg-black/70 text-white px-2 py-1 rounded opacity-0 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {loading && (
        <div className="text-xs opacity-60">
          Upload läuft…
        </div>
      )}
    </div>
  )
}
