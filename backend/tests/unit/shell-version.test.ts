import { describe, expect, it } from "vitest";
import { shellVersion } from "../../src/tenant/worker.js";

describe("shellVersion", () => {
  it("returns a deterministic 16-char hex tag for identical index.html shells", () => {
    const html = '<!doctype html><html><script src="main-AAA111.js"></script></html>';
    const a = shellVersion(html);
    const b = shellVersion(html);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes whenever bundle script or stylesheet hashes change", () => {
    const v1 = shellVersion('<!doctype html><html><script src="main-AAA111.js"></script></html>');
    const v2 = shellVersion('<!doctype html><html><script src="main-BBB222.js"></script></html>');
    expect(v1).not.toBe(v2);
  });
});
