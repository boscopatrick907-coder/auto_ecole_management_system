import { it, expect } from "vitest";
import { formatCode, activationLink, activationMessage, normalizePhone } from "../src/app/core/activation";

it("normalizes the ways people type a Cameroon number", () => {
  for (const typed of ["699123456", "6 99 12 34 56", "699-12-34-56", "237699123456", "00237699123456", "+237 699 12 34 56"])
    expect(normalizePhone(typed)).toBe("+237699123456");
  expect(normalizePhone("222123456")).toBe("+237222123456");
  expect(normalizePhone("12345")).toBe("12345");
});

it("formats 6-digit desk codes as 482 913", () => {
  expect(formatCode("482913")).toBe("482 913");
  expect(formatCode("482 913")).toBe("482 913");
  expect(formatCode("482-913")).toBe("482 913");
});

it("still formats older 8-character codes as XXXX-XXXX", () => {
  expect(formatCode("k7q4m2px")).toBe("K7Q4-M2PX");
  expect(formatCode("K7Q4-M2PX")).toBe("K7Q4-M2PX");
  expect(formatCode(" k7q4 m2px ")).toBe("K7Q4-M2PX");
});

it("builds an activation link and WhatsApp text without exposing more than the code and phone", () => {
  const link = activationLink("https://app.example", "la-marseillaise", "482913", "+237699123456");
  expect(link).toBe("https://app.example/s/la-marseillaise/activation?code=482913&tel=699123456");
  const welcome = activationMessage("AEM", "482913", "+237699123456", link);
  expect(welcome).toContain("482 913");
  expect(welcome).toContain("7 jours");
  expect(activationMessage("AEM", "482913", "+237699123456", link, true)).toContain("2 jours");
});
