/**
 * Sorgt dafür, dass Links/Buttons in einer Vorschau beim Klick in einem neuen
 * Browser-Tab öffnen (Ziel sichtbar), ohne die Vorschau selbst zu verlassen.
 * Fügt einmalig <base target="_blank"> in den <head> ein bzw. ergänzt ein
 * vorhandenes <base href> (z. B. bei Shopify-Seiten) um das Ziel.
 *
 * Nur für die Anzeige gedacht – NICHT im Export verwenden.
 */
export function withBlankLinks(html: string): string {
  const existing = /<base\b[^>]*>/i.exec(html);
  if (existing) {
    if (/\btarget\s*=/i.test(existing[0])) return html;
    return html.replace(existing[0], existing[0].replace(/<base\b/i, '<base target="_blank"'));
  }
  const base = '<base target="_blank">';
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}${base}`);
  }
  return base + html;
}

/**
 * Sandbox für Vorschau-iframes. Shopify-Themes brauchen JavaScript – dann
 * laufen Skripte, aber OHNE „allow-same-origin“: die Seite ist vollständig
 * von Sites abgeschottet (kein Zugriff auf Anmeldung, Cookies oder die App).
 */
export function previewSandbox(allowScripts: boolean): string {
  return allowScripts
    ? "allow-scripts allow-popups allow-popups-to-escape-sandbox"
    : "allow-same-origin allow-popups allow-popups-to-escape-sandbox";
}

/**
 * Kleines Hilfsskript für Vorschauen mit JavaScript:
 * - Speicher/Cookies durch harmlose Platzhalter ersetzen (sonst brechen
 *   Theme-Skripte in der abgeschotteten Vorschau ab)
 * - optional feste Fensterhöhe vortäuschen (die Vorschau ist so hoch wie die
 *   ganze Seite – Skripte sollen trotzdem mit einem normalen Bildschirm rechnen)
 * - die Seitenhöhe per postMessage an Sites melden
 */
function bridgeScript(fixedViewport: boolean): string {
  return `(function(){
  function mem(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}
  ["localStorage","sessionStorage"].forEach(function(n){try{window[n].getItem("x")}catch(e){try{Object.defineProperty(window,n,{value:mem(),configurable:true})}catch(_){}}});
  try{document.cookie}catch(e){try{var c="";Object.defineProperty(document,"cookie",{get:function(){return c},set:function(){},configurable:true})}catch(_){}}
  ${
    fixedViewport
      ? `try{Object.defineProperty(window,"innerHeight",{get:function(){return 900},configurable:true})}catch(e){}
  try{Object.defineProperty(document.documentElement,"clientHeight",{get:function(){return 900},configurable:true})}catch(e){}`
      : ""
  }
  var last=0;
  function send(){var d=document.documentElement,b=document.body;var h=Math.max(d?d.scrollHeight:0,b?b.scrollHeight:0);if(h&&h!==last){last=h;try{parent.postMessage({sitesPreviewHeight:h},"*")}catch(e){}}}
  document.addEventListener("DOMContentLoaded",function(){send();if(window.ResizeObserver){try{new ResizeObserver(send).observe(document.body||document.documentElement)}catch(e){}}});
  window.addEventListener("load",send);
  var n=0,t=setInterval(function(){send();if(++n>60)clearInterval(t)},500);
})();`;
}

/** srcDoc für eine Vorschau (Links im neuen Tab; bei Skripten mit Hilfsskript). */
export function previewSrcDoc(
  html: string,
  opts: { allowScripts?: boolean; fixedViewport?: boolean } = {},
): string {
  const linked = withBlankLinks(html);
  if (!opts.allowScripts) return linked;
  const tag = `<script>${bridgeScript(!!opts.fixedViewport)}</script>`;
  if (/<head[^>]*>/i.test(linked)) {
    // Direkt nach <head> (und einem evtl. <base>), vor allen Theme-Skripten.
    return linked.replace(/<head[^>]*>(\s*<base\b[^>]*>)?/i, (m) => `${m}${tag}`);
  }
  return tag + linked;
}
