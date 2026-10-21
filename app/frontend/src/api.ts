import { isAndroid, native, nativeRequest } from "./native/bridge";
export type User = { id: string; name: string; username: string; role: string };
export type ReviewItem = {
  original?: string;
  fix?: string;
  quote?: string;
  reason?: string;
  note?: string;
  alternative?: string;
  benefit?: string;
  possibleFix?: string;
};
export type GradeResult = {
  score: number;
  summary: string;
  polished?: string;
  model?: string;
  errorCount?: number;
  dimensions: Record<string, { score: number; comment: string }>;
  errors?: ReviewItem[];
  uncertainIssues?: ReviewItem[];
  improvements?: ReviewItem[];
  highlights?: string[];
  suggestions?: string[];
  assessment?: { reason?: string; taskNotes?: string[] };
};
export type Submission = {
  id: string;
  title: string;
  originalText: string;
  essayText: string;
  userId: string;
  status: "draft" | "pending" | "grading" | "done" | "error";
  createdAt: number;
  updatedAt: number;
  draftRevision: number;
  result: GradeResult | null;
  error: string | null;
  teacherScore: number | null;
  teacherNote: string | null;
  authorName?: string;
  queuePos?: number | null;
};
export type ModelConfig = {
  provider: string;
  baseUrl: string;
  protocol: string;
  model: string;
  effort: string;
  jsonMode: string;
  hasKey?: boolean;
  apiKey?: string;
  clearKey?: boolean;
  shareKeyWithGrade?: boolean;
};
export type Preset = {
  id: string;
  name: string;
  baseUrl: string;
  protocol: string;
  gradeModel?: string;
  ocrModel?: string;
};
export type Settings = {
  theme: string;
  fontScale: number;
  version: string;
  ai: {
    presets: Preset[];
    secureStorageAvailable: boolean;
    grade: ModelConfig;
    ocr: ModelConfig;
    sameOCR: boolean;
    sharedOCRKey?: boolean;
  };
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if (isAndroid()) return nativeRequest<T>(path, method, body);
  const multipart = body instanceof FormData;
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers:
      body && !multipart ? { "Content-Type": "application/json" } : undefined,
    body: body ? (multipart ? body : JSON.stringify(body)) : undefined,
  });
  const value = await response
    .json()
    .catch(() => ({ error: "服务返回了无法解析的响应" }));
  if (!response.ok)
    throw new ApiError(
      value.error || `请求失败（${response.status}）`,
      response.status,
    );
  return value as T;
}
export async function downloadBlob(
  blob: Blob,
  name: string,
  mode: "save" | "share" = "save",
): Promise<boolean> {
  if (isAndroid()) {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("无法读取导出文件"));
      reader.readAsDataURL(blob);
    });
    const options = {
      name,
      data,
      mime: blob.type || "application/json",
    };
    if (mode === "share") await native.shareFile(options);
    else if ((await native.saveFile(options)).canceled) return false;
    return true;
  }
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
export async function compressImage(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(
      1,
      1600 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理图片，请重试");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("图片压缩失败"))),
        "image/jpeg",
        0.85,
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function splitMaterial(originalText: string) {
  const starters = [1, 2].map(
    (n) =>
      originalText.match(new RegExp(`^Paragraph ${n}: (.*)$`, "mi"))?.[1] || "",
  );
  return {
    sourceText: originalText.replace(/^Paragraph [12]: .*\r?\n?/gim, "").trim(),
    starters,
  };
}
export function materialText(source: string, starters: string[]) {
  return [
    source,
    ...starters.map((s, i) =>
      s.trim() ? `Paragraph ${i + 1}: ${s.trim()}` : "",
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
}
export const statusName = (s: Submission["status"]) =>
  ({
    draft: "草稿",
    pending: "批改中",
    grading: "批改中",
    done: "已完成",
    error: "批改失败",
  })[s];
