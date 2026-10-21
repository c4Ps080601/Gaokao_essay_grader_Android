const plain = (value) =>
  typeof value === "string" ? value.replace(/\*\*/g, "") : "";
export function buildPdfDocument(s) {
  const r = s.result;
  if (!r) throw new Error("批改尚未完成，无法导出报告");
  const sections = [];
  const add = (title, text) => {
    if (text) sections.push({ title, text: plain(text) });
  };
  const scores =
    `${s.teacherScore ?? r.score} / 25` +
    (s.teacherScore != null ? `（教师终评，AI 评分 ${r.score} / 25）` : "");
  add("评分", scores);
  add("整体评价", r.summary);
  const labels = {
    plot: "情节与衔接",
    language: "语言表达",
    grammar: "语法准确",
    vocabulary: "词汇运用",
    coherence: "篇章连贯",
  };
  add(
    "四维分析",
    Object.entries(r.dimensions || {})
      .map(([k, v]) => `${labels[k] || k}：${v.score}\n${v.comment || ""}`)
      .join("\n\n"),
  );
  add(
    "评分依据",
    [r.assessment?.reason, ...(r.assessment?.taskNotes || [])]
      .filter(Boolean)
      .join("\n"),
  );
  add("题目与给定开头", s.originalText);
  add("学生原稿", s.essayText);
  for (const [title, items] of [
    ["确定错误", r.errors],
    ["待核实问题（不扣分）", r.uncertainIssues],
    ["表达提升建议（原句成立）", r.improvements],
  ]) {
    add(
      title,
      items?.length
        ? items
            .map((i, n) =>
              [
                `${n + 1}. ${i.original || i.quote || ""}`,
                i.fix || i.alternative ? `→ ${i.fix || i.alternative}` : "",
                i.note || i.reason || i.benefit,
                i.possibleFix ? `核实后可考虑：${i.possibleFix}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            )
            .join("\n\n")
        : "暂无此类条目",
    );
  }
  add("写作亮点", (r.highlights || []).join("\n\n") || "暂无条目");
  add("练习建议", (r.suggestions || []).join("\n\n"));
  add("润色参考", r.polished);
  add("教师评语", s.teacherNote);
  add("说明", "AI 批改供学习参考，请结合教师建议使用。");
  return { title: plain(s.title) || "作文批改报告", sections };
}
