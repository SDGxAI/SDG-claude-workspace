"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { uploadAvatar, removeAvatar } from "@/lib/actions/avatar";

export function AvatarUpload({ initialUrl }: { initialUrl: string | null }) {
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRemove() {
    setError(null);
    setRemoving(true);
    const result = await removeAvatar();
    setRemoving(false);
    if (result.ok) {
      setUrl(null);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    const result = await uploadAvatar(formData);
    setUploading(false);
    if (result.ok) {
      setUrl(result.url);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-neutral-200 bg-neutral-100">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="Profilbild" className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs text-neutral-400">Kein Bild</span>
        )}
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-block cursor-pointer rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:border-sdg-red hover:text-sdg-red">
            {uploading
              ? "Wird hochgeladen …"
              : url
                ? "Bild ändern"
                : "Profilbild hochladen"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading || removing}
              onChange={handleFile}
            />
          </label>
          {url && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={uploading || removing}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 hover:border-sdg-red hover:text-sdg-red disabled:opacity-50"
            >
              {removing ? "Wird entfernt …" : "Bild entfernen"}
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-neutral-400">PNG, JPG, WebP oder GIF, max. 5 MB.</p>
        {error && <p className="mt-1 text-xs text-sdg-red-dark">{error}</p>}
      </div>
    </div>
  );
}
