import { useEffect, useRef, useState } from "react";
import { api, type Submission } from "./api";
export type DraftFields = {
  title: string;
  originalText: string;
  essayText: string;
};
const blank = (): DraftFields => ({
  title: "",
  originalText: "",
  essayText: "",
});
export default function useDraft(
  owner: string,
  onSaved: (s: Submission) => void,
) {
  const state = useRef({
    fields: blank(),
    saved: JSON.stringify(blank()),
    id: "",
    revision: 0,
    clientId: crypto.randomUUID(),
    generation: 0,
    conflict: false,
    creation: null as DraftFields | null,
  });
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const paused = useRef(false);
  const savedCallback = useRef(onSaved);
  savedCallback.current = onSaved;
  const [fields, setView] = useState(blank),
    [status, setStatus] = useState("自动保存草稿");
  const [conflict, setConflict] = useState(false);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const change = (next: DraftFields) => {
    state.current.fields = next;
    setView(next);
    setStatus("尚未保存");
  };
  const open = (s?: Submission) => {
    const f = s
      ? { title: s.title, originalText: s.originalText, essayText: s.essayText }
      : blank();
    state.current = {
      fields: f,
      saved: JSON.stringify(f),
      id: s?.id || "",
      revision: s?.draftRevision || 0,
      clientId: crypto.randomUUID(),
      generation: state.current.generation + 1,
      conflict: false,
      creation: null,
    };
    setView(f);
    setConflict(false);
    setStatus(s ? "草稿已保存" : "自动保存草稿");
  };
  const save = (): Promise<Submission | null> => {
    const generation = state.current.generation,
      currentOwner = owner;
    const operation = queue.current
      .catch(() => {})
      .then(async () => {
        const c = state.current;
        if (paused.current) return null;
        if (c.generation !== generation || currentOwner !== ownerRef.current)
          return null;
        if (c.conflict)
          throw new Error("草稿已在其他页面更新，请另存为新草稿以保留当前输入");
        const snapshot = { ...c.fields },
          serialized = JSON.stringify(snapshot);
        if (
          !c.id &&
          !c.creation &&
          !Object.values(snapshot).some((s) => s.trim())
        ) {
          c.saved = serialized;
          setStatus("自动保存草稿");
          return null;
        }
        if (serialized === c.saved) return null;
        setStatus("正在保存…");
        try {
          // Keep the first create payload stable across lost-response retries.
          // An idempotent POST can return the earlier version, not the latest input.
          if (!c.id && !c.creation) c.creation = snapshot;
          let data = await api<{ submission: Submission }>(
            c.id ? `/api/drafts/${c.id}` : "/api/drafts",
            c.id ? "PUT" : "POST",
            {
              ...(c.id ? snapshot : c.creation),
              revision: c.revision,
              clientId: c.clientId,
            },
          );
          if (
            state.current.generation !== generation ||
            currentOwner !== ownerRef.current
          )
            return null;
          c.id = data.submission.id;
          c.revision = data.submission.draftRevision;
          const stored = {
            title: data.submission.title,
            originalText: data.submission.originalText,
            essayText: data.submission.essayText,
          };
          c.saved = JSON.stringify(stored);
          const matches = (input: DraftFields | null) =>
            !!input &&
            stored.originalText === input.originalText &&
            stored.essayText === input.essayText &&
            (!input.title.trim() || stored.title === input.title.trim());
          if (!matches(snapshot)) {
            // Refuse to overwrite edits made by another editor after creation.
            if (!matches(c.creation))
              throw Object.assign(new Error("草稿已在其他页面更新"), {
                status: 409,
              });
            data = await api<{ submission: Submission }>(
              `/api/drafts/${c.id}`,
              "PUT",
              {
                ...snapshot,
                revision: c.revision,
              },
            );
            if (
              state.current.generation !== generation ||
              currentOwner !== ownerRef.current
            )
              return null;
            c.revision = data.submission.draftRevision;
          }
          c.saved = serialized;
          savedCallback.current(data.submission);
          setStatus(
            JSON.stringify(c.fields) === serialized
              ? "草稿已自动保存"
              : "尚未保存",
          );
          return data.submission;
        } catch (e) {
          if (c.generation === generation) {
            if ((e as { status?: number }).status === 409) {
              c.conflict = true;
              setConflict(true);
            }
            setStatus(`保存失败：${(e as Error).message}（输入仍在当前页面）`);
          }
          throw e;
        }
      });
    queue.current = operation;
    return operation;
  };
  const flush = async () => {
    await save();
    // Edits made during an in-flight save must also reach disk before navigating/submitting.
    for (
      let attempt = 0;
      JSON.stringify(state.current.fields) !== state.current.saved;
      attempt++
    ) {
      if (attempt >= 5) throw new Error("内容仍在变化，请稍停输入后再离开");
      await save();
    }
    return { ...state.current };
  };
  useEffect(() => {
    if (
      !owner ||
      JSON.stringify(fields) === state.current.saved ||
      state.current.conflict
    )
      return;
    const timer = setTimeout(() => {
      void save().catch(() => {});
    }, 700);
    return () => clearTimeout(timer);
  }, [fields, owner]);
  useEffect(() => {
    const background = () => {
      void save().catch(() => {});
    };
    window.addEventListener("essay-background", background);
    return () => window.removeEventListener("essay-background", background);
  }, [owner]);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (JSON.stringify(state.current.fields) !== state.current.saved) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  const saveCopy = async () => {
    const f = { ...state.current.fields };
    open();
    change(f);
    await save();
  };
  const discard = async (action: (id: string) => Promise<unknown>) => {
    paused.current = true;
    try {
      await queue.current.catch(() => {});
      await action(state.current.id);
      open();
    } finally {
      paused.current = false;
    }
  };
  return { fields, change, open, flush, discard, status, conflict, saveCopy };
}
