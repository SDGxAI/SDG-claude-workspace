/** Sofortige Rückmeldung beim Seitenwechsel, während der Server lädt. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl animate-pulse px-4 py-8" aria-busy="true" aria-label="Lädt …">
      <div className="h-9 w-64 rounded-xl bg-neutral-200/70" />
      <div className="mt-3 h-4 w-80 max-w-full rounded-lg bg-neutral-200/50" />
      <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="overflow-hidden rounded-3xl bg-white/80 shadow-sm">
            <div className="aspect-[16/10] bg-neutral-200/50" />
            <div className="space-y-3 p-5">
              <div className="h-5 w-3/4 rounded-lg bg-neutral-200/70" />
              <div className="h-4 w-1/3 rounded-full bg-neutral-200/50" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
