/** Ladeansicht der Projektseite (Seite + Seitenleiste), erscheint sofort. */
export default function Loading() {
  return (
    <div className="w-full animate-pulse pb-8" aria-busy="true" aria-label="Lädt …">
      <div className="mx-auto max-w-6xl px-4 pt-6">
        <div className="h-4 w-20 rounded bg-neutral-200/60" />
        <div className="mt-3 h-8 w-72 max-w-full rounded-xl bg-neutral-200/70" />
      </div>
      <div className="mt-4 flex flex-col gap-4 px-4 lg:h-[max(560px,calc(100vh-8rem))] lg:flex-row">
        <div className="h-[70vh] flex-1 rounded-xl bg-white/80 shadow-sm lg:h-auto">
          <div className="h-11 border-b border-neutral-100" />
        </div>
        <div className="space-y-3 lg:w-[22rem]">
          <div className="h-36 rounded-xl bg-white/80 shadow-sm" />
          <div className="h-72 rounded-xl bg-white/80 shadow-sm" />
        </div>
      </div>
    </div>
  );
}
