import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-sdg-red">
          Nicht gefunden
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-neutral-900">
          Diese Seite gibt es nicht
        </h1>
        <p className="mt-2 text-neutral-500">
          Möglicherweise wurde das Projekt entfernt oder du hast keinen
          Zugriff darauf.
        </p>
        <Link
          href="/projects"
          className="mt-6 inline-block rounded-lg bg-sdg-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdg-red-dark"
        >
          Zur Projektübersicht
        </Link>
      </div>
    </main>
  );
}
