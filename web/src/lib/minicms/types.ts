/** Gemeinsame Typen des MiniCMS-Exports. */

export type IssueLevel = "error" | "warn" | "info";

export interface Issue {
  level: IssueLevel;
  text: string;
}

/** Sammelt Hinweise für die Prüfung vor dem Versand (doppelte fallen weg). */
export class Issues {
  readonly list: Issue[] = [];
  private seen = new Set<string>();

  private add(level: IssueLevel, text: string) {
    const key = `${level}|${text}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push({ level, text });
  }
  error(text: string) {
    this.add("error", text);
  }
  warn(text: string) {
    this.add("warn", text);
  }
  info(text: string) {
    this.add("info", text);
  }
  get errors() {
    return this.list.filter((i) => i.level === "error");
  }
  get warnings() {
    return this.list.filter((i) => i.level === "warn");
  }
}

export interface Asset {
  bytes: Uint8Array;
  /** Dateiendung ohne Punkt, klein (png, jpg, webp, svg, mp4 …). */
  ext: string;
}

/** Ein zusammenhängender Text (z. B. ein Absatz mit Fettdruck) – Teile in Reihenfolge. */
export interface TextUnit {
  keys: string[];
  de: string[];
}

export type TargetLang = "en" | "fr";

export interface MiniCmsFile {
  path: string;
  content: string | Uint8Array;
}
