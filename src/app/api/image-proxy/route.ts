import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function isHttpUrl(input: string): boolean {
  try {
    const parsed = new URL(String(input ?? "").trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function cacheControl(maxAgeSeconds: number): string {
  return `public, max-age=${Math.max(60, maxAgeSeconds)}, s-maxage=${Math.max(300, maxAgeSeconds)}, stale-while-revalidate=86400`;
}

export async function GET(req: NextRequest) {
  const target = String(req.nextUrl.searchParams.get("url") ?? "").trim();
  if (!isHttpUrl(target)) {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  try {
    const parsed = new URL(target);
    const upstream = await fetch(target, {
      method: "GET",
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; camping-portal/image-proxy; +https://camping-portal.vercel.app)",
        Referer: `${parsed.protocol}//${parsed.host}/`,
        Origin: `${parsed.protocol}//${parsed.host}`,
      },
      cache: "no-store",
      redirect: "follow",
    });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: `Upstream returned ${upstream.status}` }, { status: 502 });
    }

    const contentType = upstream.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "Upstream is not an image" }, { status: 415 });
    }

    const arrayBuffer = await upstream.arrayBuffer();
    const body = Buffer.from(arrayBuffer);
    if (!body.length) {
      return NextResponse.json({ error: "Upstream image was empty" }, { status: 502 });
    }

    const headers = new Headers();
    headers.set("Content-Type", contentType.split(";")[0]?.trim() || "image/jpeg");
    headers.set("Cache-Control", cacheControl(3600 * 24 * 7));
    headers.set("Content-Length", String(body.length));

    return new Response(body, { status: 200, headers });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Image proxy fetch failed" }, { status: 502 });
  }
}
