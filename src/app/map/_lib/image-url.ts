// src/app/map/_lib/image-url.ts
import { createClient } from "@supabase/supabase-js";
import { buildPlaceHeroProxyPath, isGooglePhotoReference, isGooglePlacesPhotoUrl } from "@/lib/hero-image";

const SUPABASE_BUCKET = "place-images";

function normalizeUnsafeRemoteImageUrl(path: string, placeId?: number | null): string {
  const cleanPath = String(path ?? "").trim();
  if (!cleanPath) return "";

  if (isGooglePhotoReference(cleanPath) || isGooglePlacesPhotoUrl(cleanPath)) {
    const proxyPath = buildPlaceHeroProxyPath(placeId);
    return proxyPath ?? "";
  }

  return cleanPath;
}

export function getSupabasePublicUrl(path: string, options?: { placeId?: number | null }): string {
  const normalizedPath = normalizeUnsafeRemoteImageUrl(path, options?.placeId);
  if (!normalizedPath) return "";
  if (normalizedPath.startsWith("/")) return normalizedPath;
  if (normalizedPath.startsWith("http://") || normalizedPath.startsWith("https://")) return normalizedPath;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) return "";

  const supabase = createClient(url, anon);
  const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(normalizedPath);
  return data?.publicUrl ?? "";
}
