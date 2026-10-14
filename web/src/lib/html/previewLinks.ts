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
 * Erkennt Cookie-/Zustimmungs-Banner am Inhalt und blendet sie aus (nur in der
 * Sites-Vorschau): schwebende Elemente (fixed/sticky) mit „Cookie“ und einem
 * Zustimmungs-/Ablehnen-Text, auch in offenen Shadow-DOMs.
 */
const COOKIE_KILLER = `(function(){
  var KW=/(cookie|consent|privacy|gdpr|dsgvo|pc__banner|cmp)/i, TXT=/cookie/i, ACT=/(zustimm|einwillig|akzept|accept|consent|ablehnen|decline|reject|einstellungen|preferences)/i;
  function txt(el){var t=el.textContent||"";try{if(el.shadowRoot){t+=" "+el.shadowRoot.textContent}}catch(e){}return t}
  function isFloating(el){try{var p=getComputedStyle(el).position;return p==="fixed"||p==="sticky"}catch(e){return false}}
  function hide(el){try{el.style.setProperty("display","none","important");el.setAttribute("data-sites-hidden","cookie")}catch(e){}}
  function check(el){if(!el||el.nodeType!==1||el.getAttribute("data-sites-hidden"))return;
    var name=(el.id||"")+" "+(typeof el.className==="string"?el.className:"")+" "+el.tagName;
    var t=txt(el);if(t.length>4000)return;
    if(TXT.test(t)&&ACT.test(t)&&(isFloating(el)||KW.test(name))){hide(el);return}
    if(el.shadowRoot&&KW.test(name)&&TXT.test(t)){hide(el)}}
  function scan(){var b=document.body;if(!b)return;var kids=b.children;for(var i=0;i<kids.length;i++){var k=kids[i];check(k);if(k.getAttribute("data-sites-hidden"))continue;var g=k.children;for(var j=0;j<g.length&&j<40;j++){check(g[j])}}}
  document.addEventListener("DOMContentLoaded",function(){scan();try{new MutationObserver(function(){scan()}).observe(document.body,{childList:true,subtree:false})}catch(e){}});
  var n=0,t=setInterval(function(){scan();if(++n>40)clearInterval(t)},500);
})();`;

/**
 * Kleines Hilfsskript für Vorschauen mit JavaScript:
 * - Speicher/Cookies durch harmlose Platzhalter ersetzen (sonst brechen
 *   Theme-Skripte in der abgeschotteten Vorschau ab)
 * - optional feste Fensterhöhe vortäuschen (die Vorschau ist so hoch wie die
 *   ganze Seite – Skripte sollen trotzdem mit einem normalen Bildschirm rechnen)
 * - die Seitenhöhe per postMessage an Sites melden
 */
