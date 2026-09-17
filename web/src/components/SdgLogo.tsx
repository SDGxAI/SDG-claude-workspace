/**
 * SDG-Logo (SIMBA · DICKIE · GROUP) – die Original-Bilddatei.
 *
 * Liegt als `public/sdg-logo.png` und wird per Höhe skaliert (z. B. `h-6`);
 * die Breite ergibt sich automatisch aus dem Seitenverhältnis. Als einfaches
 * <img> eingebunden (kein next/image nötig für ein kleines statisches Logo).
 */
export function SdgLogo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/sdg-logo.png"
      alt="SIMBA DICKIE GROUP"
      width={1423}
      height={148}
      className={className}
    />
  );
}
