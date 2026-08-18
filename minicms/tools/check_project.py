#!/usr/bin/env python3
"""Vorab-Check fuer ein MiniCMS-Projekt (Entwurfsstand).

Prueft, was ohne das MiniCMS-Repo pruefbar ist:
  * Ordnername-Konvention <marke>_<zweck>
  * Pflichtdateien vorhanden, content.css XOR content.css.twig
  * uebersetzungsschluessel: in Twig verwendet vs. in translations/*.json vorhanden
  * Schluesselgleichheit ueber alle Sprachen, de/en/fr vorhanden
  * media.get_asset_link(...)-Ziele existieren
  * Platzhalter (%name%) in allen Sprachen identisch
  * content.js: keine window-/document.body-Zugriffe

Aufruf: python3 minicms/tools/check_project.py minicms/projects/<projekt>
"""
import json
import re
import sys
from pathlib import Path

REQUIRED = ["config.json", "meta.json.twig", "content.twig"]
REQUIRED_LOCALES = {"de", "en", "fr"}
TRANS_RE = re.compile(r"'([a-z0-9_.]+)'\s*\|\s*trans")
ASSET_RE = re.compile(r"media\.get_asset_link\(\s*'([^']+)'\s*\)")
PLACEHOLDER_RE = re.compile(r"%[a-z0-9_]+%")


def check(project: Path) -> list[str]:
    problems: list[str] = []

    if not re.fullmatch(r"[a-z0-9]+(_[a-z0-9]+)+", project.name):
        problems.append(f"Ordnername '{project.name}' entspricht nicht <marke>_<zweck> (lowercase, nur Unterstriche)")

    for name in REQUIRED:
        if not (project / name).is_file():
            problems.append(f"Pflichtdatei fehlt: {name}")

    has_css = (project / "content.css").is_file()
    has_css_twig = (project / "content.css.twig").is_file()
    if has_css and has_css_twig:
        problems.append("content.css und content.css.twig duerfen nicht gleichzeitig existieren")

    twig_files = sorted(project.glob("*.twig"))
    used_keys: set[str] = set()
    assets: set[str] = set()
    for path in twig_files:
        text = path.read_text(encoding="utf-8")
        used_keys.update(TRANS_RE.findall(text))
        assets.update(ASSET_RE.findall(text))

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

        undefined = sorted(used_keys - set(reference))
        if undefined:
            problems.append(f"In Twig verwendet, aber nicht uebersetzt: {', '.join(undefined)}")
        unused = sorted(set(reference) - used_keys)
        if unused:
            problems.append(f"uebersetzt, aber nirgends verwendet: {', '.join(unused)}")

        for key in sorted(set(reference) & used_keys):
            expected = set(PLACEHOLDER_RE.findall(str(reference[key])))
            for code, data in sorted(locales.items()):
                if key not in data:
                    continue
                found = set(PLACEHOLDER_RE.findall(str(data[key])))
                if found != expected:
                    problems.append(
                        f"{code}.json['{key}']: Platzhalter {sorted(found)} weichen von de {sorted(expected)} ab"
                    )

    for asset in sorted(assets):
        if not (project / asset).is_file():
            problems.append(f"Asset referenziert, aber nicht vorhanden: {asset}")

    js = project / "content.js"
    if js.is_file():
        text = js.read_text(encoding="utf-8")
        code_only = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
        code_only = re.sub(r"^\s*//.*$", "", code_only, flags=re.M)
        for needle, message in (
            ("document.body", "content.js greift auf document.body zu"),
            ("window.", "content.js greift auf window zu"),
            ("customElements", "content.js registriert Custom Elements (global)"),
        ):
            if needle in code_only:
                problems.append(message)
        if "export" not in code_only:
            problems.append("content.js hat keinen Export – muss ein ES-Modul sein")

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
