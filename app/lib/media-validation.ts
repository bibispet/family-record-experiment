import { HttpError } from "./api";

export type MediaKind = "photo" | "voice";
export type ValidatedMedia = { bytes: ArrayBuffer; contentType: string; size: number; extension: string };

export const PHOTO_LIMIT = 10 * 1024 * 1024;
export const VOICE_LIMIT = 25 * 1024 * 1024;

function starts(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((value, index) => bytes[offset + index] === value);
}

export async function validateMedia(file: File, kind: MediaKind): Promise<ValidatedMedia> {
  const limit = kind === "photo" ? PHOTO_LIMIT : VOICE_LIMIT;
  if (file.size === 0) throw new HttpError(400, "The selected file is empty.", "empty_file");
  if (file.size > limit) {
    throw new HttpError(413, `${kind === "photo" ? "Photos" : "Voice notes"} must be smaller than ${limit / 1024 / 1024} MB.`, "file_too_large");
  }

  const bytes = await file.arrayBuffer();
  const contents = new Uint8Array(bytes);
  const detected = kind === "photo" ? detectPhoto(contents) : detectAudio(contents);
  if (!detected) {
    throw new HttpError(
      400,
      kind === "photo"
        ? "Use a JPEG, PNG, or WebP photo."
        : "Use an MP3, WAV, M4A, or WebM voice note.",
      "unsupported_file",
    );
  }
  return { bytes, size: file.size, ...detected };
}

function detectPhoto(bytes: Uint8Array) {
  if (
    bytes.length >= 16 && starts(bytes, [0xff, 0xd8, 0xff]) &&
    bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9
  ) return { contentType: "image/jpeg", extension: "jpg" };
  if (
    bytes.length >= 33 && starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) &&
    starts(bytes, [0x49, 0x48, 0x44, 0x52], 12) && readU32Be(bytes, 16) > 0 && readU32Be(bytes, 20) > 0 &&
    starts(bytes, [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82], bytes.length - 12)
  ) return { contentType: "image/png", extension: "png" };
  if (
    bytes.length >= 20 && starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8) &&
    ["VP8 ", "VP8L", "VP8X"].includes(String.fromCharCode(...bytes.slice(12, 16))) && readU32Le(bytes, 4) + 8 <= bytes.length
  ) {
    return { contentType: "image/webp", extension: "webp" };
  }
  return null;
}

function detectAudio(bytes: Uint8Array) {
  if (bytes.length >= 128 && (starts(bytes, [0x49, 0x44, 0x33]) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) {
    return { contentType: "audio/mpeg", extension: "mp3" };
  }
  if (bytes.length >= 44 && starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x41, 0x56, 0x45], 8) && readU32Le(bytes, 4) + 8 <= bytes.length) {
    return { contentType: "audio/wav", extension: "wav" };
  }
  if (bytes.length >= 32 && starts(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return { contentType: "audio/webm", extension: "webm" };
  if (bytes.length >= 24 && starts(bytes, [0x66, 0x74, 0x79, 0x70], 4) && readU32Be(bytes, 0) >= 16 && readU32Be(bytes, 0) <= bytes.length) {
    return { contentType: "audio/mp4", extension: "m4a" };
  }
  return null;
}

function readU32Be(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

function readU32Le(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}
