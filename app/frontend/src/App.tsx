import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  MotionPage,
  MotionOverlay,
  useOverlayMotion,
} from "./NavigationMotion";
import type { ReactNode } from "react";
import ModelConfiguration from "./ModelSettings";
import {
  api,
  compressImage,
  downloadBlob,
  materialText,
  splitMaterial,
  statusName,
  type Submission,
  type User,
  type Settings,
} from "./api";
import useDraft from "./useDraft";
import ResultReport from "./ResultReport";
import { toBlob } from "html-to-image";
import { isAndroid, native } from "./native/bridge";
import {
  captureFile,
  canRestoreCapture,
  type CaptureTicket,
} from "./native/media-policy.mjs";
import { buildPdfDocument } from "./native/report-document.mjs";
import { peekRestoredCapture, clearRestoredCapture } from "./native/lifecycle";

type IconName =
  | "menu"
  | "plus"
  | "arrow"
  | "back"
  | "close"
  | "file"
  | "check"
  | "clock"
  | "alert"
  | "settings"
  | "sun"
  | "image"
  | "camera"
  | "download"
  | "users"
  | "chevron"
  | "spark"
  | "eye"
  | "trash"
  | "upload";
function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    menu: (
      <>
        <path d="M4 6h16M4 12h11M4 18h16" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    back: <path d="m14 5-7 7 7 7" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    file: (
      <>
        <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 12h6M9 16h6" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    alert: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v6m0 3h.01" />
      </>
    ),
    settings: (
      <>
        <path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="8" cy="8" r="1.5" />
        <path d="m3 17 5-5 4 4 4-7 5 8" />
      </>
    ),
    camera: (
      <>
        <path d="M8 5 6 8H3v12h18V8h-3l-2-3z" />
        <circle cx="12" cy="13" r="4" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5" />
      </>
    ),
    users: (
      <>
        <circle cx="10" cy="8" r="3" />
        <path d="M3 21v-3a7 7 0 0 1 14 0v3M17 5a3 3 0 0 1 0 6m2 4a6 6 0 0 1 2 6" />
      </>
    ),
    chevron: <path d="m9 5 7 7-7 7" />,
    spark: (
      <>
        <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
function Logo() {
  return (
    <span className="logo">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          d="M12 5v16M12 5C8 2 4 3 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-2-1-6-2-10 1Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
type Essay = {
  id: string;
  title: string;
  date: string;
  status: string;
  score?: number;
  topic: string;
  record: Submission;
};
const view = (s: Submission): Essay => ({
  id: s.id,
  title: s.title,
  date: new Date(s.updatedAt || s.createdAt).toLocaleString("zh-CN"),
  status: statusName(s.status),
  score: s.teacherScore ?? s.result?.score,
  topic: s.authorName || "",
  record: s,
});
function Status({ value }: { value: string }) {
  return (
    <span className={`status s-${value}`}>
      <span className={value === "批改中" ? "dot pulse" : "dot"} />
      {value}
    </span>
  );
}
function Row({
  icon,
  title,
  value,
  onClick,
  danger = false,
}: {
  icon?: IconName;
  title: string;
  value?: string;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <button
      className={`setting-row ${danger ? "danger" : ""}`}
      onClick={onClick}
    >
      {icon && <Icon name={icon} size={19} />}
      <span>{title}</span>
      {value && <small>{value}</small>}
      {onClick && <Icon name="chevron" size={16} />}
    </button>
  );
}

export default function App() {
  const overlayMotion = useOverlayMotion();
  const [page, setPage] = useState("home"),
    [essays, setEssays] = useState<Essay[]>([]),
    [selected, setSelected] = useState<Essay | null>(null);
  const [drawer, setDrawer] = useState(false),
    [sheet, setSheet] = useState(""),
    [sub, setSub] = useState(""),
    [filter, setFilter] = useState("全部"),
    [toast, setToast] = useState("");
  const [theme, setTheme] = useState(
      () => localStorage.getItem("eg_mobile_theme") || "浅色",
    ),
    [font, setFont] = useState("标准");
  const fontRevision = useRef(0),
    confirmedFont = useRef("标准"),
    fontQueue = useRef<Promise<unknown>>(Promise.resolve());
  useLayoutEffect(() => {
    const previous = document.documentElement.style.fontSize;
    const scale =
      ({ 小: 0.85, 标准: 1, 大: 1.15, 特大: 1.3 } as Record<string, number>)[
        font
      ] || 1;
    document.documentElement.style.fontSize = `${scale * 100}%`;
    return () => {
      document.documentElement.style.fontSize = previous;
    };
  }, [font]);
  const [me, setMe] = useState<User | null>(null),
    [version, setVersion] = useState("3.1.3"),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState("");
  const [userName, setUserName] = useState(""),
    [knownUsers, setKnownUsers] = useState<string[]>(() => {
      try {
        const value: unknown = JSON.parse(
          localStorage.getItem("eg_profiles") || "[]",
        );
        return Array.isArray(value)
          ? value.filter((v): v is string => typeof v === "string")
          : [];
      } catch {
        return [];
      }
    });
  const [photoFiles, setPhotoFiles] = useState<File[]>([]),
    [photoUrls, setPhotoUrls] = useState<string[]>([]),
    [recognizing, setRecognizing] = useState(false),
    [capturing, setCapturing] = useState(false),
    [submitting, setSubmitting] = useState(false),
    [exporting, setExporting] = useState(false),
    [confirm, setConfirm] = useState(false);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const touch = useRef(0),
    scroll = useRef<HTMLElement>(null),
    photoInput = useRef<HTMLInputElement>(null),
    cameraInput = useRef<HTMLInputElement>(null),
    backupInput = useRef<HTMLInputElement>(null);
  const epoch = useRef(0),
    refreshSequence = useRef(0),
    switching = useRef(false),
    owner = useRef(""),
    currentPage = useRef(page);
  const captureLock = useRef(false),
    restoreLock = useRef(false);
  currentPage.current = page;
  const notify = (message: string) => setToast(message);
  const upsert = (s: Submission) => {
    refreshSequence.current++;
    setEssays((list) => [view(s), ...list.filter((e) => e.id !== s.id)]);
    setSelected((old) => (old?.id === s.id ? view(s) : old));
  };
  const draft = useDraft(me?.id || "", upsert);
  const title = draft.fields.title,
    text = draft.fields.essayText;
  const [sourceText, setSourceView] = useState(""),
    [starters, setStarterView] = useState(["", ""]);
  const setTitle = (title: string) => draft.change({ ...draft.fields, title });
  const setText = (essayText: string) =>
    draft.change({ ...draft.fields, essayText });
  const setSourceText = (s: string) => {
    setSourceView(s);
    draft.change({ ...draft.fields, originalText: materialText(s, starters) });
  };
  const setStarters = (s: string[]) => {
    setStarterView(s);
    draft.change({
      ...draft.fields,
      originalText: materialText(sourceText, s),
    });
  };
  const user = me?.name || "本机用户",
    photos = photoFiles.length;
  const refresh = async () => {
    const token = epoch.current;
    const sequence = ++refreshSequence.current;
    const data = await api<{ submissions: Submission[] }>("/api/submissions");
    if (token !== epoch.current || sequence !== refreshSequence.current) return;
    setEssays(data.submissions.map(view));
    setSelected((old) => {
      const item = data.submissions.find((s) => s.id === old?.id);
      return item ? view(item) : old;
    });
  };
  const loadSettings = async () => {
    const revision = fontRevision.current;
    const s = await api<Settings>("/api/settings");
    setVersion(s.version);
    const loadedFont =
      (
        { 0.85: "小", 1: "标准", 1.15: "大", 1.3: "特大" } as Record<
          number,
          string
        >
      )[s.fontScale] || "标准";
    if (revision === fontRevision.current) {
      confirmedFont.current = loadedFont;
      setFont(loadedFont);
    }
    if (!localStorage.getItem("eg_mobile_theme"))
      setTheme(s.theme === "dark" ? "深色" : "浅色");
  };
  const remember = (name: string) =>
    setKnownUsers((old) => {
      const list = [name, ...old.filter((n) => n !== name)].slice(0, 12);
      localStorage.setItem("eg_profiles", JSON.stringify(list));
      return list;
    });
  const switchUser = async (name: string) => {
    if (switching.current) return;
    if (recognizing || submitting || capturing) {
      notify("请等待当前操作完成再切换用户");
      return;
    }
    switching.current = true;
    try {
      if (page === "submit") await draft.flush();
      const data = await api<{ user: User }>("/api/enter", "POST", {
        username: name,
      });
      epoch.current++;
      owner.current = data.user.id;
      setMe(data.user);
      remember(data.user.name);
      draft.open();
      setSourceView("");
      setStarterView(["", ""]);
      setPhotoFiles([]);
      setSelected(null);
      setSheet("");
      setSub("");
      setDrawer(false);
      setPage("home");
      await refresh();
      await loadSettings();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      switching.current = false;
    }
  };
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        let u: User;
        try {
          u = (await api<{ user: User }>("/api/me")).user;
        } catch (e) {
          if ((e as { status?: number }).status !== 401) throw e;
          u = (
            await api<{ user: User }>("/api/enter", "POST", {
              username: "默认用户",
            })
          ).user;
        }
        if (!active) return;
        owner.current = u.id;
        setMe(u);
        remember(u.name);
        await Promise.all([refresh(), loadSettings()]);
      } catch (e) {
        if (active) setLoadError((e as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!me) return;
    let stopped = false;
    const timer = setInterval(() => {
      if (!stopped) void refresh().catch(() => {});
    }, 2500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [me?.id]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const urls = photoFiles.map((f) => URL.createObjectURL(f));
    setPhotoUrls(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [photoFiles]);
  useEffect(() => {
    const q = matchMedia("(prefers-color-scheme: dark)"),
      changed = () => setSystemDark(q.matches);
    q.addEventListener("change", changed);
    return () => q.removeEventListener("change", changed);
  }, []);
  const go = async (next: string) => {
    if (recognizing || submitting || capturing) {
      notify("请等待当前操作完成");
      return;
    }
    try {
      if (page === "submit" && next !== "submit") await draft.flush();
      setDrawer(false);
      setPage(next);
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const create = async () => {
    if (recognizing || submitting || capturing) return;
    try {
      if (page === "submit") await draft.flush();
      draft.open();
      setSourceView("");
      setStarterView(["", ""]);
      setPhotoFiles([]);
      setDrawer(false);
      setPage("submit");
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const openEssay = async (e: Essay) => {
    if (recognizing || submitting || capturing) return;
    try {
      if (page === "submit") await draft.flush();
      const fresh = (
        await api<{ submission: Submission }>(`/api/submissions/${e.id}`)
      ).submission;
      setSelected(view(fresh));
      if (fresh.status === "draft") {
        draft.open(fresh);
        const material = splitMaterial(fresh.originalText);
        setSourceView(material.sourceText);
        setStarterView(material.starters);
        setPhotoFiles([]);
        setPage("submit");
      } else setPage("result");
      setDrawer(false);
    } catch (error) {
      notify((error as Error).message);
    }
  };
  const overlay = (name: string) => {
    setDrawer(false);
    setSub("");
    setSheet(name);
    history.pushState({}, "");
  };
  useEffect(() => {
    const back = () => {
      if (confirm) setConfirm(false);
      else if (sub) setSub("");
      else if (sheet) setSheet("");
      else if (drawer) setDrawer(false);
      else if (page === "home" && isAndroid()) void native.minimizeApp();
      else void go("home");
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") back();
    };
    window.addEventListener("popstate", back);
    window.addEventListener("essay-back", back);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("popstate", back);
      window.removeEventListener("essay-back", back);
      window.removeEventListener("keydown", key);
    };
  }, [
    confirm,
    sub,
    sheet,
    drawer,
    page,
    recognizing,
    capturing,
    submitting,
    draft.fields,
  ]);
  const addFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const next = [...photoFiles];
    for (const f of Array.from(files)) {
      if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) {
        notify("仅支持 JPG、PNG、WebP 图片");
        continue;
      }
      if (f.size > 12 * 1024 * 1024) {
        notify("单张图片不能超过12MB");
        continue;
      }
      if (
        !next.some(
          (p) =>
            p.name === f.name &&
            p.size === f.size &&
            p.lastModified === f.lastModified,
        )
      )
        next.push(f);
    }
    if (next.length > 4) notify("最多4张图片，超出部分未添加");
    setPhotoFiles(next.slice(0, 4));
  };
  const takePhoto = async () => {
    if (captureLock.current || recognizing || submitting) return;
    if (photoFiles.length >= 4) {
      notify("最多4张图片，请先删除一张再拍摄");
      return;
    }
    if (!isAndroid()) {
      cameraInput.current?.click();
      return;
    }
    captureLock.current = true;
    setCapturing(true);
    const captureOwner = owner.current;
    try {
      const saved = await draft.flush();
      const ticket: CaptureTicket = {
        owner: captureOwner,
        draftId: saved.id,
        token: crypto.randomUUID(),
      };
      localStorage.setItem("eg_capture_ticket", JSON.stringify(ticket));
      const result = await native.capturePhoto({ token: ticket.token });
      if (owner.current !== captureOwner || currentPage.current !== "submit")
        return;
      const file = captureFile(result);
      if (file) {
        addFiles([file]);
        notify("照片已添加，请点击识别文字并核对结果");
      }
    } catch (e) {
      notify((e as Error).message);
    } finally {
      localStorage.removeItem("eg_capture_ticket");
      captureLock.current = false;
      setCapturing(false);
    }
  };
  useEffect(() => {
    if (!isAndroid() || loading || !me) return;
    const recover = async () => {
      const result = peekRestoredCapture();
      if (!result || restoreLock.current) return;
      let ticket: CaptureTicket | null = null;
      try {
        ticket = JSON.parse(
          localStorage.getItem("eg_capture_ticket") || "null",
        );
      } catch {}
      if (result.canceled) {
        clearRestoredCapture();
        localStorage.removeItem("eg_capture_ticket");
        return;
      }
      if (!canRestoreCapture(ticket, result, owner.current)) return;
      restoreLock.current = true;
      clearRestoredCapture();
      try {
        const file = captureFile(result);
        if (!file) return;
        const s = ticket!.draftId
          ? (
              await api<{ submission: Submission }>(
                `/api/submissions/${ticket!.draftId}`,
              )
            ).submission
          : undefined;
        if (owner.current !== ticket!.owner) return;
        if (s && s.status !== "draft")
          throw new Error("原草稿状态已变化，请重新选择照片");
        draft.open(s);
        const material = splitMaterial(s?.originalText || "");
        setSourceView(material.sourceText);
        setStarterView(material.starters);
        setPhotoFiles([file]);
        setPage("submit");
        setDrawer(false);
        setSheet("");
        notify("已恢复拍摄照片与文字草稿；其他未识别图片如有缺失请重新选择");
      } catch (e) {
        notify((e as Error).message);
      } finally {
        localStorage.removeItem("eg_capture_ticket");
        restoreLock.current = false;
      }
    };
    const exported = (event: Event) =>
      notify((event as CustomEvent<string>).detail);
    void recover();
    window.addEventListener("essay-camera-restored", recover);
    window.addEventListener("essay-export-restored", exported);
    return () => {
      window.removeEventListener("essay-camera-restored", recover);
      window.removeEventListener("essay-export-restored", exported);
    };
  }, [loading, me?.id]);
  const recognize = async () => {
    if (recognizing || capturing || !photos) return;
    setRecognizing(true);
    try {
      await draft.flush();
      const f = new FormData();
      for (const p of photoFiles)
        f.append(
          "images",
          await compressImage(p),
          p.name.replace(/\.[^.]*$/, "") + ".jpg",
        );
      const data = await api<{
        fields: {
          originalText: string;
          starter1: string;
          starter2: string;
          para1: string;
          para2: string;
          taskRequirements: string;
          keywords: string[];
        };
      }>("/api/ocr", "POST", f);
      const v = data.fields;
      setSourceView(
        [
          v.originalText,
          v.taskRequirements ? "【本题要求】" + v.taskRequirements : "",
          v.keywords?.length
            ? "【明确识别的划线关键词】" + v.keywords.join(", ")
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
      setStarterView([v.starter1, v.starter2]);
      draft.change({
        title,
        originalText: materialText(
          [
            v.originalText,
            v.taskRequirements ? "【本题要求】" + v.taskRequirements : "",
            v.keywords?.length
              ? "【明确识别的划线关键词】" + v.keywords.join(", ")
              : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
          [v.starter1, v.starter2],
        ),
        essayText: [v.para1, v.para2].filter(Boolean).join("\n\n"),
      });
      await draft.flush();
      notify("识别结果已保存为草稿，请逐字核对后批改");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setRecognizing(false);
    }
  };
  const submit = async () => {
    if (submitting || recognizing || capturing) return;
    setSubmitting(true);
    try {
      const c = await draft.flush();
      if (!c.id) throw new Error("请填写题目与续写内容");
      const { submission: s } = await api<{ submission: Submission }>(
        `/api/drafts/${c.id}/submit`,
        "POST",
        { ...c.fields, revision: c.revision },
      );
      upsert(s);
      setSelected(view(s));
      draft.open();
      setPage("result");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };
  const chooseAppearance = async (option: string) => {
    try {
      if (sub === "主题") {
        localStorage.setItem("eg_mobile_theme", option);
        setTheme(option);
        await api("/api/settings", "PUT", {
          theme:
            option === "深色" || (option === "跟随系统" && systemDark)
              ? "dark"
              : "light",
        });
      } else {
        const revision = ++fontRevision.current;
        setFont(option);
        const save = fontQueue.current
          .catch(() => {})
          .then(async () => {
            await api("/api/settings", "PUT", {
              fontScale: (
                { 小: 0.85, 标准: 1, 大: 1.15, 特大: 1.3 } as Record<
                  string,
                  number
                >
              )[option],
            });
            confirmedFont.current = option;
          });
        fontQueue.current = save;
        try {
          await save;
        } catch (e) {
          if (revision === fontRevision.current) {
            setFont(confirmedFont.current);
            notify("字号保存失败，已恢复上次保存的大小，请重试");
          }
        }
      }
    } catch (e) {
      notify("外观保存失败：" + (e as Error).message);
    }
  };
  const backup = async () => {
    try {
      if (page === "submit") await draft.flush();
      const b = await api("/api/backup");
      const saved = await downloadBlob(
        new Blob([JSON.stringify(b, null, 2)], { type: "application/json" }),
        "续写批改站-作文备份.json",
      );
      if (!saved) return;
      notify("已导出当前用户作文，不含密钥和会话");
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const importBackup = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error("备份超过20MB导入上限");
      if (
        !window.confirm(
          "将把备份作为新记录追加到当前用户，不覆盖原记录，也不会自动批改。继续吗？",
        )
      )
        return;
      if (page === "submit") await draft.flush();
      const r = await api<{ imported: number }>(
        "/api/backup",
        "POST",
        JSON.parse(await file.text()),
      );
      await refresh();
      notify(`已导入 ${r.imported} 篇作文`);
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const clearData = async () => {
    if (recognizing || submitting || capturing) {
      notify("请等待当前操作完成");
      return;
    }
    try {
      // Drain queued autosaves before deletion, including a conflicted save.
      await draft.discard(() => api("/api/my-data", "DELETE"));
      refreshSequence.current++;
      draft.open();
      setEssays([]);
      setSelected(null);
      setPhotoFiles([]);
      setConfirm(false);
      setSheet("");
      setPage("home");
      notify("当前用户作文已清理，模型配置保留");
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const deleteEssay = async (id: string) => {
    if (!window.confirm("确定删除这篇作文吗？删除后无法恢复。")) return;
    try {
      await api(`/api/submissions/${id}`, "DELETE");
      refreshSequence.current++;
      setEssays((items) => items.filter((item) => item.id !== id));
      setSelected(null);
      setPage("home");
      notify("作文已删除");
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const deleteDraft = async () => {
    if (!window.confirm("确定删除当前草稿及页面输入吗？删除后无法恢复。"))
      return;
    try {
      await draft.discard(async (id) => {
        if (id) await api(`/api/submissions/${id}`, "DELETE");
      });
      refreshSequence.current++;
      setSelected(null);
      setPhotoFiles([]);
      setPage("home");
      await refresh();
      notify("草稿已删除");
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const exportResult = async (
    kind: "pdf" | "image",
    mode: "save" | "share" = "save",
  ) => {
    if (!selected || exporting) return;
    setExporting(true);
    try {
      const desktop = (
        window as unknown as {
          desktop?: {
            exportPdf: (
              id: string,
            ) => Promise<{ ok?: boolean; error?: string; canceled?: boolean }>;
            saveLongImage: (
              id: string,
              data: string,
            ) => Promise<{ ok?: boolean; error?: string; canceled?: boolean }>;
          };
        }
      ).desktop;
      if (kind === "pdf") {
        if (isAndroid()) {
          const result = await native.exportPdf({
            name: selected.title + ".pdf",
            report: buildPdfDocument(selected.record),
            share: mode === "share",
          });
          if (result?.canceled) return;
        } else if (desktop) {
          const r = await desktop.exportPdf(selected.id);
          if (r.error) throw new Error(r.error);
          if (r.canceled) return;
        } else {
          const r = await fetch(`/api/submissions/${selected.id}/pdf`);
          if (!r.ok) throw new Error((await r.json()).error || "PDF导出失败");
          await downloadBlob(await r.blob(), selected.title + ".pdf");
        }
      } else {
        const report = document.getElementById("result-report");
        if (!report) throw new Error("未找到批改报告");
        const details = Array.from(report.querySelectorAll("details"));
        const openStates = details.map((d) => d.open);
        details.forEach((d) => (d.open = true));
        try {
          await document.fonts.ready;
          if (report.scrollHeight > 24000)
            throw new Error("报告过长，请使用PDF导出");
          const blob = await toBlob(report, {
            filter: (node) =>
              !(
                node instanceof HTMLElement &&
                node.matches("button,input,textarea,.no-export")
              ),
            style: {
              position: "relative",
              left: "0",
              top: "0",
              margin: "0",
              transform: "none",
              overflow: "visible",
              maxHeight: "none",
            },
            pixelRatio: 1.5,
            width: report.clientWidth,
            height: report.scrollHeight,
            backgroundColor: getComputedStyle(report.closest(".app-shell")!)
              .backgroundColor,
          });
          if (!blob) throw new Error("生成长图失败");
          if (desktop) {
            const data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
            const r = await desktop.saveLongImage(selected.id, data);
            if (r.error) throw new Error(r.error);
            if (r.canceled) return;
          } else if (!(await downloadBlob(blob, selected.title + ".png", mode)))
            return;
        } finally {
          details.forEach((d, i) => (d.open = openStates[i]));
        }
      }
      setSheet("");
      notify(
        isAndroid() && mode === "share" ? "已打开分享面板" : "批改结果已导出",
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setExporting(false);
    }
  };
  const shown = essays.filter((e) => filter === "全部" || e.status === filter),
    dark = theme === "深色" || (theme === "跟随系统" && systemDark);
  if (loading || loadError)
    return (
      <div className="app-shell">
        <div className="processing">
          <h1>续写批改站</h1>
          <p role="status">{loadError || "正在读取本机资料…"}</p>
          {loadError && (
            <button className="secondary" onClick={() => location.reload()}>
              重试
            </button>
          )}
        </div>
      </div>
    );

  return (
    <div
      className={`app-shell ${dark ? "dark" : ""} ${page === "result" ? "result-view" : ""}`}
      data-font={font}
    >
      <div className="safe-top" aria-hidden="true" />
      <input
        hidden
        ref={photoInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={backupInput}
        type="file"
        accept="application/json,.json"
        onChange={(e) => {
          void importBackup(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <AnimatePresence
        initial={false}
        mode="wait"
        custom={page === "home" ? -1 : 1}
      >
        <MotionPage
          key={page === "result" ? `result:${selected?.id}` : page}
          direction={page === "home" ? -1 : 1}
        >
          {page !== "result" && (
            <header className="topbar">
              <button
                className="icon-button"
                aria-label={page === "home" ? "打开侧边导航" : "返回我的作文"}
                onClick={() => {
                  if (page === "home") {
                    setDrawer(true);
                    window.history.pushState({}, "");
                  } else go("home");
                }}
              >
                <Icon name={page === "home" ? "menu" : "back"} />
              </button>
              <span className="topbar-title">
                {page === "home" ? (
                  <>
                    <Logo />
                    续写批改站
                  </>
                ) : (
                  "提交作文"
                )}
              </span>
              <span className="topbar-spacer" aria-hidden="true" />
            </header>
          )}

          {page === "result" && (
            <button
              className="icon-button result-back"
              aria-label="返回我的作文"
              onClick={() => go("home")}
            >
              <Icon name="back" />
            </button>
          )}
          <main className="main-scroll" ref={scroll}>
            {page === "home" && (
              <>
                <section className="home-heading">
                  <div className="eyebrow">写下故事，见证成长</div>
                  <h1>
                    我的作文<span className="count">{essays.length}</span>
                  </h1>
                  <p>每一篇练习，都让表达更进一步。</p>
                </section>
                <div className="filters" role="tablist" aria-label="作文状态">
                  {["全部", "已完成", "草稿", "批改中"].map((f) => (
                    <button
                      key={f}
                      role="tab"
                      aria-selected={filter === f}
                      className={filter === f ? "active" : ""}
                      onClick={() => setFilter(f)}
                    >
                      {f}
                      {f === "草稿" && (
                        <span>
                          {essays.filter((e) => e.status === f).length}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {shown.length > 0 ? (
                  <div className="essay-list">
                    {shown.map((e, i) => (
                      <button
                        className="essay-row"
                        key={e.id}
                        onClick={() => openEssay(e)}
                      >
                        <div
                          className={`essay-icon ${
                            e.status === "已完成" ? "completed" : ""
                          }`}
                        >
                          <Icon
                            name={
                              e.status === "草稿"
                                ? "file"
                                : e.status === "批改中"
                                  ? "clock"
                                  : e.status === "批改失败"
                                    ? "alert"
                                    : "file"
                            }
                            size={23}
                          />
                        </div>
                        <div className="essay-content">
                          <div className="essay-title">{e.title}</div>
                          <div className="essay-meta">
                            <span>{e.date}</span>
                            <span className="meta-divider" />
                            <Status value={e.status} />
                          </div>
                          {i === 0 && e.topic && (
                            <div className="essay-topic">
                              {e.topic} <span>·</span> 读后续写
                            </div>
                          )}
                        </div>
                        <div className="essay-end">
                          {e.score != null ? (
                            <>
                              <span className="score">
                                {e.score}
                                <small> / 25</small>
                              </span>
                              <span className="score-caption">总分</span>
                            </>
                          ) : (
                            <Icon name="chevron" size={16} />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty">
                    <span className="empty-icon">
                      <Icon name="file" size={32} />
                    </span>
                    <h2>
                      {essays.length
                        ? "这里还没有作文"
                        : "让第一篇故事，从这里开始"}
                    </h2>
                    <p>写下你的续写，收获具体的进步建议。</p>
                    <button className="primary" onClick={create}>
                      提交第一篇作文
                      <Icon name="arrow" size={18} />
                    </button>
                  </div>
                )}
                {shown.length > 0 && (
                  <div className="list-end">
                    <span />
                    每一次落笔，都算数
                    <span />
                  </div>
                )}
                <div className="home-note">
                  <Icon name="spark" size={17} />
                  <span>不止于分数，更看见你的每一点进步。</span>
                </div>
              </>
            )}
            {page === "submit" && (
              <div className="form-page">
                <fieldset
                  disabled={recognizing || submitting || capturing}
                  className="editor-fields"
                >
                  <div className="section-eyebrow">
                    <span>新的一篇</span>
                    <span className="autosave">
                      <span className="dot" />
                      {draft.status}
                    </span>
                  </div>
                  <input
                    className="title-input"
                    placeholder="给这篇作文起个标题"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                  {draft.conflict && (
                    <button
                      className="secondary"
                      onClick={() =>
                        void draft.saveCopy().catch((e) => notify(e.message))
                      }
                    >
                      另存为新草稿
                    </button>
                  )}
                  <h3>
                    上传作文图片 <small>选填 · 最多 4 张</small>
                  </h3>
                  <div className="upload-area">
                    {photoUrls.map((url, i) => (
                      <div className="photo-preview" key={url}>
                        <img src={url} alt={`待识别图片 ${i + 1}`} />
                        <button
                          aria-label={`删除图片 ${i + 1}`}
                          onClick={() =>
                            setPhotoFiles((files) =>
                              files.filter((_, n) => n !== i),
                            )
                          }
                        >
                          <Icon name="close" size={14} />
                        </button>
                        <small>{photoFiles[i]?.name}</small>
                      </div>
                    ))}
                  </div>
                  <div className="photo-actions">
                    <button
                      className="secondary"
                      disabled={capturing || recognizing || submitting}
                      onClick={() => void takePhoto()}
                    >
                      <Icon name="camera" size={19} />
                      {capturing ? "正在拍摄…" : "拍照"}
                    </button>
                    <button
                      className="secondary"
                      disabled={capturing || recognizing || submitting}
                      onClick={() => photoInput.current?.click()}
                    >
                      <Icon name="image" size={19} />
                      从相册选择
                    </button>
                  </div>
                  {photos > 0 && (
                    <button
                      className="recognize"
                      onClick={recognize}
                      disabled={recognizing}
                    >
                      <Icon name="spark" size={18} />
                      {recognizing ? "正在识别…" : "识别文字"}
                    </button>
                  )}
                  <label className="field-label">
                    题目原文
                    <textarea
                      className="composition"
                      placeholder="粘贴英文题目原文，补充故事背景…"
                      rows={4}
                      value={sourceText}
                      onChange={(e) => setSourceText(e.target.value)}
                    />
                  </label>
                  <label className="field-label">
                    第一段给定开头
                    <textarea
                      className="composition"
                      placeholder="请输入第一段英文给定开头…"
                      rows={2}
                      value={starters[0]}
                      onChange={(e) =>
                        setStarters([e.target.value, starters[1]])
                      }
                    />
                  </label>
                  <label className="field-label">
                    第二段给定开头
                    <textarea
                      className="composition"
                      placeholder="请输入第二段英文给定开头…"
                      rows={2}
                      value={starters[1]}
                      onChange={(e) =>
                        setStarters([starters[0], e.target.value])
                      }
                    />
                  </label>
                  <label className="field-label">
                    学生续写
                    <span className="field-hint">
                      {text.trim() ? text.trim().split(/\s+/).length : 0} 词
                    </span>
                    <textarea
                      className="composition"
                      placeholder="在这里输入续写，或识别图片中的文字…"
                      rows={8}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                    />
                  </label>
                  <div className="notice">
                    <Icon name="alert" size={17} />
                    请核对识别文字后再提交批改
                  </div>
                  <button
                    className="primary wide"
                    disabled={submitting}
                    onClick={submit}
                  >
                    {submitting ? "正在分析作文，请稍候…" : "提交批改"}
                    <Icon name="arrow" size={18} />
                  </button>
                  <p className="privacy-note">
                    识别与批改会将所选照片或核对后的文字发送至你配置的模型服务商。
                  </p>
                  <button
                    className="secondary wide"
                    onClick={() => void deleteDraft()}
                  >
                    删除当前草稿
                  </button>
                </fieldset>
              </div>
            )}
            {page === "result" && selected && (
              <ResultReport
                key={selected.id}
                submission={selected.record}
                teacher={me?.role === "teacher"}
                onUpdate={upsert}
                onExport={() => overlay("export")}
                onDelete={() => deleteEssay(selected.id)}
                notify={notify}
              />
            )}
          </main>
          {page === "home" && (
            <footer className="home-footer">
              <button className="primary wide" onClick={create}>
                <Icon name="plus" size={21} />
                提交作文
                <span className="button-end">
                  <Icon name="arrow" size={19} />
                </span>
              </button>
              <span>让好故事，拥有更好的表达</span>
            </footer>
          )}
        </MotionPage>
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {drawer && (
          <MotionOverlay className="overlay drawer-overlay">
            <motion.button
              variants={overlayMotion.backdrop}
              transition={overlayMotion.backdropTransition}
              className="backdrop"
              aria-label="关闭侧边导航"
              onClick={() => setDrawer(false)}
            />
            <motion.aside
              variants={overlayMotion.drawer}
              className="drawer"
              onTouchStart={(e) => {
                touch.current = e.touches[0].clientX;
              }}
              onTouchEnd={(e) => {
                if (touch.current - e.changedTouches[0].clientX > 60)
                  setDrawer(false);
              }}
            >
              <div className="drawer-brand">
                <Logo />
                <div>
                  续写批改站<small>让每一次续写，都有进步</small>
                </div>
                <button
                  className="icon-button"
                  aria-label="关闭导航"
                  onClick={() => setDrawer(false)}
                >
                  <Icon name="close" size={19} />
                </button>
              </div>
              <nav>
                <button
                  className={page === "home" ? "selected" : ""}
                  onClick={() => go("home")}
                >
                  <Icon name="file" size={21} />
                  我的作文<span>{essays.length}</span>
                </button>
                <button
                  className={page === "submit" ? "selected" : ""}
                  onClick={create}
                >
                  <Icon name="plus" size={21} />
                  提交作文
                </button>
                <button onClick={() => overlay("settings")}>
                  <Icon name="settings" size={21} />
                  设置
                </button>
              </nav>
              <div className="recent-label">最近作文</div>
              <div className="recent-list">
                {essays.map((e) => (
                  <button
                    key={e.id}
                    className={
                      page === "result" && selected?.id === e.id
                        ? "selected"
                        : ""
                    }
                    onClick={() => openEssay(e)}
                  >
                    <span>{e.title}</span>
                    <Status value={e.status} />
                  </button>
                ))}
                {essays.length === 0 && <p>还没有作文记录</p>}
              </div>
              <div className="drawer-user">
                <span className="avatar">{user.slice(0, 1)}</span>
                <div>
                  <strong>{user}</strong>
                  <small>本机资料 · 不会云同步</small>
                </div>
                <button
                  className="switch-user"
                  onClick={() => overlay("users")}
                >
                  切换用户
                </button>
              </div>
            </motion.aside>
          </MotionOverlay>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {sheet && (
          <MotionOverlay className="overlay sheet-overlay">
            <motion.button
              variants={overlayMotion.backdrop}
              transition={overlayMotion.backdropTransition}
              className="backdrop"
              aria-label="关闭面板"
              onClick={() => {
                setSheet("");
                setSub("");
              }}
            />
            <motion.section
              variants={overlayMotion.sheet}
              className={`sheet ${sheet !== "settings" ? "small-sheet" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-label={
                sheet === "settings"
                  ? "设置"
                  : sheet === "users"
                    ? "本机用户"
                    : "导出批改"
              }
            >
              <div
                className="sheet-drag"
                onTouchStart={(e) => {
                  touch.current = e.touches[0].clientY;
                }}
                onTouchEnd={(e) => {
                  if (e.changedTouches[0].clientY - touch.current > 65) {
                    setSheet("");
                    setSub("");
                  }
                }}
              >
                <i />
              </div>
              <div className="sheet-header">
                {sub && (
                  <button
                    className="icon-button"
                    aria-label="返回设置"
                    onClick={() => setSub("")}
                  >
                    <Icon name="back" />
                  </button>
                )}
                <h2>
                  {sheet === "settings"
                    ? sub || "设置"
                    : sheet === "users"
                      ? "本机用户"
                      : "导出批改"}
                </h2>
                <button
                  className="icon-button"
                  aria-label="关闭面板"
                  onClick={() => {
                    setSheet("");
                    setSub("");
                  }}
                >
                  <Icon name="close" size={21} />
                </button>
              </div>
              <div className="sheet-body">
                <AnimatePresence
                  initial={false}
                  mode="wait"
                  custom={sub ? 1 : -1}
                >
                  <MotionPage
                    panel
                    key={`${sheet}:${sub || "root"}`}
                    direction={sub ? 1 : -1}
                  >
                    {sheet === "settings" && !sub && (
                      <>
                        <div className="settings-group">
                          <h3>模型与接口</h3>
                          <Row
                            icon="spark"
                            title="模型配置"
                            value="服务商与 API Key"
                            onClick={() => setSub("模型配置")}
                          />
                        </div>
                        <div className="settings-group">
                          <h3>外观</h3>
                          <Row
                            icon="sun"
                            title="主题"
                            value={theme}
                            onClick={() => setSub("主题")}
                          />
                          <Row
                            title="正文字号"
                            value={font}
                            onClick={() => setSub("正文字号")}
                          />
                        </div>
                        <div className="settings-group">
                          <h3>本地数据</h3>
                          <Row
                            icon="download"
                            title="导出备份"
                            onClick={() => void backup()}
                          />
                          <Row
                            icon="upload"
                            title="导入备份"
                            onClick={() => backupInput.current?.click()}
                          />
                          <Row
                            icon="trash"
                            title="清理作文数据"
                            danger
                            onClick={() => setConfirm(true)}
                          />
                        </div>
                        <div className="settings-group about">
                          <h3>关于</h3>
                          <Row title="续写批改站" value={`版本 ${version}`} />
                          <p>AI 批改供学习参考</p>
                          <span>
                            作文记录保存在本机；模型调用直接连接你选择的服务商。
                          </span>
                        </div>
                      </>
                    )}
                    {sheet === "settings" &&
                      (sub === "主题" || sub === "正文字号") && (
                        <div className="choice-list">
                          {(sub === "主题"
                            ? ["浅色", "深色", "跟随系统"]
                            : ["小", "标准", "大", "特大"]
                          ).map((option) => (
                            <button
                              key={option}
                              onClick={() => void chooseAppearance(option)}
                            >
                              {option}
                              {(sub === "主题" ? theme : font) === option && (
                                <Icon name="check" size={20} />
                              )}
                            </button>
                          ))}
                          {sub === "正文字号" && (
                            <div className="font-preview composition">
                              文字有温度，故事有回响。
                              <br />
                              每一次认真落笔，都是向前的一步。
                            </div>
                          )}
                        </div>
                      )}
                    {sheet === "settings" && sub === "模型配置" && (
                      <ModelConfiguration
                        onSave={() => notify("模型配置已保存")}
                      />
                    )}
                    {sheet === "users" && (
                      <>
                        <p className="sheet-description">
                          切换本机上的学习资料。这里不是云端账号，
                          <br />
                          作文与设置不会同步到其他设备。
                        </p>
                        {knownUsers.map((name) => (
                          <button
                            className="user-option"
                            key={name}
                            onClick={() => void switchUser(name)}
                          >
                            <span className="avatar">{name[0]}</span>
                            <span>
                              {name}
                              <small>本机资料</small>
                            </span>
                            {user === name && <Icon name="check" />}
                          </button>
                        ))}
                        <label className="field-label">
                          新用户或其他用户名
                          <input
                            value={userName}
                            onChange={(e) => setUserName(e.target.value)}
                            placeholder="2–24位中文、字母或数字"
                          />
                        </label>
                        <button
                          className="primary wide"
                          onClick={() => void switchUser(userName)}
                        >
                          进入本机资料
                        </button>
                      </>
                    )}
                    {sheet === "export" && (
                      <>
                        <p className="sheet-description">
                          保存你的进步，方便随时回顾。
                        </p>
                        <Row
                          icon="file"
                          title="导出 PDF"
                          value="适合打印与分享"
                          onClick={() => void exportResult("pdf")}
                        />
                        <Row
                          icon="image"
                          title="导出长图"
                          value="完整批改结果"
                          onClick={() => void exportResult("image")}
                        />
                        {isAndroid() && (
                          <>
                            <Row
                              icon="file"
                              title="分享 PDF"
                              value="发送到其他应用"
                              onClick={() => void exportResult("pdf", "share")}
                            />
                            <Row
                              icon="image"
                              title="分享长图"
                              value="发送到其他应用"
                              onClick={() =>
                                void exportResult("image", "share")
                              }
                            />
                          </>
                        )}
                      </>
                    )}
                  </MotionPage>
                </AnimatePresence>
              </div>
              <div className="sheet-bottom" />
            </motion.section>
          </MotionOverlay>
        )}
      </AnimatePresence>
      {confirm && (
        <div className="overlay confirm-overlay">
          <div className="backdrop" />
          <div
            className="confirm-box"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <span className="delete-icon">
              <Icon name="trash" size={25} />
            </span>
            <h2 id="confirm-title">清理所有作文？</h2>
            <p>
              将删除当前用户的所有作文和批改结果，其他用户与模型配置不受影响。请先导出备份。
            </p>
            <button className="delete-button" onClick={() => void clearData()}>
              确认清理
            </button>
            <button
              className="secondary wide"
              onClick={() => setConfirm(false)}
            >
              取消
            </button>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
