import {
  $,
  escape,
  toast,
  download,
  init,
  run,
  busy,
  resultMeta,
  fileText,
} from "./ui.js";
import { bars, num, pct } from "./charts.js";
import { reportHTML } from "./reports.js";
const sample =
  "id,region,amount,paid,joined\n001,华东,120,true,2026-01-02\n002,华北,80,false,2026-01-03\n003,华东,100,true,2026-01-04\n004,华南,90,true,2026-01-05\n005,,110,false,2026-01-06\n006,华北,,true,2026-01-07\n007,华南,5000,false,2026-01-08\n008,华东,100,true,2026-01-09\n009,华北,95,true,2026-01-10\n001,华东,120,true,2026-01-02\n";
const types = {
  empty: "全空",
  number: "数值",
  boolean: "布尔",
  date: "日期",
  text: "文本",
};
let result = null;
let pending = false;
function lock(on) {
  pending = on;
  document
    .querySelectorAll("#csv,#file,#sample,#profile,#mode")
    .forEach((el) => (el.disabled = on));
}
function overviewRows() {
  return result.columns.map((c) => [
    c.name,
    types[c.type],
    c.count,
    c.missing,
    pct(c.missingRate),
    c.unique,
  ]);
}
function showColumn(index) {
  const c = result.columns[index];
  $("#column-title").textContent = c.name;
  $("#column-type").textContent = types[c.type];
  let detail = `<p class="hint">有效值 ${num(c.count, 0)} · 缺失 ${num(c.missing, 0)} · 唯一值 ${num(c.unique, 0)}</p>`;
  if (c.numeric)
    detail +=
      '<div class="grid3">' +
      [
        ["最小值", c.numeric.min],
        ["中位数", c.numeric.median],
        ["最大值", c.numeric.max],
        ["均值", c.numeric.mean],
        ["样本标准差", c.numeric.std],
        ["IQR 异常数", c.numeric.outliers],
      ]
        .map(
          ([label, value]) =>
            `<div class="card"><span class="muted">${label}</span><h3 style="margin:7px 0 0">${num(value)}</h3></div>`,
        )
        .join("") +
      "</div>";
  detail +=
    '<p class="warning-list">' + c.issues.map(escape).join("\n") + "</p>";
  $("#detail").innerHTML = detail;
  $("#distribution").innerHTML = c.distribution.length
    ? bars(c.distribution, {
        label: c.name + "分布",
        valueFormat: (v) => num(v, 0),
      })
    : '<p class="muted">没有非空值可显示。</p>';
  document
    .querySelectorAll("[data-column]")
    .forEach((el, i) => el.classList.toggle("primary", i === index));
}
function render(r) {
  result = { ...r.data, meta: r.meta };
  const s = result.summary;
  $("#metrics").innerHTML = [
    ["数据行数", num(s.rows, 0)],
    ["字段数量", num(s.columns, 0)],
    ["缺失比例", pct(s.missingRate)],
    ["重复行数", num(s.duplicateRows, 0)],
  ]
    .map(
      ([label, value]) =>
        `<div class="metric-card"><span>${label}</span><strong>${value}</strong></div>`,
    )
    .join("");
  $("#count").textContent = `${s.rows} ROWS / ${s.columns} FIELDS`;
  $("#overview").innerHTML =
    `<table class="data-table"><thead><tr><th>字段</th><th>类型</th><th>有效值</th><th>缺失率</th><th>唯一值</th></tr></thead><tbody>${result.columns.map((c, i) => `<tr><td><button class="small" data-column="${i}">${escape(c.name)}</button></td><td>${types[c.type]}</td><td>${num(c.count, 0)}</td><td>${pct(c.missingRate)}</td><td>${num(c.unique, 0)}</td></tr>`).join("")}</tbody></table>`;
  $("#issues").innerHTML = result.issues.length
    ? result.issues
        .map(
          (i) =>
            `<div class="card"><span class="chip">${i.column === null ? "整体数据" : escape(i.column)}</span><p style="margin:10px 0 0">${escape(i.message)}</p></div>`,
        )
        .join("")
    : '<p class="muted">当前规则未发现需要提示的问题。</p>';
  $("#insight").textContent = result.insight;
  $("#meta").innerHTML = resultMeta(r.meta);
  $("#exports").hidden = false;
  showColumn(
    result.columns.findIndex((c) => c.name === "amount") >= 0
      ? result.columns.findIndex((c) => c.name === "amount")
      : 0,
  );
}
$("#sample").onclick = () => ($("#csv").value = sample);
$("#file").onchange = async (e) => {
  if (pending) return;
  lock(true);
  try {
    const f = e.target.files[0];
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) throw Error("请选择 CSV 文件");
    const text = await fileText(f, 750000);
    if (text.length > 250000) throw Error("CSV 超过 250,000 字符");
    $("#csv").value = text;
  } catch (err) {
    toast(err.message, true);
  } finally {
    e.target.value = "";
    lock(false);
  }
};
$("#profile-form").onsubmit = async (e) => {
  e.preventDefault();
  if (pending) return;
  lock(true);
  busy($("#profile"), true, "检查数据中…");
  try {
    render(await run({ csv: $("#csv").value }));
  } catch (err) {
    toast(err.message, true);
  } finally {
    busy($("#profile"), false);
    lock(false);
  }
};
$("#overview").onclick = (e) => {
  const button = e.target.closest("[data-column]");
  if (button && result) showColumn(Number(button.dataset.column));
};
$("#export-json").onclick = () => {
  if (result)
    download(
      "quality-profile.json",
      JSON.stringify(result, null, 2),
      "application/json",
    );
};
$("#export-html").onclick = () => {
  if (!result) return;
  const s = result.summary;
  download(
    "quality-report.html",
    reportHTML({
      title: "数据质量报告",
      subtitle: "Quality Lab · 基于本次输入的统计快照",
      metrics: [
        { label: "数据行", value: s.rows },
        { label: "字段", value: s.columns },
        { label: "缺失率", value: pct(s.missingRate) },
        { label: "重复行", value: s.duplicateRows },
      ],
      sections: [
        {
          title: "字段画像",
          headers: ["字段", "类型", "有效值", "缺失", "缺失率", "唯一值"],
          rows: overviewRows(),
        },
        {
          title: "数值摘要",
          headers: [
            "字段",
            "最小",
            "Q1",
            "中位数",
            "Q3",
            "最大",
            "均值",
            "样本标准差",
            "异常数",
          ],
          rows: result.columns
            .filter((c) => c.numeric)
            .map((c) => [
              c.name,
              ...[
                "min",
                "q1",
                "median",
                "q3",
                "max",
                "mean",
                "std",
                "outliers",
              ].map((k) => num(c.numeric[k])),
            ]),
        },
        {
          title: "检查线索",
          headers: ["字段", "提示"],
          rows: result.issues.map((i) => [i.column ?? "整体", i.message]),
        },
        { title: "结果解读", text: result.insight },
      ],
      notes: [
        "类型为按当前值推断的结果，应结合业务含义确认。",
        "分位数采用线性插值；标准差分母 n−1。IQR 异常需要至少 4 个数值。",
        "未修改原始数据。" + result.warnings.join(" "),
      ],
    }),
    "text/html;charset=utf-8",
  );
};
await init();
