import Link from "next/link";
import { PageContainer } from "@/components/PageContainer";
import { BriefingForm } from "@/components/briefings/BriefingForm";
import { SDG_BRANDS } from "@/lib/brands";

export default function NewBriefingPage() {
  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl">
        <Link href="/briefings" className="text-sm text-neutral-500 hover:text-sdg-red">
          ← Briefings
        </Link>
        <div className="mt-3 overflow-hidden rounded-3xl bg-gradient-to-br from-rose-100 via-orange-50 to-amber-50 p-7 sm:p-9">
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl">Dein Briefing in 5 Minuten ✍️</h1>
          <p className="mt-2 max-w-xl text-neutral-600">
            Erzähl uns kurz von deinem Produkt – den Rest machen wir. Stichpunkte reichen völlig.
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs font-medium text-neutral-700">
            {["⏱️ Kurz & knapp", "📸 Fotos & Videos", "✨ Text auf Wunsch per KI"].map((t) => (
              <span key={t} className="rounded-full bg-white/80 px-3 py-1.5 shadow-sm">
                {t}
              </span>
            ))}
          </div>
        </div>
        <div className="mt-6">
          <BriefingForm brands={[...SDG_BRANDS]} />
        </div>
      </div>
    </PageContainer>
  );
}
