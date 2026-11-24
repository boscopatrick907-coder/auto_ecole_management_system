import { expect, it } from "vitest";
import { clock, timeLeft, toggleLetter } from "../src/app/core/exam-sheet";

it("answer letters toggle and stay sorted (several letters allowed)", () => {
  expect(toggleLetter("", "B")).toBe("B");
  expect(toggleLetter("B", "A")).toBe("AB");
  expect(toggleLetter("ABD", "B")).toBe("AD");
});

it("the timer never goes negative and reads like a clock", () => {
  expect(timeLeft(1000, 5000)).toBe(0);
  expect(timeLeft(65000, 5000)).toBe(60000);
  expect(clock(60 * 60000)).toBe("1:00:00");
  expect(clock(59 * 60000 + 58000)).toBe("59:58");
  expect(clock(4500)).toBe("00:05");
});
