/**
 * SDG-Logo (SIMBA · DICKIE · GROUP) als scharfe Inline-SVG.
 *
 * Als SVG nachgebaut statt Bilddatei: gestochen scharf in jeder Größe,
 * winzige Dateigröße, kein zusätzlicher Netzwerk-Abruf. Höhe per CSS-Klasse
 * setzen (z. B. `h-6`), die Breite ergibt sich automatisch aus dem Seiten-
 * verhältnis.
 */
export function SdgLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 620 100"
      role="img"
      aria-label="SIMBA DICKIE GROUP"
      className={className}
    >
      <rect width="620" height="100" rx="2" fill="#E30613" />
      <text
        x="310"
        y="50"
        fill="#FFFFFF"
        fontFamily="'Arial Black', Arial, Helvetica, sans-serif"
        fontWeight={900}
        fontSize={52}
        letterSpacing={2}
        textAnchor="middle"
        dominantBaseline="central"
        textLength={560}
        lengthAdjust="spacingAndGlyphs"
      >
        SIMBA · DICKIE · GROUP
      </text>
    </svg>
  );
}
