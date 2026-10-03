import test from "node:test";
import assert from "node:assert/strict";
import { run } from "../project.mjs";
import { ValidationError } from "../lib/validate.mjs";

const demo = { generate: async (spec) => spec.demo() };
const profile = (csv) => run({ csv }, demo);

test("numeric quartiles use linear interpolation and standard deviation uses n-1", async () => {
  const result = await profile("value\n1\n2\n3\n4");
  const column = result.columns[0];
  assert.equal(column.type, "number");
  assert.deepEqual(
    { ...column.numeric, std: null },
    {
      min: 1,
      q1: 1.75,
      median: 2.5,
      q3: 3.25,
      max: 4,
      mean: 2.5,
      std: null,
      outliers: 0,
    },
  );
  assert.ok(Math.abs(column.numeric.std - Math.sqrt(5 / 3)) < 1e-12);
});

test("numeric histogram has ten consistent equal-width bins and includes max in the final bin", async () => {
  const result = await profile(
    "value\n" + Array.from({ length: 11 }, (_, index) => index).join("\n"),
  );
  const bins = result.columns[0].distribution;
  assert.equal(bins.length, 10);
  assert.deepEqual(bins[0], { label: "[0, 1)", value: 1 });
  assert.deepEqual(bins[9], { label: "[9, 10]", value: 2 });
  assert.equal(
    bins.reduce((sum, bin) => sum + bin.value, 0),
    11,
  );
});

test("IQR outliers require four values and small samples keep std null only below two values", async () => {
  const outlier = await profile("value\n0\n0\n0\n0\n10");
  assert.equal(outlier.columns[0].numeric.outliers, 1);
  assert.ok(outlier.warnings.length > 0);
  const small = await profile("value\n3");
  assert.equal(small.columns[0].numeric.std, null);
  assert.equal(small.columns[0].numeric.outliers, 0);
  assert.deepEqual(small.columns[0].distribution, [{ label: "3", value: 1 }]);
  assert.ok(
    small.columns[0].issues.some((issue) => issue.includes("样本过少")),
  );
});

test("missing whitespace, zero, false and all-empty columns follow explicit rules", async () => {
  const result = await profile("zero,flag,empty\n0,false,\n0,true, \n, false,");
  assert.deepEqual(result.summary, {
    rows: 3,
    columns: 3,
    cells: 9,
    missingCells: 4,
    missingRate: 4 / 9,
    duplicateRows: 0,
  });
  assert.equal(result.columns[0].count, 2);
  assert.equal(result.columns[0].numeric.mean, 0);
  assert.equal(result.columns[1].type, "boolean");
  assert.equal(result.columns[1].unique, 3);
  assert.equal(result.columns[2].type, "empty");
  assert.deepEqual(result.columns[2].distribution, []);
});

test("duplicate rows count extra occurrences and unique values preserve exact original text", async () => {
  const result = await profile("a,b\nx,1\nx,1\nx,1\nx,1.0\nx, 1");
  assert.equal(result.summary.duplicateRows, 2);
  assert.equal(result.columns[1].unique, 3);
  assert.ok(
    result.issues.some(
      (issue) => issue.column === null && issue.message.includes("重复"),
    ),
  );
  assert.ok(result.columns[0].issues.some((issue) => issue.includes("常量列")));
});

test("dates are validated against the actual calendar including leap-year century rules", async () => {
  assert.equal(
    (await profile("date\n2024-02-29\n2000-02-29")).columns[0].type,
    "date",
  );
  for (const value of [
    "2025-02-29",
    "1900-02-29",
    "2026-04-31",
    "2026-13-01",
    "0000-01-01",
  ]) {
    const result = await profile(`date\n${value}`);
    assert.equal(result.columns[0].type, "text");
    assert.ok(
      result.columns[0].issues.some((issue) => issue.includes("日历校验")),
    );
  }
});

test("mixed numeric text is flagged, 0/1 stays numeric, and category distributions are capped at ten", async () => {
  const mixed = await profile("value\n1\nnot-numeric");
  assert.equal(mixed.columns[0].type, "text");
  assert.equal(mixed.columns[0].numeric, null);
  assert.ok(mixed.columns[0].issues.some((issue) => issue.includes("混合")));
  assert.equal((await profile("flag\n0\n1")).columns[0].type, "number");
  const categories = await profile(
    "category\n" +
      [
        "z",
        "z",
        ...Array.from({ length: 12 }, (_, index) => `label${index}`),
      ].join("\n"),
  );
  assert.equal(categories.columns[0].distribution.length, 10);
  assert.deepEqual(categories.columns[0].distribution[0], {
    label: "z",
    value: 2,
  });
});

test("overflow is rejected instead of emitting nonfinite or misleading numeric summaries", async () => {
  await assert.rejects(profile("value\n1e999"), /有限数值范围/);
  await assert.rejects(profile("value\n1e308\n1e308"), /溢出/);
  await assert.rejects(profile("value\n-1e200\n1e200"), /溢出/);
  await assert.rejects(profile("value\n0\n5e-324"), /间隔过小/);
});

test("model receives only approved aggregates, never distribution labels or raw examples", async () => {
  let observed;
  const csv = "category,amount\nPRIVATE_CATEGORY_123,10\nOTHER_PRIVATE_456,20";
  const result = await run(
    { csv },
    {
      generate: async (spec) => {
        observed = spec;
        return { text: "仅根据汇总数据提供解读。" };
      },
    },
  );
  assert.ok(!observed.input.includes("PRIVATE_CATEGORY"));
  assert.ok(!observed.input.includes("OTHER_PRIVATE"));
  const input = JSON.parse(observed.input);
  assert.deepEqual(Object.keys(input), ["summary", "columns"]);
  input.columns.forEach((column) =>
    assert.deepEqual(Object.keys(column), [
      "name",
      "type",
      "count",
      "missing",
      "unique",
      "numeric",
      "issues",
    ]),
  );
  assert.match(
    observed.instructions,
    /no raw rows, example values or category labels/,
  );
  assert.match(
    observed.instructions,
    /Do not produce a precise overall quality score/,
  );
  assert.equal(result.columns[0].distribution.length, 2);
});

test("header-only CSV has defined zero rates and invalid CSV still fails validation", async () => {
  const result = await profile("a,b");
  assert.deepEqual(result.summary, {
    rows: 0,
    columns: 2,
    cells: 0,
    missingCells: 0,
    missingRate: 0,
    duplicateRows: 0,
  });
  assert.ok(
    result.columns.every(
      (column) => column.type === "empty" && column.missingRate === 0,
    ),
  );
  assert.match(result.insight, /本地规则概览/);
  await assert.rejects(profile("a,a\n1,2"), ValidationError);
});
