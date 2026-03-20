type AggregatePlaceType = "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";

export type AggregateInputPlace = {
  id: number;
  type: AggregatePlaceType;
  lat: number;
  lng: number;
};

export type MapAggregate = {
  key: string;
  lat: number;
  lng: number;
  count: number;
  dominantType: AggregatePlaceType;
  counts: Record<AggregatePlaceType, number>;
};

export type MapAggregateParams = {
  zoom: number;
  cellPx?: number;
};

export type MapAggregateBounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

const WORLD_TILE_SIZE = 256;

function clampLat(lat: number) {
  return Math.max(-85.05112878, Math.min(85.05112878, lat));
}

function worldPixel(lat: number, lng: number, zoom: number) {
  const scale = WORLD_TILE_SIZE * 2 ** zoom;
  const x = ((lng + 180) / 360) * scale;
  const sinLat = Math.sin((clampLat(lat) * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function lngFromWorldX(x: number, zoom: number) {
  const scale = WORLD_TILE_SIZE * 2 ** zoom;
  return (x / scale) * 360 - 180;
}

function latFromWorldY(y: number, zoom: number) {
  const scale = WORLD_TILE_SIZE * 2 ** zoom;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function normalizeAggregateBounds(bounds: MapAggregateBounds, params: MapAggregateParams): MapAggregateBounds {
  const zoom = Math.max(0, Math.min(22, Math.round(params.zoom)));
  const cellPx = Math.max(8, Math.min(96, Math.round(params.cellPx ?? 56)));
  const overscanCells = 1;

  const south = Math.min(bounds.minLat, bounds.maxLat);
  const north = Math.max(bounds.minLat, bounds.maxLat);
  const west = Math.min(bounds.minLng, bounds.maxLng);
  const east = Math.max(bounds.minLng, bounds.maxLng);

  const topLeft = worldPixel(north, west, zoom);
  const bottomRight = worldPixel(south, east, zoom);

  const minCellX = Math.floor(topLeft.x / cellPx) - overscanCells;
  const maxCellX = Math.ceil(bottomRight.x / cellPx) + overscanCells;
  const minCellY = Math.floor(topLeft.y / cellPx) - overscanCells;
  const maxCellY = Math.ceil(bottomRight.y / cellPx) + overscanCells;

  const normalizedMinLng = lngFromWorldX(minCellX * cellPx, zoom);
  const normalizedMaxLng = lngFromWorldX(maxCellX * cellPx, zoom);
  const normalizedMaxLat = latFromWorldY(minCellY * cellPx, zoom);
  const normalizedMinLat = latFromWorldY(maxCellY * cellPx, zoom);

  return {
    minLat: Math.max(-85.05112878, normalizedMinLat),
    maxLat: Math.min(85.05112878, normalizedMaxLat),
    minLng: Math.max(-180, normalizedMinLng),
    maxLng: Math.min(180, normalizedMaxLng),
  };
}

export function aggregatePlacesByZoom(places: AggregateInputPlace[], params: MapAggregateParams): MapAggregate[] {
  const zoom = Math.max(0, Math.min(22, Math.round(params.zoom)));
  const cellPx = Math.max(8, Math.min(96, Math.round(params.cellPx ?? 56)));
  const buckets = new Map<
    string,
    {
      sumLat: number;
      sumLng: number;
      count: number;
      counts: Record<AggregatePlaceType, number>;
    }
  >();

  for (const place of places) {
    const pt = worldPixel(place.lat, place.lng, zoom);
    const gx = Math.floor(pt.x / cellPx);
    const gy = Math.floor(pt.y / cellPx);
    const key = `${zoom}:${gx}:${gy}`;
    const bucket =
      buckets.get(key) ??
      {
        sumLat: 0,
        sumLng: 0,
        count: 0,
        counts: {
          STELLPLATZ: 0,
          CAMPINGPLATZ: 0,
          SEHENSWUERDIGKEIT: 0,
          HVO_TANKSTELLE: 0,
        },
      };

    bucket.sumLat += place.lat;
    bucket.sumLng += place.lng;
    bucket.count += 1;
    bucket.counts[place.type] += 1;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.entries()).map(([key, bucket]) => {
    const dominantType = (Object.entries(bucket.counts).sort((a, b) => b[1] - a[1])[0]?.[0] ??
      "CAMPINGPLATZ") as AggregatePlaceType;

    return {
      key,
      lat: bucket.sumLat / bucket.count,
      lng: bucket.sumLng / bucket.count,
      count: bucket.count,
      dominantType,
      counts: bucket.counts,
    };
  });
}
