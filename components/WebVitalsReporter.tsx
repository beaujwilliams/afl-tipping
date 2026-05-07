"use client";

import { useReportWebVitals } from "next/web-vitals";

const MOBILE_MAX_WIDTH = 860;
const MOBILE_SAMPLE_RATE = 0.35;

function isLikelyMobileDevice() {
  if (typeof window === "undefined") return false;

  const byViewport =
    typeof window.matchMedia === "function" &&
    window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches;
  if (byViewport) return true;

  const ua = String(window.navigator.userAgent ?? "");
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}

type VitalsMetric = {
  id: string;
  name: string;
  value: number;
  delta: number;
  rating: string;
  navigationType?: string;
};

function sendVitals(metric: VitalsMetric) {
  const payload = JSON.stringify({
    id: metric.id,
    name: metric.name,
    value: metric.value,
    delta: metric.delta,
    rating: metric.rating,
    navigationType: metric.navigationType ?? null,
    path: typeof window !== "undefined" ? window.location.pathname : null,
    ts: Date.now(),
    ua: typeof window !== "undefined" ? window.navigator.userAgent : null,
    viewport:
      typeof window !== "undefined"
        ? { width: window.innerWidth, height: window.innerHeight }
        : null,
  });

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([payload], { type: "application/json" });
    navigator.sendBeacon("/api/vitals", blob);
    return;
  }

  void fetch("/api/vitals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
    keepalive: true,
  });
}

export default function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    if (process.env.NODE_ENV !== "production") return;
    if (!isLikelyMobileDevice()) return;
    if (Math.random() > MOBILE_SAMPLE_RATE) return;
    sendVitals(metric);
  });

  return null;
}
