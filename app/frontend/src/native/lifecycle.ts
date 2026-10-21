import { App } from "@capacitor/app";
import { isAndroid } from "./bridge";
import type { CaptureResult } from "./media-policy.mjs";
let restoredCapture: CaptureResult | null = null;
export function peekRestoredCapture() {
  return restoredCapture;
}
export function clearRestoredCapture() {
  restoredCapture = null;
}
export function startNativeLifecycle() {
  if (!isAndroid()) return;
  document.documentElement.classList.add("android-native");
  void App.addListener("appRestoredResult", (result) => {
    if (result.pluginId !== "EssayNative") return;
    if (result.methodName === "capturePhoto") {
      restoredCapture = result.success ? result.data : { canceled: true };
      window.dispatchEvent(new Event("essay-camera-restored"));
    } else if (
      result.methodName === "saveFile" ||
      result.methodName === "exportPdf"
    ) {
      window.dispatchEvent(
        new CustomEvent("essay-export-restored", {
          detail:
            result.success && !result.data?.canceled
              ? "文件已保存"
              : result.success
                ? "已取消保存"
                : "文件保存失败，请重新导出",
        }),
      );
    }
  });
  void App.addListener("backButton", () =>
    window.dispatchEvent(new Event("essay-back")),
  );
  void App.addListener("appStateChange", ({ isActive }) => {
    if (!isActive) window.dispatchEvent(new Event("essay-background"));
  });
}
