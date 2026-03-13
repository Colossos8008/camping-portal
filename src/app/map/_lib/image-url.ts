// src/app/map/_lib/image-url.ts
import { createClient } from "@supabase/supabase-js";
import { buildPlaceHeroProxyPath, isGooglePhotoReference, isGooglePlacesPhotoUrl } from "@/lib/hero-image";

const SUPABASE_BUCKET = "place-images";

function buildRemoteImageProxyPath(url: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

function normalizeUnsafeRemoteImageUrl(path: string, placeId?: number | null): string {
  const cleanPath = String(path ?? "").trim();
  if (!cleanPath) return "";

  if (isGooglePhotoReference(cleanPath)) {
    const proxyPath = buildPlaceHeroProxyPath(placeId);
    return proxyPath ?? "";
  }

  if (isGooglePlacesPhotoUrl(cleanPath)) {
    return buildRemoteImageProxyPath(cleanPath);
  }

  if (cleanPath.startsWith("http://") || cleanPath.startsWith("https://")) {
    return buildRemoteImageProxyPath(cleanPath);
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
