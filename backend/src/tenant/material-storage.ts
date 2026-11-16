import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import type { TenantBindings } from "./context.js";
export const MAX_MATERIAL_BYTES = 25 * 1024 * 1024;
export const MATERIAL_TYPES = {
  "application/pdf": "pdf",
  "video/mp4": "video",
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
} as const;
const fail = (code: string, status = 400) =>
  Object.assign(new Error(code), { status });
export function isUploadKey(schoolId: string, key: string): boolean {
  return new RegExp(
    `^${schoolId}/resources/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[a-zA-Z0-9._-]{1,120}$`,
  ).test(key);
}
export function materialStorage(env: TenantBindings) {
  if (
    !env.R2_ACCOUNT_ID ||
    !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY ||
    !env.R2_BUCKET_NAME
  )
    throw fail("STORAGE_UNCONFIGURED", 503);
  return new S3Client({
    region: "auto",
    requestChecksumCalculation: "WHEN_REQUIRED",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
}
export function matchesMaterialSignature(mime: string, b: Uint8Array): boolean {
  const text = (s: number, e: number) =>
    new TextDecoder().decode(b.slice(s, e));
  switch (mime) {
    case "application/pdf":
      return text(0, 5) === "%PDF-";
    case "image/png":
      return [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v);
    case "image/jpeg":
      return b[0] === 255 && b[1] === 216 && b[2] === 255;
    case "image/webp":
      return text(0, 4) === "RIFF" && text(8, 12) === "WEBP";
    case "video/mp4":
      return text(4, 8) === "ftyp";
    default:
      return false;
  }
}
export async function verifyMaterial(
  env: TenantBindings,
  key: string,
  kind: string,
) {
  const s3 = materialStorage(env);
  try {
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
    );
    const mime = head.ContentType || "";
    if (!head.ContentLength || head.ContentLength > MAX_MATERIAL_BYTES)
      throw fail("INVALID_FILE_SIZE");
    if (
      !(mime in MATERIAL_TYPES) ||
      MATERIAL_TYPES[mime as keyof typeof MATERIAL_TYPES] !== kind
    )
      throw fail("INVALID_FILE_TYPE");
    const sample = await s3.send(
      new GetObjectCommand({
        Bucket: env.R2_BUCKET_NAME,
        Key: key,
        Range: "bytes=0-31",
      }),
    );
    if (
      !sample.Body ||
      !matchesMaterialSignature(mime, await sample.Body.transformToByteArray())
    )
      throw fail("INVALID_FILE_TYPE");
  } catch (error) {
    if ((error as { status?: number }).status) throw error;
    if (
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === 404
    )
      throw fail("UPLOAD_NOT_FOUND");
    throw fail("STORAGE_UNAVAILABLE", 503);
  } finally {
    s3.destroy();
  }
}
