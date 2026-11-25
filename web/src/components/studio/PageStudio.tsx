"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { addComment } from "@/lib/actions/comments";
import {
  aiEdit,
  currentHtml,
  patchPage,
  prepareImageUpload,
  saveAnchors,
  undoAi,
} from "@/lib/actions/studio";
import {
  deleteVersion,
  getVersionHtml,
  restoreVersion,
  saveVersion,
  type VersionMeta,
} from "@/lib/actions/versions";
import { prepareImageForUpload } from "@/lib/images/prepareUpload";
import { withBlankLinks } from "@/lib/html/previewLinks";
import { formatBytes } from "@/lib/briefing";
import type { Patch } from "@/lib/page/html";
import type { CommentAnchor, PageVersionSource } from "@/types/database";
import { StudioSidebar, type AiLogEntry, type Thread } from "./StudioSidebar";

/**
 * Arbeitsfläche einer HTML-Seite: Die Seite läuft in einem eigenen Fenster
 * (wie im Browser), Kommentar-Pins hängen an den Elementen der Seite, Texte
 * und Bilder werden direkt auf der Seite geändert, und die KI tauscht nur die
 * betroffenen Elemente aus – ohne dass die Seite neu lädt.
 */

type Mode = "view" | "comment" | "edit" | "pick";
type Pt = { x: number; y: number };
type Pic = { el: HTMLElement; kind: "img" | "bg" };

const SOURCE_LABEL: Record<PageVersionSource, string> = {
  manual: "Gespeichert",
  editor: "Bearbeitet",
  claude: "Aus Claude",
  umsetzen: "KI-Umsetzung",
  import: "Import",
  ki: "KI-Änderung",
  shopify: "Aus Shopify",
};

const HINT: Record<Mode, string> = {
  view: "",
  comment: "Klicke auf die Stelle, zu der du etwas sagen möchtest.",
  edit: "Klicke auf einen Text, um ihn direkt zu ändern (Enter speichert, Esc verwirft) – oder auf ein Bild, um es zu ersetzen.",
  pick: "Klicke auf die Stelle, die die KI ändern soll.",
};

const CORNERS: [string, string | null][] = [
  ["Original", null],
  ["Eckig", "0px"],
  ["Leicht", "8px"],
  ["Mittel", "16px"],
  ["Stark", "32px"],
  ["Rund", "9999px"],
];

const PANEL_KEY = "sdg-sites-leiste";

/** Hilfs-Styles in der Seite (nur in der Ansicht, werden nie gespeichert). */
const FRAME_CSS = `
html[data-sites-mode="comment"] *,html[data-sites-mode="pick"] *{cursor:crosshair!important}
html[data-sites-mode="comment"] *{user-select:none!important;-webkit-user-select:none!important}
[data-sites-hover]{outline:2px solid rgba(227,6,19,.55)!important;outline-offset:2px!important;cursor:pointer}
[contenteditable]{outline:2px solid #e30613!important;outline-offset:2px!important;cursor:text!important}
[data-sites-flash]{animation:sites-flash 1.6s ease-out 1}
@keyframes sites-flash{0%{box-shadow:0 0 0 5px rgba(227,6,19,.65)}100%{box-shadow:0 0 0 5px rgba(227,6,19,0)}}`;

const bySid = (d: Document, sid: string) =>
  d.querySelector<HTMLElement>(`[data-sid="${sid.replace(/[^\w-]/g, "")}"]`);

const INLINE_TAGS =
  /^(a|abbr|b|bdi|bdo|br|cite|code|del|dfn|em|font|i|img|ins|kbd|label|mark|q|s|small|span|strong|sub|sup|svg|time|u|var|wbr)$/i;

/** Der Textblock, zu dem ein angeklicktes Element gehört (oder nichts). */
function textBlock(target: Element, win: Window): HTMLElement | null {
  let el = target.closest<HTMLElement>("[data-sid]");
  while (el && win.getComputedStyle(el).display === "inline") {
    el = el.parentElement?.closest<HTMLElement>("[data-sid]") ?? null;
  }
  if (!el || /^(BODY|IMG)$/.test(el.tagName) || el.closest("svg") || !el.textContent?.trim()) return null;
  // Nur „reine“ Textblöcke (Überschrift, Absatz, Button …), keine Container.
  for (const k of el.querySelectorAll("*")) {
    if (!INLINE_TAGS.test(k.tagName) && !k.closest("svg")) return null;
  }
  return el;
}