function bridgeScript(fixedViewport: boolean, proxyBase?: string): string {
  // Live-Anfragen an den Shop (Preise, Produktlisten …) über Sites umleiten.
  const proxy = proxyBase
    ? `var P=${JSON.stringify(proxyBase)};var H="";try{H=new URL(document.baseURI).host}catch(e){}
  function rw(u){try{var x=new URL(String(u),document.baseURI);if(H&&x.host===H&&x.pathname.indexOf("/cdn/")!==0){return P+x.pathname+x.search}}catch(e){}return u}
  if(window.fetch){var of=window.fetch;window.fetch=function(i,o){try{if(typeof i==="string"||(window.URL&&i instanceof URL)){i=rw(i)}else if(i&&i.url){var n=rw(i.url);if(n!==i.url){i=new Request(n,i)}}}catch(e){}return of.call(this,i,o)}}
  if(window.XMLHttpRequest){var oo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){var a=Array.prototype.slice.call(arguments);a[1]=rw(u);return oo.apply(this,a)}}`
    : "";
  return `${COOKIE_KILLER}
(function(){
  ${proxy}
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
  opts: { allowScripts?: boolean; fixedViewport?: boolean; proxyBase?: string | null } = {},
): string {
  const linked = withBlankLinks(html);
  if (!opts.allowScripts) return linked;
  const tag = `<script>${bridgeScript(!!opts.fixedViewport, opts.proxyBase ?? undefined).replace(/<\//g, "<\\/")}</script>`;
  if (/<head[^>]*>/i.test(linked)) {
    // Direkt nach <head> (und einem evtl. <base>), vor allen Theme-Skripten.
    return linked.replace(/<head[^>]*>(\s*<base\b[^>]*>)?/i, (m) => `${m}${tag}`);
  }
  return tag + linked;
}

/**
 * Hilfsskript für die Live-Ansicht (echtes Scrollfenster): Live-Anfragen über
 * Sites umleiten, Speicher-Platzhalter, und Scrollposition + Seitenhöhe an
 * Sites melden, damit die Kommentar-Pins mitwandern. Sites kann umgekehrt
 * scrollen lassen (Sprung zu einem Kommentar, Mausrad im Kommentarmodus).
 */
export function liveBridgeScript(proxyBase: string, pagePath = "/"): string {
  return `${COOKIE_KILLER}
(function(){
  var P=${JSON.stringify(proxyBase)};var PAGE=${JSON.stringify(pagePath)};var H="";try{H=new URL(document.baseURI).host}catch(e){}
  var errs=[];
  function rep(t){t=String(t).slice(0,300);if(errs.indexOf(t)>=0||errs.length>=40)return;errs.push(t);try{parent.postMessage({sitesLiveError:t},"*")}catch(e){}}
  function short(u){try{var x=new URL(String(u),document.baseURI);return x.pathname+x.search}catch(e){return String(u)}}
  function rw(u){try{var x=new URL(String(u),document.baseURI);if(H&&x.host===H&&x.pathname.indexOf("/cdn/")!==0){var p=x.pathname;if(p.indexOf("/api/shopify/view/")===0){p=PAGE}return P+p+x.search}}catch(e){}return u}
  if(window.fetch){var of=window.fetch;window.fetch=function(i,o){var label="";try{if(typeof i==="string"||(window.URL&&i instanceof URL)){label=short(i);i=rw(i)}else if(i&&i.url){label=short(i.url);var n=rw(i.url);if(n!==i.url){i=new Request(n,i)}}}catch(e){}
    return of.call(this,i,o).then(function(r){if(!r.ok){rep("Abruf "+r.status+": "+label)}return r},function(err){rep("Abruf fehlgeschlagen: "+label);throw err})}}
  if(window.XMLHttpRequest){var oo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){var a=Array.prototype.slice.call(arguments);a[1]=rw(u);return oo.apply(this,a)}}
  ["pushState","replaceState"].forEach(function(n){var f=history[n];if(!f)return;history[n]=function(){try{return f.apply(history,arguments)}catch(e){}}});
  function mem(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}
  ["localStorage","sessionStorage"].forEach(function(n){try{window[n].getItem("x")}catch(e){try{Object.defineProperty(window,n,{value:mem(),configurable:true})}catch(_){}}});
  try{document.cookie}catch(e){try{var c="";Object.defineProperty(document,"cookie",{get:function(){return c},set:function(){},configurable:true})}catch(_){}}
  window.addEventListener("error",function(e){var t=e.target;if(t&&t!==window&&(t.src||t.href)){rep("Nicht geladen: "+short(t.src||t.href))}else{rep("Skriptfehler: "+(e.message||"?")+(e.filename?" ("+String(e.filename).split("/").pop()+":"+e.lineno+")":""))}},true);
  window.addEventListener("unhandledrejection",function(e){var r=e.reason;rep("Fehler: "+((r&&r.message)||r))});
  var last="";
  function send(){var d=document.documentElement,b=document.body;var h=Math.max(d?d.scrollHeight:0,b?b.scrollHeight:0);var s=window.scrollY||(d?d.scrollTop:0)||0;var v=window.innerHeight;var k=h+"|"+s+"|"+v;if(k!==last){last=k;try{parent.postMessage({sitesLive:{height:h,scroll:s,viewport:v}},"*")}catch(e){}}}
  window.addEventListener("scroll",send,{passive:true});window.addEventListener("resize",send);window.addEventListener("load",send);
  document.addEventListener("DOMContentLoaded",function(){send();if(window.ResizeObserver){try{new ResizeObserver(send).observe(document.body||document.documentElement)}catch(e){}}});
  setInterval(send,700);
  window.addEventListener("message",function(e){var m=e.data||{};if(typeof m.sitesScrollBy==="number"){window.scrollBy(0,m.sitesScrollBy)}if(typeof m.sitesScrollTo==="number"){window.scrollTo({top:m.sitesScrollTo,behavior:"smooth"})}});
})();`;
}
