import { it, expect } from "vitest";
import {
  validateMaterial,
  questionValid,
  MAX_MATERIAL_BYTES,
} from "../src/app/core/content";
it("rejects empty, oversized, unsupported and mismatched materials", () => {
  expect(
    validateMaterial({ size: 0, type: "application/pdf" }, "pdf"),
  ).toBeTruthy();
  expect(
    validateMaterial(
      { size: MAX_MATERIAL_BYTES + 1, type: "application/pdf" },
      "pdf",
    ),
  ).toBeTruthy();
  expect(
    validateMaterial({ size: 100, type: "text/html" }, "pdf"),
  ).toBeTruthy();
  expect(
    validateMaterial({ size: 100, type: "image/png" }, "pdf"),
  ).toBeTruthy();
  for (const [type, kind] of [
    ["application/pdf", "pdf"],
    ["image/png", "image"],
    ["video/mp4", "video"],
  ] as const)
    expect(validateMaterial({ size: 100, type }, kind)).toBeNull();
});
it("requires complete quiz choices and a valid answer index", () => {
  const q = {
    body: "Question ?",
    options: ["Oui", "Non"],
    correctIndex: 1,
    explanation: "Explication",
    imageUrl: null,
  };
  expect(questionValid(q)).toBe(true);
  expect(questionValid({ ...q, correctIndex: 2 })).toBe(false);
  expect(questionValid({ ...q, options: ["Oui", ""] })).toBe(false);
  expect(questionValid({ ...q, imageUrl: "javascript:alert(1)" })).toBe(false);
});
