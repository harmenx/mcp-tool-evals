import { describe, expect, it } from "vitest";
import { findRegressions, readSuccessRates, renderDiff } from "../src/baseline.js";
import { UserError } from "../src/errors.js";

const baseline = [
  { name: "mock", taskSuccessRate: 1 },
  { name: "other", taskSuccessRate: 0.8 },
];

describe("findRegressions", () => {
  it("ignores a drop inside the threshold and an improvement", () => {
    const current = [
      { name: "mock", taskSuccessRate: 0.96 },
      { name: "other", taskSuccessRate: 0.9 },
    ];
    expect(findRegressions(current, baseline, 0.05)).toEqual([]);
  });

  it("flags a drop past the threshold and a missing model", () => {
    const found = findRegressions([{ name: "mock", taskSuccessRate: 0.9 }], baseline, 0.05);
    expect(found.map((item) => item.name).sort()).toEqual(["mock", "other"]);
    expect(found.find((item) => item.name === "other")?.currentRate).toBe(0);
  });

  it("rejects a threshold outside 0 to 1", () => {
    expect(() => findRegressions([], [], 5)).toThrow(UserError);
  });
});

describe("readSuccessRates", () => {
  it("reads a full report and a slim baseline", () => {
    expect(readSuccessRates({ models: [{ name: "mock", taskSuccessRate: 1 }] })).toEqual([
      { name: "mock", taskSuccessRate: 1, tasks: undefined, successes: undefined },
    ]);
    expect(
      readSuccessRates({
        models: [{ name: "mock", summary: { taskSuccessRate: 0.5, tasks: 4, successes: 2 } }],
      }),
    ).toEqual([{ name: "mock", taskSuccessRate: 0.5, tasks: 4, successes: 2 }]);
  });

  it("prints a readable comparison", () => {
    const text = renderDiff([{ name: "mock", taskSuccessRate: 1 }], [{ name: "mock", taskSuccessRate: 1 }], 0);
    expect(text).toContain("| mock | 100% | 100% | 0% (ok) |");
    expect(text).toContain("No model dropped");
  });
});
