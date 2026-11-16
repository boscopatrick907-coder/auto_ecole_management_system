export const MAX_MATERIAL_BYTES = 25 * 1024 * 1024;
export type MaterialKind = "pdf" | "image" | "video" | "link";
export interface AdminResource {
  id: string;
  licence_category_id: string;
  title: string;
  description: string;
  type: MaterialKind;
  storage_path: string | null;
  external_url: string | null;
  is_published: boolean;
}
export interface AuthorQuestion {
  id?: string;
  body: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  imageUrl: string | null;
}
export interface AdminQuiz {
  id: string;
  licence_category_id: string;
  title: string;
  duration_minutes: number;
  is_published: boolean;
  questions: Array<{
    id: string;
    body: string;
    options: string[];
    correct_index: number;
    explanation: string;
    image_url: string | null;
    position: number;
  }>;
}
export function validateMaterial(
  file: Pick<File, "size" | "type">,
  kind: MaterialKind,
): string | null {
  if (file.size <= 0 || file.size > MAX_MATERIAL_BYTES)
    return "Le fichier doit contenir entre 1 octet et 25 Mo.";
  const expected =
    kind === "pdf"
      ? ["application/pdf"]
      : kind === "video"
        ? ["video/mp4"]
        : kind === "image"
          ? ["image/png", "image/jpeg", "image/webp"]
          : [];
  return expected.includes(file.type)
    ? null
    : "Format non autorisé pour ce support. Utilisez PDF, PNG, JPEG, WebP ou MP4.";
}
export function questionValid(q: AuthorQuestion): boolean {
  return (
    q.body.trim().length >= 2 &&
    q.body.trim().length <= 1000 &&
    q.options.length >= 2 &&
    q.options.length <= 6 &&
    q.options.every((o) => o.trim().length > 0 && o.trim().length <= 500) &&
    Number.isInteger(q.correctIndex) &&
    q.correctIndex >= 0 &&
    q.correctIndex < q.options.length &&
    q.explanation.length <= 2000 &&
    (!q.imageUrl || /^https:\/\//.test(q.imageUrl))
  );
}
