# schipper_bloom_spirit_early – Stand und offene Punkte

Übertragung der bestehenden Self-contained-Landingpage („Bloom Spirit Early
Access", `Bloom Spirit.html` im Repo-Root) in die MiniCMS-Struktur. Inhalt und
Design sind übernommen, die technische Struktur ist nach `AGENTS.md` neu gebaut.

## Gegen AGENTS.md umgesetzt

* Ordnername `<brand>_<purpose>`, `config.json` `store: schipper`,
  `matomo_id: -1`, `facebook_id: 0`
* `meta.json.twig` mit `title`/`seo_keywords`/`description`/`banner_*`/`logo_img_alt`,
  rendert valides JSON (geprüft)
* `content.js` ist ein ES-Modul, liest `top_el_ref` / `top_el_ref_shadow_inner_dst` /
  `data_src_ref`, pollt auf den ShadowRoot, greift ausschließlich über `root` auf
  das DOM zu, registriert nichts global; Strings kommen aus `data.translations`
* Klassen mit Projekt-Präfix `schipper_bloom_spirit__`, Custom Properties auf
  `:root, :host`, `--scheme-primary` unangetastet, `container-type` kommt vom
  `.minicms_container`
* Layout nur über `@container`; `@media` nur für `prefers-reduced-motion`
* `de`/`en`/`fr` mit identischem Key-Set inkl. SEO-Keys
* Medien über `media.get_asset_link('public/…')`, keine `/publish/…`-Pfade
* Keine Fonts, kein `@font-face`, kein Third-Party-JS/CSS, kein Tracking
* Header und Footer nur unter `{% if standalone.is_standalone() %}`
* `favicon.png` und `uclogo.png` liegen im Projektroot
* Mehrfach-Einbettung geprüft (zwei Instanzen, unabhängige Countdowns/Formulare)

## Offen – bevor das live geht

1. **Newsletter über `@shared/newsletter.twig`.** Das aktuelle Formular ist ein
   Platzhalter mit reiner Frontend-Validierung, es überträgt **keine Daten** und
   bindet kein Captcha ein. Laut AGENTS.md ist für Newsletter-Anmeldungen die
   Shared-Komponente zu verwenden. Dafür brauche ich `shared/components/newsletter.twig`
   (oder `projects/example/`), um die Parameter korrekt zu setzen.
2. **Kampagnendaten.** `early_access_start` / `launch_date` oben in `content.twig`
   stehen auf 13./14.08. und liegen in der Vergangenheit – der Countdown steht
   auf null. Zeitzone ist explizit `Europe/Berlin`.
3. **Video** für „Ein Blick hinter die Kulissen" fehlt (Platzhalter im Markup),
   später lokal über `media.get_asset_link('public/…mp4')`.
4. **Datenschutz-Link** im Consent-Text setzen, sobald das Ziel feststeht.
5. **`favicon.png` / `uclogo.png`** sind aus dem Logo generierte Platzhalter –
   finale Dateien sollten von Marketing kommen.
6. **Bilder** stammen aus dem Referenz-HTML (Base64-Extrakt). Für live besser die
   Originale in voller Qualität.

## Mit D2S zu klären

* Ist die Schrift des Entwurfs (`Rubik`) in `/d2s_managed/store/schipper.css`
  enthalten? Aktuell wird die Schrift geerbt (`font-family: inherit`). Wenn
  Schipper eine andere Marken-Schrift hat, sieht die Seite anders aus als der
  Entwurf – dann entweder Design anpassen oder Font von D2S einpflegen lassen.
* Breakpoints: AGENTS.md verweist auf die Skala in `src/shared/_vars.scss`.
  Verwendet sind aktuell 820px und 560px – gegen die Skala abgleichen.
* `config.schema.json` gegen `config.json` prüfen (`matomo_id: -1`,
  `facebook_id: 0`).
* Cookie-Management-Link ist nicht gesetzt, weil kein Third-Party-Dienst
  eingebunden ist.

## Assets

| Datei | Herkunft | Verwendung |
|-------|----------|------------|
| `public/schipper_logo.png` | Referenz-HTML | Header (standalone) |
| `public/hero_bloom_spirit.jpg` | Referenz-HTML | Hero-Hintergrund |
| `public/motiv_teaser.jpg` | Referenz-HTML | Story-Abschnitt (bewusst unscharf) |
| `public/polaroid_outdoor.jpg` | Referenz-HTML | „Entdecke mehr" |
| `public/polaroid_wall.jpg` | Referenz-HTML | „Entdecke mehr" |
| `favicon.png`, `uclogo.png` | aus Logo generiert | Tab-Icon, Klaro-Dialog |
