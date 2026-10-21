import DisclosureSummary from "./DisclosureSummary";
import { isAndroid } from "./native/bridge";
import { useState } from "react";
import {
  api,
  splitMaterial,
  statusName,
  type Submission,
  type ReviewItem,
} from "./api";
export function EssayReading({
  text,
  starters = [],
  edits = false,
}: {
  text: string;
  starters?: string[];
  edits?: boolean;
}) {
  return (
    <div className="composition essay-reading" lang="en">
      {text.split(/\n\s*\n/).map((paragraph, i) => {
        const plain = paragraph.replace(/\*\*/g, ""),
          starter = starters.find((s) => s && plain.startsWith(s));
        let offset = 0;
        return (
          <p key={i}>
            {(edits ? paragraph.split(/\*\*([^*]+)\*\*/g) : [plain]).map(
              (part, n) => {
                const boldLength = starter
                  ? Math.max(0, Math.min(part.length, starter.length - offset))
                  : 0;
                offset += part.length;
                const content = (
                  <>
                    {boldLength > 0 && (
                      <strong>{part.slice(0, boldLength)}</strong>
                    )}
                    {part.slice(boldLength)}
                  </>
                );
                return edits && n % 2 ? (
                  <mark className="polish-change" key={n}>
                    {content}
                  </mark>
                ) : (
                  <span key={n}>{content}</span>
                );
              },
            )}
          </p>
        );
      })}
    </div>
  );
}
function Feedback({
  title,
  items,
  kind,
}: {
  title: string;
  items: ReviewItem[];
  kind: number;
}) {
  return (
    <details
      className={`review-accordion review-${kind}`}
      open={kind === 1 || kind === 3}
    >
      <DisclosureSummary>
        {title}（{items.length}）
      </DisclosureSummary>
      {items.length ? (
        items.map((item, i) => (
          <div className="feedback-text" key={i}>
            <p lang="en">{item.original || item.quote}</p>
            {(item.fix || item.alternative) && (
              <p lang="en">→ {item.fix || item.alternative}</p>
            )}
            <p>{item.note || item.reason || item.benefit}</p>
            {item.possibleFix && <p>核实后可考虑：{item.possibleFix}</p>}
          </div>
        ))
      ) : (
        <p className="feedback-text">暂无此类条目</p>
      )}
    </details>
  );
}
export default function ResultReport({
  submission: s,
  teacher,
  onUpdate,
  onExport,
  onDelete,
  notify,
}: {
  submission: Submission;
  teacher: boolean;
  onUpdate: (s: Submission) => void;
  onExport: () => void;
  onDelete: () => Promise<void>;
  notify: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [score, setScore] = useState(
      s.teacherScore != null ? String(s.teacherScore) : "",
    ),
    [note, setNote] = useState(s.teacherNote || "");
  const r = s.result,
    starters = splitMaterial(s.originalText).starters;
  const retry = async () => {
    if (!window.confirm("重新批改会调用所配置的模型，可能产生费用。继续吗？"))
      return;
    setBusy(true);
    try {
      onUpdate(
        (
          await api<{ submission: Submission }>(
            `/api/submissions/${s.id}/regrade`,
            "POST",
          )
        ).submission,
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const adjust = async () => {
    setBusy(true);
    try {
      onUpdate(
        (
          await api<{ submission: Submission }>(
            `/api/submissions/${s.id}`,
            "PATCH",
            { teacherScore: score, teacherNote: note },
          )
        ).submission,
      );
      notify("教师终评已保存");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async (polishedOnly: boolean) => {
    const report = document.getElementById("result-report");
    if (!report) return;
    const clone = report.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll("button, .no-export")
      .forEach((node) => node.remove());
    clone.querySelectorAll("details").forEach((node) => {
      node.open = true;
    });
    try {
      const text = polishedOnly
        ? (r?.polished || "").replace(/\*\*/g, "")
        : Array.from(clone.children)
            .map((node) => (node as HTMLElement).textContent)
            .join("\n\n");
      await navigator.clipboard.writeText(text);
      notify(polishedOnly ? "润色参考已复制" : "全部批改结果已复制");
    } catch {
      notify("复制失败，请手动选择文字复制");
    }
  };
  return (
    <div className="result-page" id="result-report">
      <div className="result-heading">
        <h1>{s.title}</h1>
        <div className="result-meta">
          <span>{new Date(s.createdAt).toLocaleString("zh-CN")}</span>
          <span>{statusName(s.status)}</span>
        </div>
      </div>
      {(s.status === "pending" || s.status === "grading") && (
        <div className="processing">
          <h2>{s.status === "pending" ? "正在排队" : "正在批改"}</h2>
          <p>
            {isAndroid()
              ? "原稿已保存，切换应用后会继续批改。请勿强行停止或清理应用，返回后可查看结果。"
              : "原稿已保存。请保持软件运行，完成后此页会自动更新。"}
          </p>
          {s.queuePos != null && s.queuePos >= 0 && (
            <p>队列位置：{s.queuePos + 1}</p>
          )}
        </div>
      )}
      {s.status === "error" && (
        <div className="processing">
          <h2>这次批改没有完成</h2>
          <p role="alert">{s.error || "请检查模型配置后重试"}</p>
          <button className="primary" onClick={retry} disabled={busy}>
            重新批改
          </button>
        </div>
      )}
      {s.status === "done" && r && (
        <>
          <div className="result-score">
            <span className="large-score">
              {s.teacherScore ?? r.score}
              <small> / 25</small>
            </span>
            <span className="score-summary">
              {s.teacherScore != null ? "教师终评" : "AI 整体评分"}
            </span>
          </div>
          <section className="review-section">
            <h2>整体评价</h2>
            <p>{r.summary}</p>
            {r.assessment?.reason && <p>{r.assessment.reason}</p>}
            {r.assessment?.taskNotes?.map((t, i) => (
              <p key={i}>{t}</p>
            ))}
          </section>
          <section className="review-section">
            <h2>四维分析</h2>
            {(
              [
                ["plot", "情节与衔接", 10],
                ["language", "语言表达", 6],
                ["grammar", "语法准确", 5],
                ["coherence", "篇章连贯", 4],
              ] as const
            ).map(([key, label, max]) => (
              <div key={key}>
                <div className="dimension">
                  <span>{label}</span>
                  <div className="dimension-bar">
                    <i
                      style={{
                        width: `${Math.max(0, Math.min(100, ((r.dimensions[key]?.score ?? 0) / max) * 100))}%`,
                      }}
                    />
                  </div>
                  <strong>
                    {r.dimensions[key]?.score ?? "—"}
                    <small> / {max}</small>
                  </strong>
                </div>
                <p className="dimension-comment">
                  {r.dimensions[key]?.comment}
                </p>
              </div>
            ))}
            <p className="rubric-note">
              四维用于解释整体评分；文字稿批改不评价手写卷面。
            </p>
          </section>
          <details className="review-accordion">
            <DisclosureSummary>题目原文与给定段首句</DisclosureSummary>
            <EssayReading text={s.originalText} />
          </details>
          <details className="review-accordion review-0" open>
            <DisclosureSummary>原稿</DisclosureSummary>
            <EssayReading text={s.essayText} starters={starters} />
          </details>
          <Feedback title="确定错误" items={r.errors || []} kind={1} />
          <Feedback
            title="待核实问题（不扣分）"
            items={r.uncertainIssues || []}
            kind={2}
          />
          <Feedback
            title="表达提升建议（原句成立）"
            items={r.improvements || []}
            kind={3}
          />
          <details className="review-accordion review-4">
            <DisclosureSummary>写作亮点</DisclosureSummary>
            {r.highlights?.length ? (
              r.highlights.map((h, i) => (
                <p className="feedback-text" key={i}>
                  {h}
                </p>
              ))
            ) : (
              <p className="feedback-text">暂无条目</p>
            )}
          </details>
          {!!r.suggestions?.length && (
            <section className="review-section">
              <h2>练习建议</h2>
              {r.suggestions.map((t, i) => (
                <p key={i}>{t}</p>
              ))}
            </section>
          )}
          <details className="review-accordion review-5" open>
            <DisclosureSummary>润色参考</DisclosureSummary>
            <EssayReading
              text={r.polished || "暂无润色参考"}
              starters={starters}
              edits
            />
          </details>
          {s.teacherNote && (
            <section className="review-section">
              <h2>教师评语</h2>
              <p>{s.teacherNote}</p>
            </section>
          )}
          {teacher && (
            <section className="review-section no-export">
              <h2>教师终评</h2>
              <label className="field-label">
                分数（0–25，留空恢复 AI 分数）
                <input
                  type="number"
                  min="0"
                  max="25"
                  value={score}
                  placeholder={String(s.teacherScore ?? r.score)}
                  onChange={(e) => setScore(e.target.value)}
                />
              </label>
              <label className="field-label">
                评语
                <textarea
                  value={note}
                  placeholder={s.teacherNote || "补充教师评语"}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <button className="secondary" onClick={adjust} disabled={busy}>
                保存终评
              </button>
            </section>
          )}
          <button className="secondary wide" onClick={onExport}>
            导出这份批改
          </button>
          <button
            className="secondary wide"
            onClick={() => copy(true)}
            disabled={!r.polished}
          >
            复制润色参考
          </button>
          <button className="secondary wide" onClick={() => copy(false)}>
            复制全部结果
          </button>
          <button className="secondary wide" onClick={retry} disabled={busy}>
            重新批改
          </button>
          <p className="privacy-note">
            AI 批改供学习参考，请结合教师建议使用。
          </p>
        </>
      )}
      <button
        className="secondary wide no-export"
        disabled={busy}
        onClick={() => void onDelete()}
      >
        删除这篇作文
      </button>
    </div>
  );
}
