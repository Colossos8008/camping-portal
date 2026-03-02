// src/app/map/_lib/image-url.ts
import { createClient } from "@supabase/supabase-js";

const SUPABASE_BUCKET = "place-images";

export function getSupabasePublicUrl(path: string): string {
  const cleanPath = String(path ?? "").trim();
  if (!cleanPath) return "";
  if (cleanPath.startsWith("http://") || cleanPath.startsWith("https://")) return cleanPath;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) return "";

  const supabase = createClient(url, anon);
  const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(cleanPath);
  return data?.publicUrl ?? "";
}
