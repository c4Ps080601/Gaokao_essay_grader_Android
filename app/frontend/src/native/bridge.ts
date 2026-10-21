import { Capacitor, registerPlugin } from "@capacitor/core";
import type { CaptureResult } from "./media-policy.mjs";
import type { PdfReport } from "./report-document.mjs";
export const isAndroid = () => Capacitor.getPlatform() === "android";
export interface NativeBridge {
  startTask(options: { token: string }): Promise<void>;
  endTask(options: { token: string }): Promise<void>;
  minimizeApp(): Promise<void>;
  checkNetwork(options: { url: string }): Promise<{ message: string }>;
  capturePhoto(options: { token: string }): Promise<CaptureResult>;
  saveFile(options: {
    name: string;
    data: string;
    mime: string;
  }): Promise<{ canceled?: boolean }>;
  exportPdf(options: {
    name: string;
    report: PdfReport;
    share: boolean;
  }): Promise<{ canceled?: boolean }>;
  readState(): Promise<{ value: string | null }>;
  writeState(options: { value: string }): Promise<void>;
  seal(options: { value: string }): Promise<{ value: string }>;
  unseal(options: { value: string }): Promise<{ value: string }>;
  http(options: {
    url: string;
    headers: Record<string, string>;
    body: string;
    timeout: number;
  }): Promise<{ status: number; data: string }>;
  shareFile(options: {
    name: string;
    data: string;
    mime: string;
  }): Promise<void>;
}
export const native = registerPlugin<NativeBridge>("EssayNative");
let runtime:
  | Promise<{
      request: (
        path: string,
        method?: string,
        body?: unknown,
      ) => Promise<unknown>;
    }>
  | undefined;
export function nativeRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  runtime ??= import("./runtime.mjs").then(({ createRuntime }) =>
    createRuntime(native),
  );
  return runtime.then((r) => r.request(path, method, body)) as Promise<T>;
}
