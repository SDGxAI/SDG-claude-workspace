#!/usr/bin/env python3
"""Vorab-Check fuer ein MiniCMS-Projekt gegen die Regeln aus AGENTS.md.

Prueft alles, was sich ohne laufendes MiniCMS pruefen laesst:
  * Ordnername <brand>_<purpose>, config.json (store, matomo_id, facebook_id)
  * Pflichtdateien, content.css XOR content.css.twig, favicon.png, uclogo.png
  * Uebersetzungen: de/fr/en vorhanden, identisches Key-Set, SEO-Keys,
    verwendete vs. vorhandene Keys, gleiche Platzhalter
  * media.get_asset_link-Ziele vorhanden, keine hardcodierten /publish/-Pfade
  * content.js: ES-Modul, liest die drei URL-Parameter, pollt auf den
    ShadowRoot, kein window/globalThis, kein document.querySelector
  * CSS: keine @font-face/Font-Imports, keine Layout-Media-Queries,
    Custom Properties auf :root, :host, kein Ueberschreiben von --scheme-primary

Aufruf: python3 minicms/tools/check_project.py minicms/projects/<projekt>
"""
import json
import re
import sys
from pathlib import Path

REQUIRED_FILES = ["config.json", "meta.json.twig", "content.twig", "favicon.png", "uclogo.png"]
REQUIRED_LOCALES = {"de", "en", "fr"}
SEO_KEYS = {"title", "description", "seo_keywords", "banner_logo"}
TRANS_RE = re.compile(r"'([a-z0-9_.]+)'\s*\|\s*trans")
CONCAT_TRANS_RE = re.compile(r"\('([a-z0-9_.]+)\.'\s*~\s*(\w+)\)\s*\|\s*trans")
LOOP_VALUES_RE = re.compile(r"for\s+\w+\s+in\s+\[([^\]]+)\]")
ASSET_RE = re.compile(r"media\.get_asset_link\(\s*'([^']+)'\s*\)")
PLACEHOLDER_RE = re.compile(r"%[a-z0-9_]+%")
JS_REQUIRED = ["top_el_ref", "top_el_ref_shadow_inner_dst", "data_src_ref"]


def strip_comments(text: str, kind: str) -> str:
    if kind == "js":
        text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
        return re.sub(r"^\s*//.*$", "", text, flags=re.M)
    if kind == "css":
        return re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"\{#.*?#\}", "", text, flags=re.S)


def collect_twig_keys(text: str) -> set[str]:
    """Direkte Keys plus die per Schleife zusammengesetzten ('countdown.' ~ unit)."""
    keys = set(TRANS_RE.findall(text))
    loop_values: list[str] = []
    for group in LOOP_VALUES_RE.findall(text):
        loop_values += re.findall(r"'([a-z0-9_]+)'", group)
    for prefix, _var in CONCAT_TRANS_RE.findall(text):
        keys.update(f"{prefix}.{value}" for value in loop_values)
    return keys


