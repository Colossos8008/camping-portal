// src/app/map/_components/FeatureIcons.tsx
"use client";

import type { Place } from "../_lib/types";

export default function FeatureIcons(p: Place) {
  return (
    <div className="mt-1 flex items-center gap-2 text-[12px] opacity-80">
      {p.dogAllowed ? <span title="Hunde">🐕</span> : <span className="opacity-20" title="Hunde">🐕</span>}
      {p.sanitary ? <span title="Sanitär">🚿</span> : <span className="opacity-20" title="Sanitär">🚿</span>}
      {p.yearRound ? <span title="Ganzjährig">📆</span> : <span className="opacity-20" title="Ganzjährig">📆</span>}
      {p.onlineBooking ? <span title="Online">🌐</span> : <span className="opacity-20" title="Online">🌐</span>}
      {p.gastronomy ? <span title="Gastro">🍽️</span> : <span className="opacity-20" title="Gastro">🍽️</span>}
    </div>
  );
}
