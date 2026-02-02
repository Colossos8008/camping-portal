// src/app/map/map-leaflet.tsx
"use client";

import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect } from "react";

type Place = {
  id: number;
  name: string;
  lat: number;
  lng: number;
};

function Focus({ place }: { place: Place | null }) {
  const map = useMap();

  useEffect(() => {
    if (place) {
      map.setView([place.lat, place.lng], 10);
    }
  }, [place, map]);

  return null;
}

export default function MapLeaflet({
  places,
  selectedPlace,
  onSelectPlace,
}: {
  places: Place[];
  selectedPlace: Place | null;
  onSelectPlace: (id: number) => void;
}) {
  return (
    <MapContainer center={[50.3, 7.6]} zoom={7} className="h-full w-full rounded-xl">
      <TileLayer attribution="© OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

      <Focus place={selectedPlace} />

      {places.map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lng]}
          eventHandlers={{
            click: () => onSelectPlace(p.id),
          }}
          icon={L.icon({
            iconUrl: "/icons/stellplatz.png",
            iconSize: [32, 32],
            iconAnchor: [16, 32],
          })}
        >
          <Popup>{p.name}</Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
