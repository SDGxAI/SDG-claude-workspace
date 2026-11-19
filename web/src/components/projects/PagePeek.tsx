"use client";

import { useEffect, useRef, useState } from "react";

const WIDTH = 1280;
const HEIGHT = 800;

/**
 * Verkleinerte Live-Ansicht des oberen Teils einer Seite (für Kacheln).
 * Lädt erst, wenn die Kachel in Sichtweite kommt.
 */
export function PagePeek({ src, fallback }: { src: string; fallback: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / WIDTH));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={box} className={`relative aspect-[16/10] overflow-hidden bg-gradient-to-br ${fallback}`}>
      <iframe
        src={src}
        title=""
        tabIndex={-1}
        aria-hidden
        loading="lazy"
        sandbox=""
        scrolling="no"
        onLoad={() => setReady(true)}
        className={`pointer-events-none absolute left-0 top-0 origin-top-left border-0 bg-white transition-opacity duration-500 ${
          ready ? "opacity-100" : "opacity-0"
        }`}
        style={{ width: WIDTH, height: HEIGHT, transform: `scale(${scale})` }}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/10 to-transparent" />
    </div>
  );
}
