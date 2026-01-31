// src/app/map/_lib/image-url.ts
import { createClient } from "@supabase/supabase-js";

const SUPABASE_BUCKET = "place-images";

export function getSupabasePublicUrl(path: string): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon || !path) return "";

  const supabase = createClient(url, anon);
  const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(path);
  return data?.publicUrl ?? "";
}
