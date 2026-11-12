/**
 * Bilder vor dem Hochladen im Browser verkleinern: sehr große Fotos (z. B.
 * direkt aus der Kamera) werden auf max. 2400 px Kantenlänge als WebP
 * gespeichert – das hält Landingpages schnell und die Qualität bleibt fürs
 * Web voll ausreichend. SVG/GIF und bereits kleine Bilder bleiben unverändert.
 */
const MAX_EDGE = 2400;
const KEEP_BELOW_BYTES = 1.5 * 1024 * 1024;

export async function prepareImageForUpload(file: File): Promise<File> {
  if (file.type === "image/svg+xml" || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= MAX_EDGE && file.size <= KEEP_BELOW_BYTES) {
      bitmap.close();
      return file;
    }
    const scale = Math.min(1, MAX_EDGE / longest);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.86),
    );
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[a-z0-9]+$/i, "") + ".webp";
    return new File([blob], name, { type: "image/webp" });
  } catch {
    return file; // z. B. HEIC, das der Browser nicht lesen kann → Server prüft
  }
}
