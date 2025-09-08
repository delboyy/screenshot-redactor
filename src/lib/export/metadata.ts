import { devLog } from "@/lib/dev";

function includesAscii(haystack: Uint8Array, needle: string): boolean {
  const pat = new TextEncoder().encode(needle);
  outer: for (let i = 0; i + pat.length <= haystack.length; i++) {
    for (let j = 0; j < pat.length; j++) {
      if (haystack[i + j] !== pat[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Dev-only verification that export blobs lack common metadata markers (EXIF/XMP).
 * Browsers normally do not preserve metadata when re-encoding via canvas,
 * but we surface a warning in development if markers are detected.
 */
export async function devAssertNoMetadata(blob: Blob, mime: string): Promise<void> {
  if (typeof process === "undefined" || process.env.NODE_ENV !== "development") return;
  try {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const hasExif = includesAscii(bytes, "Exif"); // JPEG APP1 or TIFF tag
    const hasXmp = includesAscii(bytes, "http://ns.adobe.com/xap/1.0/");
    const hasPngExif = includesAscii(bytes, "eXIf"); // PNG eXIf chunk
    if (hasExif || hasXmp || hasPngExif) {
      devLog(`[export] metadata marker found in ${mime}:` +
        ` exif=${hasExif}, xmp=${hasXmp}, png-exif=${hasPngExif}`);
    }
  } catch {
    // ignore
  }
}

