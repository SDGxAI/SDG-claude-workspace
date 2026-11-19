"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ProjectStatus } from "@/types/database";
import { brandGradient } from "@/lib/ui/brandColor";

export interface ProjectCard {
  id: string;
  title: string;
  brand: string;
  status: ProjectStatus;
  updated_at: string;
  openComments?: number;
  isShopify?: boolean;
}

type SortKey = "date_desc" | "date_asc" | "brand";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "date_desc", label: "Datum (neueste zuerst)" },
  { value: "date_asc", label: "Datum (älteste zuerst)" },
  { value: "brand", label: "Marke (A–Z)" },
];

export function ProjectGrid({ projects }: { projects: ProjectCard[] }) {
  const [sort, setSort] = useState<SortKey>("date_desc");
  const [brandFilter, setBrandFilter] = useState<string>("");

  const brands = useMemo(
    () => Array.from(new Set(projects.map((p) => p.brand))).sort(),
    [projects],
  );

  const visible = useMemo(() => {
    const filtered = brandFilter
      ? projects.filter((p) => p.brand === brandFilter)
      : projects;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sort === "brand") {
        return a.brand.localeCompare(b.brand) || a.title.localeCompare(b.title);
      }
      const cmp =
        new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      return sort === "date_asc" ? cmp : -cmp;
    });
    return sorted;
  }, [projects, sort, brandFilter]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm text-neutral-600">
          Marke
          <select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="ml-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-sm shadow-sm outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20"
          >
            <option value="">Alle Marken</option>
            {brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm text-neutral-600">
          Sortierung
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="ml-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-sm shadow-sm outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <span className="ml-auto text-sm text-neutral-400">
          {visible.length} Projekt{visible.length === 1 ? "" : "e"}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-neutral-300 bg-white/70 p-8 text-center text-neutral-500">
          Keine Projekte gefunden.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="group flex flex-col overflow-hidden rounded-3xl border border-white bg-white shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-lg"
            >
              <div className={`relative flex h-24 items-end bg-gradient-to-br px-5 pb-3 ${brandGradient(project.brand)}`}>
                <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-700 backdrop-blur">
                  {project.brand}
                </span>
                {project.isShopify && (
                  <span className="ml-2 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-green-700 backdrop-blur">
                    🛍️ Shopify
                  </span>
                )}
                <span className="absolute right-4 top-3 text-xl opacity-0 transition group-hover:opacity-100">→</span>
              </div>
              <div className="flex flex-1 flex-col p-5">
                <h3 className="text-lg font-semibold leading-snug text-neutral-900 group-hover:text-sdg-red">
                  {project.title}
                </h3>
                {project.openComments ? (
                  <span className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    {project.openComments} offene{project.openComments === 1 ? "r" : ""} Kommentar
                    {project.openComments === 1 ? "" : "e"}
                  </span>
                ) : (
                  <span className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                    ✓ Alles erledigt
                  </span>
                )}
                <p className="mt-auto pt-5 text-xs text-neutral-400">
                  Aktualisiert am{" "}
                  {new Date(project.updated_at).toLocaleDateString("de-DE", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
