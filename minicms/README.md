# MiniCMS – Landingpages (Arbeitsstand)

Arbeitsbereich für Landingpages, die später im MiniCMS von D2S Systems laufen
(`https://gitlab.d2s-systems.com/d2s.systems/sdg/minicms.git`).

**Nichts in diesem Ordner ist in das MiniCMS-Repo gepusht.** Der Inhalt hier ist
Vorbereitung: fertige Projektordner im MiniCMS-Format plus zwei Hilfsskripte, um
sie ohne lokale MiniCMS-Installation prüfen und anschauen zu können.

## AGENTS.md

Die maßgebliche Bauanleitung ist die `AGENTS.md` aus dem MiniCMS-Repo. Sie liegt
vor und alles hier ist danach gebaut. Sie ist **nicht** in dieses Repo kopiert –
maßgeblich ist immer die Fassung im MiniCMS-Repo.

Aus dieser Umgebung ist `gitlab.d2s-systems.com` weiterhin nicht erreichbar
(Proxy antwortet mit 403). Der Weg ins MiniCMS-Repo läuft deshalb über einen
lokalen Klon: Projektordner von hier kopieren, dort auf einen eigenen Branch
committen, Merge Request stellen.

## Inhalt

```
minicms/
├── projects/
│   └── schipper_bloom_spirit_early/   # Landingpage im MiniCMS-Format (Entwurf)
├── preview/                            # generierte Vorschau-HTML (nicht von Hand ändern)
└── tools/
    ├── check_project.py                # Struktur- und Übersetzungs-Check
    └── preview.php                     # rendert ein Projekt in eine Vorschau-Seite
```

Ein Projektordner wird 1:1 nach `projects/<projektname>/` im MiniCMS-Repo
kopiert. `tools/` und `preview/` bleiben hier und gehören **nicht** ins
MiniCMS-Repo.

## Werkzeuge

### Struktur-Check

```bash
python3 minicms/tools/check_project.py minicms/projects/schipper_bloom_spirit_early
```

Prüft die Regeln aus der `AGENTS.md`, soweit sie ohne laufendes CMS prüfbar
sind: Ordnername, `config.json` (store passend zur Marke, `matomo_id`/
`facebook_id` bei `-1`/`0`), Pflichtdateien inkl. `favicon.png`/`uclogo.png`,
`content.css` **xor** `content.css.twig`, Übersetzungen (`de`/`fr`/`en`,
identisches Key-Set, SEO-Keys, Platzhalter, verwendet vs. vorhanden), Assets,
`content.js` (ES-Modul, drei URL-Parameter, Polling, keine Globals, kein
`document.querySelector`) und CSS (keine Fonts, keine Layout-Media-Queries,
Variablen auf `:root, :host`, `--scheme-primary` unangetastet).

### Vorschau

Rendert `content.twig`/`meta.json.twig` mit echtem Twig und baut daraus eine
HTML-Datei, die den Inhalt – wie im MiniCMS – in einem ShadowRoot mountet und
das Projekt **zweimal** auf derselben Seite instanziiert (zweite Instanz in
480 px Breite, um die Container Queries zu prüfen).

```bash
mkdir -p .twig && (cd .twig && composer require twig/twig)
MINICMS_VENDOR=.twig/vendor/autoload.php \
  php minicms/tools/preview.php minicms/projects/schipper_bloom_spirit_early de
```

Ergebnis: `minicms/preview/<projekt>.<locale>.html`. Die Datei muss über HTTP
geöffnet werden, weil ES-Module nicht über `file://` laden:

```bash
php -S localhost:8001 -t .
# http://localhost:8001/minicms/preview/schipper_bloom_spirit_early.de.html
```

Die Vorschau bildet den Einbettungs-Vertrag des CMS nach: ShadowRoot,
`div.minicms_container`, `content.js` als Modul mit `top_el_ref` /
`top_el_ref_shadow_inner_dst` / `data_src_ref`, Übersetzungen im
`data_src_ref`-Element. Dritter Parameter `standalone` (Default) oder `shop`
steuert `standalone.is_standalone()`.

Das ist **kein** Ersatz für `dev.php` im MiniCMS: Marken-Stylesheet
(`/d2s_managed/store/<store>.css`), `@shared`-Komponenten, `helpers.css/js`,
Klaro und die Interposer fehlen. Vor der Abgabe gehört das Projekt in eine
lokale MiniCMS-Installation (`http://localhost:8000/dev.php?t=<projekt>`).

## Regeln (Kurzfassung – maßgeblich ist AGENTS.md)

* Nur in `projects/<projektname>/` arbeiten – CMS-Code ist eingefroren
* Keine neuen PHP-Abhängigkeiten, kein CSS-Framework, kein Third-Party-JS/CSS,
  keine CDNs, kein eigenes Tracking; alles Netzwerkanfragende Klaro-gewrappt
* Tracking-IDs bleiben bei `-1`/`0` – sie werden von D2S gesetzt
* `@shared/`-Komponenten bevorzugen, insbesondere `@shared/newsletter.twig`
* `de.json`, `fr.json`, `en.json` mit identischem Key-Set inkl. SEO-Keys
* Alles im ShadowRoot: `content.js` als ES-Modul mit den drei URL-Parametern,
  Polling auf den ShadowRoot, keine Globals, kein `document.querySelector`
* Layout über `@container`, `@media` nur für echte Viewport-Fragen
* Projekt muss mehrfach auf derselben Seite laufen
* Keine eigenen Fonts, kein `@font-face`; Variablen auf `:root, :host`,
  `--scheme-primary` nicht überschreiben
* `favicon.png` und `uclogo.png` im Projektroot

## Arbeitsablauf

1. Landingpage hier bauen und über die Vorschau abstimmen
2. Vor der Abgabe in einer lokalen MiniCMS-Installation gegenprüfen
   (`dev.php?t=<projekt>`, Sprachen `de`/`fr`/`en`, Desktop und 320px)
3. Erst nach ausdrücklicher Freigabe („das ist der finale Stand") wandert der
   Projektordner ins MiniCMS-Repo – auf einen eigenen Branch, per Merge Request
4. Nach der finalen Abnahme durch D2S erlischt der Schreibzugriff – der
   abgegebene Stand muss final sein

## Offene Punkte

* `shared/components/newsletter.twig` bzw. `projects/example/` fehlen hier –
  ohne sie kann das Anmeldeformular nicht auf die Shared-Komponente umgestellt
  werden (aktuell Platzhalter ohne Datenübertragung)
* Geht ein gemergter MR automatisch live oder gibt D2S manuell frei?
* Maintainer-Rechte im GitLab-Projekt (aktuell keine Projekt-Settings)
* Marken-Schrift für Schipper: liegt `Rubik` in `/d2s_managed/` oder muss das
  Design auf die vorhandene Schrift angepasst werden?
* Breakpoint-Skala aus `src/shared/_vars.scss` gegenprüfen
