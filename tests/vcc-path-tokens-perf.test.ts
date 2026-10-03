import { describe, it, expect } from "vitest";
import { buildSections } from "../src/core/build-sections.js";
import type { NormalizedBlock } from "../src/types.js";

// Regression for the 49-minute `session_before_compact` hang: pathTokens used
// /[A-Za-z0-9_.$/-]*[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,5}\b/g, whose two adjacent
// overlapping classes backtrack over every (prefix, middle, start) triple on a
// long dotless alphanumeric run — cubic in run length (measured: 0.5 s at 1 KB,
// 4 s at 2 KB, 33 s at 4 KB). A single large tool result with a ~37 KB dotless
// run (table/JSON dumps do this) spun `session_before_compact` for 49 minutes.
// The rewritten two-phase scan is linear and must stay sub-second an order of
// magnitude beyond the real-world trigger. The 200k-case differential fuzz
// (old vs new, in review notes) proved the token sets are identical.

const result = (text: string, isError = false, name = "bash"): NormalizedBlock => ({
  kind: "tool_result",
  name,
  text,
  isError,
});

describe("pathTokens — catastrophic backtracking regression", () => {
  it("processes a 50 KB dotless tool result in well under a second", () => {
    const started = process.hrtime.bigint();
    buildSections({ blocks: [result("a".repeat(50_000))] });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    expect(elapsedMs).toBeLessThan(1_000);
  });

  it("processes a realistic numeric dump (no dots at all) quickly", () => {
    const rows = Array.from(
      { length: 4_000 },
      (_, i) => `${i} processed ok ${i * 7919} bytes total ${i * 104729} pending`,
    ).join("\n");
    expect(rows.length).toBeGreaterThan(30_000);
    const started = process.hrtime.bigint();
    buildSections({ blocks: [result(rows)] });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    expect(elapsedMs).toBeLessThan(1_000);
  });

  it("still extinguishes an error when a later success shares its path token", () => {
    const blocks: NormalizedBlock[] = [
      result("ENOENT: cannot open src/deep/nested/module/thing/target.file.ts", true, "read"),
      result("contents of src/deep/nested/module/thing/target.file.ts loaded", false, "read"),
    ];
    const r = buildSections({ blocks });
    expect(r.outstandingContext.join(" ")).not.toContain("target.file.ts");
  });

  it("keeps an error whose path token appears in no later success", () => {
    const blocks: NormalizedBlock[] = [
      result("failed to read src/deep/nested/module/thing/missing.file.ts", true, "read"),
      result("read src/deep/nested/module/thing/other.file.ts", false, "read"),
    ];
    const r = buildSections({ blocks });
    expect(r.outstandingContext.join(" ")).toContain("missing.file.ts");
  });
});
