/*
  Schipper – Bloom Spirit / Early Access

  ES-Modul nach MiniCMS-Konvention: liest die drei URL-Parameter, wartet auf
  den ShadowRoot und initialisiert jede Instanz einzeln. Kein Zugriff auf
  window/document ausser dem erlaubten getElementById(data_src_ref).
*/

const import_params = new URL(import.meta.url).searchParams;
const top_el_ref = import_params.get("top_el_ref");
const top_el_ref_shadow_inner_dst = import_params.get("top_el_ref_shadow_inner_dst");
const data_src_ref = import_params.get("data_src_ref");

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function pad(value) {
  return value < 10 ? `0${value}` : String(value);
}

function read_data() {
  const node = document.getElementById(data_src_ref);
  if (!node) return {};
  try {
    return JSON.parse(decodeURIComponent(node.innerHTML));
  } catch (error) {
    return {};
  }
}

function init_countdown(root) {
  const container = root.querySelector("[data-sbs-countdown]");
  if (!container) return;

  const target = Date.parse(container.dataset.sbsCountdown || "");
  if (Number.isNaN(target)) return;

  const fields = {};
  container.querySelectorAll("[data-sbs-cd]").forEach((el) => {
    fields[el.dataset.sbsCd] = el;
  });

  let timer = null;

  const tick = () => {
    const diff = Math.max(0, target - Date.now());
    const values = {
      days: Math.floor(diff / 86400000),
      hours: Math.floor((diff % 86400000) / 3600000),
      minutes: Math.floor((diff % 3600000) / 60000),
      seconds: Math.floor((diff % 60000) / 1000),
    };
    for (const [name, el] of Object.entries(fields)) {
      el.textContent = pad(values[name]);
    }
    if (diff === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  tick();
  timer = setInterval(tick, 1000);
}

function init_scroll_links(root) {
  const reduce_motion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  root.querySelectorAll("[data-sbs-scroll-to]").forEach((el) => {
    el.addEventListener("click", (event) => {
      const target = root.querySelector(`[data-sbs-section="${el.dataset.sbsScrollTo}"]`);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: reduce_motion ? "auto" : "smooth", block: "start" });
    });
  });
}

function init_signup(root, translations) {
  const form = root.querySelector("[data-sbs-form]");
  const form_view = root.querySelector("[data-sbs-form-view]");
  const success_view = root.querySelector("[data-sbs-success-view]");
  const error_box = root.querySelector("[data-sbs-error]");
  if (!form || !form_view || !success_view || !error_box) return;

  const firstname_field = form.querySelector('[data-sbs-field="firstname"]');
  const email_field = form.querySelector('[data-sbs-field="email"]');
  const reduce_motion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const t = (key) => translations?.[key] ?? "";

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const firstname = (firstname_field?.value || "").trim();
    const email = (email_field?.value || "").trim();

    if (!firstname) {
      error_box.textContent = t("signup.error_firstname");
      firstname_field?.focus();
      return;
    }
    if (!EMAIL_PATTERN.test(email)) {
      error_box.textContent = t("signup.error_email");
      email_field?.focus();
      return;
    }

    error_box.textContent = "";

    /*
      TODO D2S: Anmeldung laeuft noch nicht an den ESP. Vorgesehen ist
      @shared/newsletter.twig – bis dahin verlaesst bewusst kein Datensatz
      den Browser und die Seite darf nicht live gehen.
    */

    form_view.hidden = true;
    success_view.hidden = false;
    success_view.scrollIntoView({ behavior: reduce_motion ? "auto" : "smooth", block: "center" });
  });
}

function init(root) {
  const data = read_data();
  init_countdown(root);
  init_scroll_links(root);
  init_signup(root, data.translations);
}

function wait_for_ready() {
  const top_el = document?.getElementById(top_el_ref)?.shadowRoot?.getElementById(top_el_ref_shadow_inner_dst);
  if (top_el == null) {
    setTimeout(wait_for_ready, 60);
    return;
  }
  init(top_el);
}

if (top_el_ref !== null && top_el_ref_shadow_inner_dst !== null) {
  wait_for_ready();
}