def check(project: Path) -> list[str]:
    problems: list[str] = []

    if not re.fullmatch(r"[a-z0-9]+(_[a-z0-9]+)+", project.name):
        problems.append(f"Ordnername '{project.name}' entspricht nicht <brand>_<purpose>")
    brand = project.name.split("_")[0]

    for name in REQUIRED_FILES:
        if not (project / name).is_file():
            problems.append(f"Pflichtdatei fehlt: {name}")

    config_path = project / "config.json"
    if config_path.is_file():
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
            if config.get("store") != brand:
                problems.append(f"config.json store='{config.get('store')}' passt nicht zum Ordnernamen ('{brand}')")
            if config.get("matomo_id") not in (-1, 0):
                problems.append("config.json matomo_id muss -1/0 bleiben – IDs kommen von D2S")
            if config.get("facebook_id") not in (-1, 0):
                problems.append("config.json facebook_id muss -1/0 bleiben – IDs kommen von D2S")
        except json.JSONDecodeError as exc:
            problems.append(f"config.json: ungueltiges JSON ({exc})")

    has_css = (project / "content.css").is_file()
    has_css_twig = (project / "content.css.twig").is_file()
    if has_css and has_css_twig:
        problems.append("content.css und content.css.twig duerfen nicht gleichzeitig existieren")

    used_keys: set[str] = set()
    assets: set[str] = set()
    for path in sorted(project.glob("*.twig")):
        text = strip_comments(path.read_text(encoding="utf-8"), "twig")
        used_keys.update(collect_twig_keys(text))
        assets.update(ASSET_RE.findall(text))
        if "/publish/project_public" in text:
            problems.append(f"{path.name}: hardcodierter /publish/project_public-Pfad")

    js_source = strip_comments((project / "content.js").read_text(encoding="utf-8"), "js") \
        if (project / "content.js").is_file() else ""
    used_keys.update(re.findall(r"[\"']([a-z0-9_]+(?:\.[a-z0-9_]+)+)[\"']", js_source))

    trans_dir = project / "translations"
    locales: dict[str, dict] = {}
    if not trans_dir.is_dir():
        problems.append("translations/ fehlt")
    else:
        for path in sorted(trans_dir.glob("*.json")):
            try:
                locales[path.stem] = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                problems.append(f"{path.name}: ungueltiges JSON ({exc})")
        missing_locales = REQUIRED_LOCALES - set(locales)
        if missing_locales:
            problems.append(f"Pflichtsprachen fehlen: {', '.join(sorted(missing_locales))}")

    if locales:
        reference = locales.get("de") or next(iter(locales.values()))
        for code, data in sorted(locales.items()):
            missing = sorted(set(reference) - set(data))
            extra = sorted(set(data) - set(reference))
            if missing:
                problems.append(f"{code}.json: fehlende Schluessel: {', '.join(missing)}")
            if extra:
                problems.append(f"{code}.json: unbekannte Schluessel: {', '.join(extra)}")
            missing_seo = sorted(SEO_KEYS - set(data))
            if missing_seo:
                problems.append(f"{code}.json: SEO-Schluessel fehlen: {', '.join(missing_seo)}")

        undefined = sorted(used_keys - set(reference))
        if undefined:
            problems.append(f"In Twig verwendet, aber nicht uebersetzt: {', '.join(undefined)}")
        unused = sorted(set(reference) - used_keys - SEO_KEYS)
        if unused:
            problems.append(f"uebersetzt, aber nirgends verwendet: {', '.join(unused)}")

        for key in sorted(set(reference) & used_keys):
            expected = set(PLACEHOLDER_RE.findall(str(reference[key])))
            for code, data in sorted(locales.items()):
                if key in data and set(PLACEHOLDER_RE.findall(str(data[key]))) != expected:
                    problems.append(f"{code}.json['{key}']: Platzhalter weichen von de ab")

    for asset in sorted(assets):
        if not (project / asset).is_file():
            problems.append(f"Asset referenziert, aber nicht vorhanden: {asset}")

    js_path = project / "content.js"
    if js_path.is_file():
        js = strip_comments(js_path.read_text(encoding="utf-8"), "js")
        for param in JS_REQUIRED:
            if param not in js:
                problems.append(f"content.js liest '{param}' nicht aus import.meta.url")
        if "setTimeout" not in js:
            problems.append("content.js pollt nicht auf den ShadowRoot (setTimeout-Retry fehlt)")
        for needle, message in (
            ("document.body", "content.js greift auf document.body zu"),
            ("window.", "content.js greift auf window zu"),
            ("globalThis", "content.js greift auf globalThis zu"),
            ("customElements", "content.js registriert Custom Elements"),
            ("document.querySelector", "content.js nutzt document.querySelector statt root.querySelector"),
        ):
            if needle in js:
                problems.append(message)
        if len(re.findall(r"document\.getElementById", js)) > 2:
            problems.append("content.js nutzt document.getElementById ausserhalb von top_el_ref/data_src_ref")

    css_path = project / ("content.css.twig" if has_css_twig else "content.css")
    if css_path.is_file():
        css = strip_comments(css_path.read_text(encoding="utf-8"), "css")
        if "@font-face" in css:
            problems.append("CSS enthaelt @font-face – Fonts kommen aus /d2s_managed/")
        if "fonts.googleapis" in css or "@import" in css:
            problems.append("CSS laedt externe Ressourcen (Font-CDN/@import)")
        if re.search(r"--scheme-primary(-hover)?\s*:", css):
            problems.append("CSS ueberschreibt --scheme-primary/--scheme-primary-hover")
        for media in re.findall(r"@media([^{]+)\{", css):
            if "prefers-" not in media:
                problems.append(f"@media fuer Layout gefunden ({media.strip()}) – Container Queries verwenden")
        if re.search(r"(^|\n)\s*:root\s*\{", css) and ":host" not in css:
            problems.append("Custom Properties nur auf :root – im ShadowRoot wird :host gebraucht")

    return problems


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    project = Path(sys.argv[1])
    if not project.is_dir():
        print(f"Kein Verzeichnis: {project}")
        return 2

    problems = check(project)
    if problems:
        print(f"{project}: {len(problems)} Befund(e)")
        for item in problems:
            print(f"  - {item}")
        return 1
    print(f"{project}: keine Befunde")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