/** Das Bild unter dem Mauszeiger – auch wenn etwas darüber liegt. */
function pictureAt(d: Document, win: Window, x: number, y: number): Pic | null {
  const stack = d.elementsFromPoint(x, y).filter((n) => n.hasAttribute("data-sid")) as HTMLElement[];
  const img = stack.find((n) => n.tagName === "IMG");
  if (img) return { el: img, kind: "img" };
  const bg = stack.find((n) => /url\(/.test(win.getComputedStyle(n).backgroundImage));
  return bg ? { el: bg, kind: "bg" } : null;
}

function labelOf(el: HTMLElement): string {
  const text = el.textContent?.replace(/\s+/g, " ").trim() ?? "";
  if (text) return `„${text.slice(0, 36)}${text.length > 36 ? "…" : ""}“`;
  return el.tagName === "IMG" ? "Bild" : "Bereich";
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

interface Props {
  projectId: string;
  pageId: string;
  html: string;
  threads: Thread[];
  versions: VersionMeta[];
  canComment: boolean;
  canEdit: boolean;
  currentUserEmail: string;
}

export function PageStudio(props: Props) {
  const { projectId, pageId, canEdit, canComment } = props;
  const router = useRouter();
  const frame = useRef<HTMLIFrameElement>(null);

  const [html, setHtml] = useState(props.html);
  // Zähler erzwingt ein frisches Seitenfenster (die Seite wird sonst direkt
  // im Fenster geändert, der gemerkte Text oben ist dann nicht mehr aktuell).
  const [rev, setRev] = useState(0);
  const [old, setOld] = useState<{ meta: VersionMeta; html: string; threads: Thread[] } | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [mobile, setMobile] = useState(false);
  // Rechte Leiste (KI + Kommentare) ein-/ausblenden, für mehr Platz beim Ansehen.
  const [panel, setPanel] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(PANEL_KEY) === "0") setPanel(false);
    } catch {
      /* ohne Speicher: eingeblendet */
    }
  }, []);
  function togglePanel(next = !panel) {
    setPanel(next);
    try {
      window.localStorage.setItem(PANEL_KEY, next ? "1" : "0");
    } catch {
      /* egal */
    }
  }
  const [layer, setLayer] = useState<ShadowRoot | HTMLElement | null>(null);
  const [pos, setPos] = useState<Record<string, Pt>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [draft, setDraft] = useState<{ anchor: CommentAnchor; xPct: number; yPct: number; at: Pt; text: string } | null>(null);
  const [pic, setPic] = useState<(Pic & { at: Pt; note: string | null }) | null>(null);
  const [target, setTarget] = useState<{ sid: string; label: string } | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [log, setLog] = useState<AiLogEntry[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [busy, setBusy] = useState(false);

  const threads = old ? old.threads : props.threads;
  const visible = useMemo(
    () => threads.filter((t) => showDone || t.status === "offen" || t.id === selected),
    [threads, showDone, selected],
  );
  const numberOf = useMemo(() => new Map(threads.map((t, i) => [t.id, i + 1])), [threads]);
  const srcDoc = useMemo(() => withBlankLinks(old ? old.html : html), [old, html]);

  // Was die (einmal angehängten) Ereignis-Funktionen der Seite gerade brauchen.
  const live = useRef({ mode, visible, draft, readOnly: !!old });
  live.current = { mode, visible, draft, readOnly: !!old };
  const editing = useRef<{ el: HTMLElement; before: string } | null>(null);
  const keepScroll = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const observer = useRef<ResizeObserver | null>(null);
  const backfilled = useRef(false);

  const page = () => {
    const d = frame.current?.contentDocument;
    const w = frame.current?.contentWindow;
    return d?.body && w ? { d, w } : null;
  };

  /** Pins dorthin setzen, wo ihr Element gerade liegt. */
  const measure = useCallback(() => {
    const p = page();
    if (!p) return;
    const root = p.d.documentElement;
    const place = (anchor: CommentAnchor | null | undefined, xPct: number, yPct: number): Pt => {
      const r = anchor ? bySid(p.d, anchor.sid)?.getBoundingClientRect() : null;
      return r && (r.width || r.height)
        ? { x: r.left + p.w.scrollX + anchor!.dx * r.width, y: r.top + p.w.scrollY + anchor!.dy * r.height }
        : { x: (xPct / 100) * root.scrollWidth, y: (yPct / 100) * root.scrollHeight };
    };
    const next: Record<string, Pt> = {};
    for (const t of live.current.visible) next[t.id] = place(t.anchor, t.xPct, t.yPct);
    const dr = live.current.draft;
    if (dr) next.new = place(dr.anchor, dr.xPct, dr.yPct);
    setPos(next);
  }, []);

  useEffect(measure, [measure, visible, draft, layer]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  useEffect(() => {
    const p = page();
    if (p) {
      p.d.documentElement.setAttribute("data-sites-mode", mode);
      p.d.querySelectorAll("[data-sites-hover]").forEach((el) => el.removeAttribute("data-sites-hover"));
    }
    if (mode !== "edit") editing.current?.el.blur();
    if (mode !== "edit") setPic(null);
    if (mode !== "comment") setDraft(null);
  }, [mode, layer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setDraft(null);
      setPic(null);
      setShowVersions(false);
      setMode("view");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Änderungen von Hand nacheinander speichern (nie zwei gleichzeitig). */
  function save(patches: Patch[]) {
    setStatus({ ok: true, text: "Speichert …" });
    queue.current = queue.current.then(async () => {
      const res = await patchPage(projectId, patches).catch(() => ({
        ok: false as const,
        error: "Verbindung unterbrochen – die Änderung wurde nicht gespeichert.",
      }));
      setStatus(res.ok ? { ok: true, text: "Gespeichert ✓" } : { ok: false, text: res.error });
    });
  }

  // --- Ereignisse in der Seite -------------------------------------------
  const handlers = useRef({
    down(e: MouseEvent) {
      const p = page();
      if (!p || live.current.mode !== "edit" || e.button !== 0) return;
      const t = e.target as Element;
      if (editing.current?.el.contains(t)) return;
      setPic(null);
      const block = textBlock(t, p.w);
      if (block) {
        // Jetzt schreibbar machen – der Browser setzt die Schreibmarke selbst.
        editing.current?.el.blur();
        block.removeAttribute("data-sites-hover");
        editing.current = { el: block, before: block.innerHTML };
        block.contentEditable = "plaintext-only";
        if (block.contentEditable !== "plaintext-only") block.contentEditable = "true";
        return;
      }
      e.preventDefault();
      editing.current?.el.blur();
      const found = pictureAt(p.d, p.w, e.clientX, e.clientY);
      if (!found) return;
      const fr = frame.current!.getBoundingClientRect();
      const r = found.el.getBoundingClientRect();
      setPic({
        ...found,
        note: null,
        at: { x: fr.left + Math.max(r.left, 0) + 8, y: fr.top + Math.min(Math.max(e.clientY + 12, 8), fr.height - 8) },
      });
    },
    click(e: MouseEvent) {
      const p = page();
      const t = e.target as Element;
      const { mode: m, readOnly } = live.current;
      if (!p) return;
      if (m === "view" || readOnly) {
        // Sprungmarken innerhalb der Seite bleiben in der Seite.
        const hash = t.closest("a[href^='#']")?.getAttribute("href");
        if (hash) {
          e.preventDefault();
          if (hash.length > 1) p.d.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
        }
        return;
      }
      e.preventDefault();
      if (m === "edit") return;
      e.stopPropagation();
      const el = t.closest<HTMLElement>("[data-sid]");
      if (!el) return;
      if (m === "pick") {
        setTarget({ sid: el.dataset.sid!, label: labelOf(el) });
        setMode("view");
        return;
      }
      const r = el.getBoundingClientRect();
      const fr = frame.current!.getBoundingClientRect();
      const root = p.d.documentElement;
      setDraft({
        anchor: {
          sid: el.dataset.sid!,
          dx: r.width ? (e.clientX - r.left) / r.width : 0.5,
          dy: r.height ? (e.clientY - r.top) / r.height : 0.5,
        },
        xPct: ((e.clientX + p.w.scrollX) / root.scrollWidth) * 100,
        yPct: ((e.clientY + p.w.scrollY) / root.scrollHeight) * 100,
        at: { x: fr.left + e.clientX, y: fr.top + e.clientY },
        text: "",
      });
    },
    over(e: MouseEvent) {
      const p = page();
      if (!p) return;
      p.d.querySelector("[data-sites-hover]")?.removeAttribute("data-sites-hover");
      const { mode: m, readOnly } = live.current;
      // Beim Kommentieren nichts hervorheben – man wählt ja nichts aus.
      if (m === "view" || m === "comment" || readOnly) return;
      const t = e.target as Element;
      const el =
        m === "edit"
          ? editing.current?.el.contains(t)
            ? null
            : (textBlock(t, p.w) ?? pictureAt(p.d, p.w, e.clientX, e.clientY)?.el)
          : t.closest("[data-sid]");
      el?.setAttribute("data-sites-hover", "");
    },
    key(e: KeyboardEvent) {
      const ed = editing.current;
      if (!ed) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        ed.el.innerHTML = ed.before;
        ed.el.blur();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        ed.el.blur();
      }
    },
    blur(e: FocusEvent) {
      const ed = editing.current;
      if (!ed || e.target !== ed.el) return;
      editing.current = null;
      ed.el.removeAttribute("contenteditable");
      if (ed.el.innerHTML !== ed.before) save([{ sid: ed.el.dataset.sid!, html: ed.el.innerHTML }]);
    },
  });

  function onLoad() {
    const p = page();
    if (!p) return;
    const { d, w } = p;
    const css = d.createElement("style");
    css.textContent = FRAME_CSS;
    d.head.appendChild(css);
    const host = d.createElement("div");
    host.style.cssText = "all:initial;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647";
    d.documentElement.appendChild(host);
    const h = handlers.current;
    d.addEventListener("mousedown", (e) => h.down(e), true);
    d.addEventListener("click", (e) => h.click(e), true);
    d.addEventListener("mouseover", (e) => h.over(e), true);
    d.addEventListener("keydown", (e) => h.key(e), true);
    d.addEventListener("focusout", (e) => h.blur(e), true);
    observer.current?.disconnect();
    observer.current = new ResizeObserver(() => measure());
    observer.current.observe(d.body);
    w.scrollTo(0, keepScroll.current);
    keepScroll.current = 0;
    setLayer(host.attachShadow ? host.attachShadow({ mode: "open" }) : host);
    window.setTimeout(backfill, 400);
  }

  /** Ältere Kommentare (nur Prozent-Position) einmalig an ihr Element heften. */
  function backfill() {
    const p = page();
    if (!p || backfilled.current || !canEdit || old || mobile) return;
    backfilled.current = true;
    const loose = props.threads.filter((t) => !t.anchor);
    if (loose.length === 0) return;
    const root = p.d.documentElement;
    const boxes = [...p.d.body.querySelectorAll<HTMLElement>("[data-sid]")].map((el) => ({
      sid: el.dataset.sid!,
      r: el.getBoundingClientRect(),
    }));
    const found: { id: string; anchor: CommentAnchor }[] = [];
    for (const t of loose) {
      const x = (t.xPct / 100) * root.scrollWidth - p.w.scrollX;
      const y = (t.yPct / 100) * root.scrollHeight - p.w.scrollY;
      const hit = boxes
        .filter(({ r }) => r.width && r.height && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
        .sort((a, b) => a.r.width * a.r.height - b.r.width * b.r.height)[0];
      if (hit) {
        found.push({ id: t.id, anchor: { sid: hit.sid, dx: (x - hit.r.left) / hit.r.width, dy: (y - hit.r.top) / hit.r.height } });
      }
    }
    if (found.length) void saveAnchors(projectId, found).then(() => router.refresh());
  }

  /** Ganze Seite neu einsetzen (nach Wiederherstellen/Zurücknehmen). */
  function reload(next: string) {
    keepScroll.current = page()?.w.scrollY ?? 0;
    setLayer(null);
    setOld(null);
    setHtml(next);
    setRev((r) => r + 1);
  }

  function jumpTo(id: string) {
    setSelected(id);
    const p = page();
    const pt = pos[id];
    if (p && pt) p.w.scrollTo({ top: Math.max(0, pt.y - p.w.innerHeight / 2), behavior: "smooth" });
  }

  // --- Kommentar anlegen --------------------------------------------------
  async function submitDraft() {
    if (!draft?.text.trim()) return;
    setBusy(true);
    const res = await addComment({ pageId, projectId, body: draft.text, xPct: draft.xPct, yPct: draft.yPct, anchor: draft.anchor });
    setBusy(false);
    if (!res.ok) return setStatus({ ok: false, text: res.error });
    setDraft(null);
    setMode("view");
    router.refresh();
  }

  // --- Bild ersetzen / Ecken ---------------------------------------------
  function setCorners(value: string | null) {
    const p = page();
    if (!pic || !p) return;
    const els = [pic.el];
    const parent = pic.el.parentElement;
    if (parent?.dataset.sid && p.w.getComputedStyle(parent).overflow !== "visible") {
      const a = pic.el.getBoundingClientRect();
      const b = parent.getBoundingClientRect();
      if (Math.abs(a.width - b.width) < 3 && Math.abs(a.height - b.height) < 3) els.push(parent);
    }
    for (const el of els) {
      if (value) el.style.setProperty("border-radius", value, "important");
      else el.style.removeProperty("border-radius");
    }
    save(els.map((el) => ({ sid: el.dataset.sid!, style: { "border-radius": value } })));
  }

  async function replaceImage(file: File | undefined) {
    if (!file || !pic) return;
    const { el, kind } = pic;
    setPic({ ...pic, note: "Wird hochgeladen …" });
    try {
      const ready = await prepareImageForUpload(file);
      const prep = await prepareImageUpload(projectId, ready.type, ready.size);
      if (!prep.ok) throw new Error(prep.error);
      const { error } = await createClient()
        .storage.from("ki-assets")
        .uploadToSignedUrl(prep.path, prep.token, ready, { contentType: ready.type });
      if (error) throw new Error(`Upload fehlgeschlagen (${error.message}).`);
      const sid = el.dataset.sid!;
      if (kind === "img") {
        el.removeAttribute("srcset");
        el.removeAttribute("sizes");
        el.closest("picture")?.querySelectorAll("source").forEach((s) => s.remove());
        (el as HTMLImageElement).src = prep.url;
        save([{ sid, attrs: { src: prep.url } }]);
      } else {
        el.style.setProperty("background-image", `url("${prep.url}")`, "important");
        save([{ sid, style: { "background-image": `url("${prep.url}")` } }]);
      }
      setPic((cur) => (cur ? { ...cur, note: "Bild ersetzt ✓" } : cur));
    } catch (err) {
      setPic((cur) => (cur ? { ...cur, note: err instanceof Error ? err.message : "Upload fehlgeschlagen." } : cur));
    }
  }

  // --- KI -----------------------------------------------------------------
  async function runAi(input: { commentId?: string; instruction?: string; model: string }) {
    if (aiBusy) return;
    const key = input.commentId ?? "chat";
    const question = input.commentId
      ? `Kommentar ${numberOf.get(input.commentId) ?? ""} umsetzen`
      : (input.instruction ?? "");
    setAiBusy(key);
    await queue.current; // erst offene Handarbeit sichern
    const res = await aiEdit({ projectId, ...input, sid: input.commentId ? null : target?.sid }).catch(() => ({
      ok: false as const,
      error: "Die KI hat zu lange gebraucht oder die Verbindung ist abgebrochen. Bitte erneut versuchen.",
    }));
    setAiBusy(null);
    if (!res.ok) {
      setLog((l) => [...l, { key, question, answer: res.error, failed: true }]);
      return;
    }
    const p = page();
    if (p) {
      for (const e of res.edits) {
        const el = bySid(p.d, e.sid);
        if (el) el.outerHTML = e.html;
      }
      if (res.css) {
        let st = p.d.querySelector("style[data-sites-css]");
        if (!st) {
          st = p.d.createElement("style");
          st.setAttribute("data-sites-css", "");
          p.d.head.appendChild(st);
        }
        st.textContent += `\n${res.css}\n`;
      }
      const first = res.edits.map((e) => bySid(p.d, e.sid)).find(Boolean);
      if (first) {
        first.scrollIntoView({ block: "center", behavior: "smooth" });
        first.setAttribute("data-sites-flash", "");
        window.setTimeout(() => first.removeAttribute("data-sites-flash"), 1700);
      }
      measure();
    }
    setTarget(null);
    setLog((l) => [...l, { key, question, answer: res.summary, versionNo: res.versionNo }]);
    router.refresh();
  }

  async function undo(entry: AiLogEntry) {
    if (!entry.versionNo || aiBusy) return;
    setAiBusy("undo");
    const res = await undoAi(projectId, entry.versionNo);
    setAiBusy(null);
    if (!res.ok) return setStatus({ ok: false, text: res.error });
    setLog((l) => l.map((e) => (e === entry ? { ...e, versionNo: null, answer: `${e.answer} (zurückgenommen)` } : e)));
    reload(res.html);
    router.refresh();
  }

  // --- Versionen ----------------------------------------------------------
  async function openVersion(meta: VersionMeta) {
    setBusy(true);
    const res = await getVersionHtml(meta.id);
    setBusy(false);
    if (!res.ok) return setStatus({ ok: false, text: res.error });
    setShowVersions(false);
    setMode("view");
    setLayer(null);
    setOld({ meta, html: res.html, threads: res.comments });
  }

  async function backToCurrent() {
    const res = await currentHtml(projectId);
    if (res.ok) reload(res.html);
  }

  async function restore(meta: VersionMeta) {
    if (!window.confirm(`Version ${meta.versionNo} wiederherstellen? Der jetzige Stand wird vorher als Version gesichert.`)) return;
    setBusy(true);
    const res = await restoreVersion(meta.id, pageId, projectId);
    setBusy(false);
    if (!res.ok) return setStatus({ ok: false, text: res.error });
    setShowVersions(false);
    await backToCurrent();
    router.refresh();
  }

  async function keepVersion() {
    const label = window.prompt("Name für diese Version (optional):", "");
    if (label === null) return;
    await queue.current;
    const res = await saveVersion(pageId, projectId, label);
    setStatus(res.ok ? { ok: true, text: `Version ${res.versionNo} gespeichert ✓` } : { ok: false, text: res.error });
    router.refresh();
  }

  async function removeVersion(meta: VersionMeta) {
    if (!window.confirm(`Version ${meta.versionNo} endgültig löschen?`)) return;
    await deleteVersion(meta.id, projectId);
    router.refresh();
  }

  const toggle = (m: Mode) => setMode((cur) => (cur === m ? "view" : m));
  const tool = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
      active ? "bg-sdg-red text-white" : "text-neutral-700 hover:bg-neutral-100"
    }`;
  const popover = (at: Pt, width: number): React.CSSProperties => ({
    position: "fixed",
    left: Math.max(8, Math.min(at.x, (typeof window === "undefined" ? 1200 : window.innerWidth) - width - 8)),
    top: Math.max(8, Math.min(at.y, (typeof window === "undefined" ? 800 : window.innerHeight) - 220)),
    width,
    zIndex: 50,
  });

  return (
    <div className="flex flex-col gap-4 px-4 lg:h-[max(560px,calc(100vh-8rem))] lg:flex-row">
      <div className="flex h-[78vh] min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm lg:h-auto lg:flex-1">
        {/* Werkzeugleiste */}
        <div className="relative flex flex-wrap items-center gap-1 border-b border-neutral-200 px-2 py-1.5">
          {old ? (
            <>
              <span className="px-2 text-sm text-neutral-700">
                Du siehst <strong>Version {old.meta.versionNo}</strong> vom {when(old.meta.createdAt)}
              </span>
              {canEdit && (
                <button onClick={() => restore(old.meta)} disabled={busy} className={tool(true)}>
                  Wiederherstellen
                </button>
              )}
              <button onClick={backToCurrent} className={tool(false)}>
                ← Zurück zum aktuellen Stand
              </button>
            </>
          ) : (
            <>
              {canComment && (
                <button onClick={() => toggle("comment")} className={tool(mode === "comment")}>
                  💬 Kommentieren
                </button>
              )}
              {canEdit && (
                <button onClick={() => toggle("edit")} className={tool(mode === "edit")}>
                  ✏️ Bearbeiten
                </button>
              )}
            </>
          )}
          <span className="mx-1 hidden h-5 w-px bg-neutral-200 sm:block" />
          <div className="flex rounded-lg bg-neutral-100 p-0.5 text-sm">
            {[false, true].map((m) => (
              <button
                key={String(m)}
                onClick={() => setMobile(m)}
                className={`rounded-md px-2.5 py-1 ${mobile === m ? "bg-white font-medium text-neutral-900 shadow-sm" : "text-neutral-500"}`}
              >
                {m ? "Mobil" : "Desktop"}
              </button>
            ))}
          </div>
          <span className="mx-1 hidden h-5 w-px bg-neutral-200 sm:block" />
          <button onClick={() => setShowVersions((v) => !v)} className={tool(showVersions)}>
            🕘 Versionen ({props.versions.length})
          </button>
          <span className={`ml-auto px-2 text-xs ${status?.ok === false ? "font-medium text-sdg-red" : "text-neutral-500"}`}>
            {status?.text}
          </span>
          {!old && (
            <button onClick={backToCurrent} className={tool(false)} title="Aktuellen Stand neu laden (z. B. nach einem Update aus Claude)">
              ↻
            </button>
          )}
          <button
            onClick={() => togglePanel()}
            className={`${tool(false)} hidden lg:inline-flex lg:items-center lg:gap-1.5`}
            title={panel ? "Seitenleiste ausblenden – mehr Platz für die Seite" : "Kommentare und KI wieder einblenden"}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M15 4v16" />
            </svg>
            {panel ? "Ausblenden" : `Kommentare (${threads.filter((t) => t.status === "offen").length})`}
          </button>

          {showVersions && (
            <div className="absolute left-2 top-full z-30 mt-1 max-h-[60vh] w-[26rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-neutral-200 bg-white p-2 shadow-xl">
              {canEdit && !old && (
                <button onClick={keepVersion} className="mb-2 w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700">
                  Jetzigen Stand als Version speichern
                </button>
              )}
              {props.versions.length === 0 && (
                <p className="p-3 text-sm text-neutral-500">Noch keine Versionen.</p>
              )}
              {props.versions.map((v) => (
                <div key={v.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-50">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-neutral-800">
                      <strong>V{v.versionNo}</strong> · {SOURCE_LABEL[v.source] ?? v.source}
                      {v.label ? ` · ${v.label}` : ""}
                    </div>
                    <div className="truncate text-[11px] text-neutral-400">
                      {when(v.createdAt)}
                      {v.authorEmail ? ` · ${v.authorEmail}` : ""}
                    </div>
                  </div>
                  {v.sizeBytes ? (
                    <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 font-mono text-[11px] text-neutral-500" title="Größe dieser Version">
                      {formatBytes(v.sizeBytes)}
                    </span>
                  ) : null}
                  <button onClick={() => openVersion(v)} disabled={busy} className="text-xs font-medium text-sdg-red hover:underline">
                    Ansehen
                  </button>
                  {canEdit && (
                    <button onClick={() => removeVersion(v)} className="text-xs text-neutral-400 hover:text-sdg-red" title="Version löschen">
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {HINT[mode] && !old && (
          <div className="border-b border-sdg-red/20 bg-sdg-red-light px-3 py-1.5 text-xs text-sdg-red-dark">{HINT[mode]}</div>
        )}

        {/* Die Seite – in der Mobil-Ansicht in einem Handy, in dem man scrollt.
            Gleicher Aufbau in beiden Ansichten, damit die Seite beim
            Umschalten nicht neu lädt. */}
        <div
          className={`flex min-h-[420px] flex-1 items-center justify-center overflow-hidden ${
            mobile ? "bg-gradient-to-br from-rose-50 via-orange-50 to-amber-50 p-5" : "bg-neutral-100"
          }`}
        >
          <div
            className={
              mobile
                ? "flex h-full max-h-[880px] w-[414px] shrink-0 flex-col rounded-[3rem] bg-neutral-900 p-3 shadow-2xl ring-1 ring-black/10"
                : "flex h-full w-full flex-col"
            }
          >
            <div className={`flex min-h-0 flex-1 flex-col bg-white ${mobile ? "overflow-hidden rounded-[2.35rem]" : ""}`}>
              {mobile && (
                <div className="relative flex h-10 shrink-0 items-center justify-between px-7 text-[13px] font-semibold text-neutral-900">
                  <span>9:41</span>
                  <span className="absolute left-1/2 top-2.5 h-6 w-24 -translate-x-1/2 rounded-full bg-neutral-900" />
                  <svg className="h-3 w-12" viewBox="0 0 48 12" fill="currentColor" aria-hidden>
                    <rect x="0" y="7" width="3" height="5" rx="1" />
                    <rect x="5" y="5" width="3" height="7" rx="1" />
                    <rect x="10" y="2.5" width="3" height="9.5" rx="1" />
                    <rect x="15" y="0" width="3" height="12" rx="1" />
                    <rect x="24" y="1" width="20" height="10" rx="3" fill="none" stroke="currentColor" strokeWidth="1.2" />
                    <rect x="26" y="3" width="15" height="6" rx="1.5" />
                    <rect x="45" y="4" width="2" height="4" rx="1" />
                  </svg>
                </div>
              )}
              <iframe
                key={rev}
                ref={frame}
                title="Seite"
                srcDoc={srcDoc}
                onLoad={onLoad}
                sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                className="min-h-0 w-full flex-1 bg-white"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Pins liegen IN der Seite und wandern deshalb exakt mit. */}
      {layer &&
        createPortal(
          <>
            {visible.map((t) =>
              pos[t.id] ? (
                <button
                  key={t.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(t.id);
                    togglePanel(true); // Pin angeklickt → Kommentar zeigen
                  }}
                  title={t.body}
                  style={pinStyle(pos[t.id], t.status === "erledigt" ? "#16a34a" : "#e30613", selected === t.id)}
                >
                  {numberOf.get(t.id)}
                </button>
              ) : null,
            )}
            {draft && pos.new && <span style={pinStyle(pos.new, "#171717", true)}>+</span>}
          </>,
          layer,
        )}

      {draft && (
        <div style={popover({ x: draft.at.x + 14, y: draft.at.y + 14 }, 288)} className="rounded-xl border border-neutral-200 bg-white p-3 shadow-2xl">
          <textarea
            autoFocus
            rows={3}
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submitDraft();
            }}
            placeholder="Dein Kommentar …"
            className="w-full resize-y rounded-lg border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-sdg-red"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button onClick={() => setDraft(null)} className="rounded-lg px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-800">
              Abbrechen
            </button>
            <button onClick={submitDraft} disabled={busy || !draft.text.trim()} className="rounded-lg bg-sdg-red px-3 py-1.5 text-xs font-medium text-white hover:bg-sdg-red-dark disabled:opacity-50">
              Speichern
            </button>
          </div>
        </div>
      )}

      {pic && (
        <div style={popover(pic.at, 300)} className="rounded-xl border border-neutral-200 bg-white p-3 shadow-2xl">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-neutral-800">{pic.kind === "img" ? "Bild" : "Hintergrundbild"}</span>
            <button onClick={() => setPic(null)} className="text-neutral-400 hover:text-neutral-800" aria-label="Schließen">
              ✕
            </button>
          </div>
          <label className="mt-2 block cursor-pointer rounded-lg bg-sdg-red px-3 py-2 text-center text-sm font-medium text-white hover:bg-sdg-red-dark">
            Bild ersetzen …
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                void replaceImage(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <div className="mt-3 text-xs font-medium text-neutral-500">Ecken</div>
          <div className="mt-1 grid grid-cols-3 gap-1">
            {CORNERS.map(([name, value]) => (
              <button key={name} onClick={() => setCorners(value)} className="rounded-lg border border-neutral-200 px-2 py-1.5 text-xs text-neutral-700 hover:border-sdg-red hover:text-sdg-red">
                {name}
              </button>
            ))}
          </div>
          {pic.note && <p className="mt-2 text-xs text-neutral-600">{pic.note}</p>}
        </div>
      )}

      {panel && <StudioSidebar
        projectId={projectId}
        pageId={pageId}
        threads={threads}
        visible={visible}
        numberOf={numberOf}
        selected={selected}
        onSelect={jumpTo}
        showDone={showDone}
        onShowDone={setShowDone}
        readOnly={!!old}
        canComment={canComment}
        canEdit={canEdit}
        currentUserEmail={props.currentUserEmail}
        aiBusy={aiBusy}
        log={log}
        target={target}
        picking={mode === "pick"}
        onPick={() => (target ? setTarget(null) : toggle("pick"))}
        onAi={runAi}
        onUndo={undo}
      />}
    </div>
  );
}

function pinStyle(at: Pt, color: string, active: boolean): React.CSSProperties {
  return {
    all: "initial",
    position: "absolute",
    left: at.x,
    top: at.y,
    transform: "translate(-50%,-50%)",
    width: 26,
    height: 26,
    borderRadius: "50%",
    background: color,
    color: "#fff",
    border: "2px solid #fff",
    boxShadow: active ? `0 0 0 3px ${color}55, 0 2px 6px rgba(0,0,0,.45)` : "0 2px 6px rgba(0,0,0,.45)",
    font: "700 12px/22px system-ui,sans-serif",
    textAlign: "center",
    cursor: "pointer",
    boxSizing: "border-box",
  };
}
