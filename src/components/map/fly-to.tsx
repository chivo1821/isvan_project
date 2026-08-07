"use client";

import { useEffect } from "react";
import { useMap } from "react-leaflet";

export function FlyTo({ target, zoom }: { target: [number, number] | null; zoom?: number }) {
  const map = useMap();

  useEffect(() => {
    if (target) map.flyTo(target, zoom ?? map.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.[0], target?.[1], zoom]);

  return null;
}
