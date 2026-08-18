# schipper_bloom_spirit_early – Annahmen und offene Punkte

Übertragung der bestehenden Self-contained-HTML-Landingpage („Bloom Spirit
Early Access", Datei `Bloom Spirit.html` im Repo-Root) in die MiniCMS-Struktur.
Inhalt und Design sind übernommen, die technische Struktur ist neu gebaut.

Stand: Entwurf. **Die `AGENTS.md` des MiniCMS-Repos konnte nicht gelesen werden**
(GitLab aus dieser Umgebung nicht erreichbar). Die folgenden Punkte sind daher
Annahmen und vor dem ersten Merge Request abzugleichen.

## Zu prüfen gegen AGENTS.md

| # | Annahme | Wo | Aufwand bei Abweichung |
|---|---------|----|------------------------|
| 1 | Übersetzungen werden als `{{ 'key'\|trans }}` aufgelöst, Schlüssel flach mit Punkt-Notation in `translations/<locale>.json` | `content.twig`, `meta.json.twig` | Filtername global ersetzen; ggf. Schlüssel verschachteln |
| 2 | MiniCMS ruft den Default-Export von `content.js` mit dem ShadowRoot (oder dem Host-Element) auf | `content.js` (unterste Zeilen) | nur der Export ist anzupassen, die Logik nicht |
| 3 | Feldnamen in `meta.json.twig` (`title`, `description`, `banner.image/alt/headline/subline`) | `meta.json.twig` | Feldnamen austauschen |
| 4 | `media.get_asset_link('public/…')` liefert den Asset-Pfad (aus dem Briefing übernommen) | `content.twig` | – |
| 5 | Feature-Flags in `config.json`: keine gesetzt, da die möglichen Flags unbekannt sind | `config.json` | Flags ergänzen |
| 6 | Begrenztes Inline-Markup (`<b>`, `<br>`) in Übersetzungswerten, ausgegeben mit `\|raw` | `benefit.lead`, `more.body` | Keys in Teilstrings zerlegen |
| 7 | Es werden keine `shared/`-Komponenten genutzt, weil deren Inventar unbekannt ist | `content.twig` | Eigenbau durch `@shared/<komponente>.twig` ersetzen – bevorzugt laut Briefing |

## Bewusste Abweichungen vom Referenz-HTML

* **Keine Google Fonts.** Das Referenz-HTML lud `Rubik` per CDN. Die Schrift
  wird jetzt vom Marken-Stylesheet geerbt (`font-family: inherit`).
  *TODO D2S:* Ist `Rubik` in `/d2s_managed/store/schipper.css` enthalten? Wenn
  nicht, muss D2S sie einpflegen – eigene `@font-face`-Regeln sind untersagt.
* **Kein Sprachumschalter.** Im Referenz-HTML war er ohne Funktion. Wie die
  Locale im MiniCMS gewechselt wird (Shop-Kontext oder eigener Parameter), ist
  offen. Die Stelle ist in `content.twig` kommentiert.
* **Keine IDs mehr.** Alle JS- und Sprungziele laufen über `data-bse-*`
  Attribute, damit mehrere Instanzen derselben Seite kollisionsfrei sind.
  Das Ankersprung-Verhalten (`#anmeldung`) ist durch `scrollIntoView` innerhalb
  des ShadowRoots ersetzt.
* **Media Queries → Container Queries.** Alle Breakpoints laufen über
  `@container bse (…)`, fluide Größen über `cqi` statt `vw`.
* **Limited-Edition-Badge** aus dem Referenz-CSS ist nicht übernommen – im
  Referenz-HTML war es nicht im Markup.
* **Footer-Links** (Kontakt/Impressum/Datenschutz) sind nicht gesetzt: im
  eingebetteten Zustand kommen sie aus dem Shop-Footer. Für die Standalone-
  Auslieferung müssen die Ziel-URLs von D2S/Legal bestätigt werden.

## Vor Live-Schaltung zwingend erledigen

1. **Newsletter-Formular anbinden.** Aktuell reine Frontend-Demo: Validierung
   und Erfolgsansicht laufen lokal, es wird **kein Datensatz übertragen**. Die
   Übergabe an den ESP (Salesforce Marketing Cloud) muss über den vorgesehenen
   Interposer laufen und Klaro-Consent-gewrappt sein. In diesem Zustand darf die
   Seite nicht live gehen.
2. **Kampagnendaten setzen.** `early_access_start` und `launch_date` stehen oben
   in `content.twig` auf den Daten der ursprünglichen Kampagne (13./14.08.) und
   liegen damit in der Vergangenheit – der Countdown steht auf null. Zeitzone ist
   explizit `Europe/Berlin`.
3. **Tracking-IDs eintragen.** `matomo_id` und `facebook_id` in `config.json`
   sind leer und werden von D2S geliefert – nicht selbst erfinden.
4. **Video ergänzen.** Der Abschnitt „Ein Blick hinter die Kulissen" enthält
   einen Platzhalter. Das finale Video muss lokal aus `public/` eingebunden
   werden – kein YouTube-/Vimeo-Embed.
5. **Datenschutz-Link** im Consent-Text setzen, sobald das Ziel feststeht.
6. **Bilder prüfen.** Die Assets in `public/` sind aus dem Referenz-HTML
   extrahiert (Base64). Für die Live-Seite sollten die Originaldateien in voller
   Qualität und passenden Größen von der Agentur/Marketing kommen.

## Assets

| Datei | Herkunft | Verwendung |
|-------|----------|------------|
| `public/schipper_logo.png` | Referenz-HTML | Header |
| `public/hero_bloom_spirit.jpg` | Referenz-HTML | Hero-Hintergrund, Banner |
| `public/motiv_teaser.jpg` | Referenz-HTML | Story-Abschnitt (bewusst unscharf) |
| `public/polaroid_outdoor.jpg` | Referenz-HTML | „Entdecke mehr" |
| `public/polaroid_wall.jpg` | Referenz-HTML | „Entdecke mehr" |
