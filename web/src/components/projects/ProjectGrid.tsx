"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { STATUS_BADGE_CLASSES, STATUS_LABELS } from "@/lib/status";
import type { ProjectStatus } from "@/types/database";

export interface ProjectCard {
  id: string;
  title: string;
  brand: string;
  status: ProjectStatus;
  updated_at: string;
  openComments?: number;
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
            className="ml-2 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20"
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
            className="ml-2 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20"
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
        <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-neutral-500">
          Keine Projekte gefunden.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="group flex flex-col rounded-xl border border-neutral-200 bg-white p-5 transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                  {project.brand}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[project.status]}`}
                >
                  {STATUS_LABELS[project.status]}
                </span>
              </div>
              <h3 className="mt-2 font-semibold text-neutral-900 group-hover:text-sdg-red">
                {project.title}
              </h3>
              {project.openComments ? (
                <span className="mt-2 inline-flex w-fit items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  {project.openComments} offene{project.openComments === 1 ? "r" : ""} Kommentar
                  {project.openComments === 1 ? "" : "e"}
                </span>
              ) : null}
              <p className="mt-auto pt-4 text-xs text-neutral-400">
                Aktualisiert:{" "}
                {new Date(project.updated_at).toLocaleDateString("de-DE", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
