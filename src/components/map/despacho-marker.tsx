"use client";

import L from "leaflet";
import type { ReactNode } from "react";
import { Marker, Popup } from "react-leaflet";
import type { Tone } from "@/lib/constants";

const TONE_HEX: Record<Tone, string> = {
  success: "#2e9e5b",
  warning: "#f5a623",
  destructive: "#d92b2b",
  info: "#1f8fd6",
  neutral: "#8a7a68",
  primary: "#e8492c",
};

function buildDotIcon(tone: Tone) {
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:14px;height:14px;border-radius:9999px;background:${TONE_HEX[tone]};border:2px solid #ffffff;box-shadow:0 0 0 1px rgba(0,0,0,0.15)"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -8],
  });
}

export function DespachoMarker({
  position,
  tone,
  children,
}: {
  position: [number, number];
  tone: Tone;
  children?: ReactNode;
}) {
  return (
    <Marker position={position} icon={buildDotIcon(tone)}>
      {children && <Popup>{children}</Popup>}
    </Marker>
  );
}
