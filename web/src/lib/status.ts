import type { ProjectStatus } from "@/types/database";

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  entwurf: "Entwurf",
  in_review: "In Review",
  live: "Live",
};

export const STATUS_BADGE_CLASSES: Record<ProjectStatus, string> = {
  entwurf: "bg-neutral-100 text-neutral-700",
  in_review: "bg-amber-100 text-amber-800",
  live: "bg-green-100 text-green-800",
};

export const STATUS_ORDER: ProjectStatus[] = ["entwurf", "in_review", "live"];
