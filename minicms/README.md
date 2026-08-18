# MiniCMS – Landingpages (Arbeitsstand)

Arbeitsbereich für Landingpages, die später im MiniCMS von D2S Systems laufen
(`https://gitlab.d2s-systems.com/d2s.systems/sdg/minicms.git`).

**Nichts in diesem Ordner ist in das MiniCMS-Repo gepusht.** Der Inhalt hier ist
Vorbereitung: fertige Projektordner im MiniCMS-Format plus zwei Hilfsskripte, um
sie ohne lokale MiniCMS-Installation prüfen und anschauen zu können.

## Wichtig: AGENTS.md liegt noch nicht vor

Die maßgebliche Bauanleitung ist die `AGENTS.md` im Root des MiniCMS-Repos.
Aus dieser Umgebung ist `gitlab.d2s-systems.com` **nicht erreichbar** (der
Agent-Proxy beantwortet den Verbindungsaufbau mit `403`), das Repo ist also
nicht lesbar.

Alles hier ist deshalb nach dem Briefing gebaut und an den Stellen, an denen die
`AGENTS.md` die genaue Konvention festlegt, mit einer dokumentierten Annahme
versehen. Diese Annahmen stehen in der `NOTES.md` des jeweiligen Projekts und
sind vor dem ersten Merge Request abzugleichen. Bevor ein Projekt in das
MiniCMS-Repo wandert, gilt weiterhin: **`AGENTS.md` vollständig lesen.**

Damit die Prüfung schnell geht, sind alle Annahmen so gekapselt, dass sie mit
je einer Änderung korrigierbar sind (Übersetzungsfilter, JS-Einstiegspunkt,
Feldnamen in `meta.json.twig`).

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

Prüft Ordnernamen-Konvention, Pflichtdateien, `content.css` **xor**
`content.css.twig`, Übersetzungsschlüssel (verwendet vs. vorhanden, Gleichstand
über `de`/`en`/`fr`, identische Platzhalter), referenzierte Assets und ob
`content.js` an `window` oder `document.body` geht.

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

Ergebnis: `minicms/preview/<projekt>.<locale>.html` – im Browser öffnen.

Das ist **kein** Ersatz für `dev.php` im MiniCMS: Marken-Stylesheet
(`/d2s_managed/store/<store>.css`), `shared/`-Komponenten, Klaro und die
Interposer fehlen. Es zeigt Layout, Übersetzungen und JS-Verhalten.

## Regeln aus dem Briefing (Kurzfassung)

* Nur in `projects/<projektname>/` arbeiten – CMS-Code (`Mini.php`, `Helpers/`,
  `Interposers/`, `shared/`, `public/`, `src/`, `composer.json`, `urls.json`,
  Tests) ist eingefroren
* Keine neuen PHP-Abhängigkeiten, kein CSS-Framework, kein Third-Party-JS/CSS,
  keine CDNs, kein eigenes Tracking; alles Netzwerkanfragende Klaro-gewrappt
* Tracking-IDs kommen von D2S – niemals selbst erfinden
* `de.json`, `en.json`, `fr.json` sind Pflicht
* Alles rendert im ShadowRoot: kein `document.body`, keine globalen
  Registrierungen, keine seitenweiten IDs
* `content.js` ist ein ES-Modul und hängt nichts an `window`
* Layout über Container Queries (`@container`), nicht über Media Queries
* Projekt muss mehrfach auf derselben Seite laufen
* Keine eigenen Fonts, kein `@font-face` – Marken-Fonts kommen aus `/d2s_managed/`
* Ordnername `<marke>_<zweck>`, lowercase, nur Unterstriche

## Arbeitsablauf

1. Landingpage hier bauen und über die Vorschau abstimmen
2. Erst nach ausdrücklicher Freigabe („das ist der finale Stand") wird etwas
   in Richtung D2S gepusht
3. Push ins MiniCMS-Repo immer auf einen eigenen Branch + Merge Request, nie
   direkt auf `main`
4. Nach der finalen Abnahme durch D2S erlischt der Schreibzugriff – der
   abgegebene Stand muss final sein

## Offene Punkte

* `AGENTS.md` prüfen, sobald das MiniCMS-Repo erreichbar ist (siehe oben)
* Geht ein gemergter MR automatisch live oder gibt D2S manuell frei?
* Maintainer-Rechte im GitLab-Projekt für Yannick (aktuell keine
  Projekt-Settings, daher keine Deploy Tokens)
* Erste Marke/Kampagne für das Pilotprojekt festlegen
* Anbindung des Newsletter-Formulars (ESP/Salesforce Marketing Cloud) über
  einen Interposer – bis dahin verlässt bewusst kein Datensatz den Browser
