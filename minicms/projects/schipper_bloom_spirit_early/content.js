/*
  Schipper – Bloom Spirit / Early Access
  --------------------------------------
  ES-Modul. Hängt nichts an `window`, greift nicht auf `document.body` zu und
  registriert keine Custom Elements. Sämtliche DOM-Zugriffe laufen über den
  übergebenen Wurzelknoten (ShadowRoot), damit mehrere Instanzen derselben
  Seite unabhängig voneinander laufen.

  TODO AGENTS.md: Einstiegskonvention prüfen. Angenommen wird, dass MiniCMS
  den Default-Export mit dem ShadowRoot (oder dem Host-Element) aufruft.
  Falls das Modul stattdessen z. B. ein benanntes `init` erwartet, ist nur
  der Export unten anzupassen – die Logik bleibt unverändert.
*/

const SELECTORS = {
  root: '[data-bse-root]',
  countdown: '[data-bse-countdown]',
  countdownField: '[data-bse-cd]',
  scrollTrigger: '[data-bse-scroll-to]',
  form: '[data-bse-form]',
  formView: '[data-bse-form-view]',
  successView: '[data-bse-success-view]',
  error: '[data-bse-error]',
};

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function pad(value) {
  return value < 10 ? `0${value}` : String(value);
}

function initCountdown(root) {
  const container = root.querySelector(SELECTORS.countdown);
  const host = root.querySelector(SELECTORS.root);
  if (!container || !host) return () => {};

  const target = Date.parse(host.dataset.bseTarget || '');
  if (Number.isNaN(target)) return () => {};

  const fields = {};
  container.querySelectorAll(SELECTORS.countdownField).forEach((el) => {
    fields[el.dataset.bseCd] = el;
  });

  let timer = null;

  const tick = () => {
    const diff = Math.max(0, target - Date.now());
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);

    if (fields.days) fields.days.textContent = pad(days);
    if (fields.hours) fields.hours.textContent = pad(hours);
    if (fields.minutes) fields.minutes.textContent = pad(minutes);
    if (fields.seconds) fields.seconds.textContent = pad(seconds);

    if (diff === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  tick();
  timer = setInterval(tick, 1000);

  return () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
}

function initScrollLinks(root) {
  const triggers = Array.from(root.querySelectorAll(SELECTORS.scrollTrigger));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const onClick = (event) => {
    const name = event.currentTarget.dataset.bseScrollTo;
    const target = root.querySelector(`[data-bse-section="${name}"]`);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  };

  triggers.forEach((el) => el.addEventListener('click', onClick));
  return () => triggers.forEach((el) => el.removeEventListener('click', onClick));
}

function initSignupForm(root) {
  const form = root.querySelector(SELECTORS.form);
  const formView = root.querySelector(SELECTORS.formView);
  const successView = root.querySelector(SELECTORS.successView);
  const errorBox = root.querySelector(SELECTORS.error);
  if (!form || !formView || !successView || !errorBox) return () => {};

  const firstnameField = form.querySelector('[data-bse-field="firstname"]');
  const emailField = form.querySelector('[data-bse-field="email"]');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const onSubmit = (event) => {
    event.preventDefault();

    const firstname = (firstnameField?.value || '').trim();
    const email = (emailField?.value || '').trim();

    if (!firstname) {
      errorBox.textContent = form.dataset.bseMsgFirstname || '';
      firstnameField?.focus();
      return;
    }
    if (!EMAIL_PATTERN.test(email)) {
      errorBox.textContent = form.dataset.bseMsgEmail || '';
      emailField?.focus();
      return;
    }

    errorBox.textContent = '';

    /*
      TODO D2S: Hier gehört die Übergabe an den ESP (Salesforce Marketing
      Cloud) über den vorgesehenen Interposer hin – Consent-gewrappt via
      Klaro. Aktuell verlässt bewusst KEIN Datensatz den Browser; die Seite
      darf in diesem Zustand nicht live gehen.
    */

    formView.hidden = true;
    successView.hidden = false;
    successView.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  };

  form.addEventListener('submit', onSubmit);
  return () => form.removeEventListener('submit', onSubmit);
}

/**
 * @param {ShadowRoot|HTMLElement} target ShadowRoot oder Host-Element der Instanz.
 * @returns {() => void} Aufräumfunktion (Timer und Listener der Instanz).
 */
export function init(target) {
  const root = target && target.shadowRoot ? target.shadowRoot : target;
  if (!root || typeof root.querySelector !== 'function') return () => {};

  const teardowns = [
    initCountdown(root),
    initScrollLinks(root),
    initSignupForm(root),
  ];

  return () => teardowns.forEach((fn) => fn());
}

export default init;
