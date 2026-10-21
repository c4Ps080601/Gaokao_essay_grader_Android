import DisclosureSummary from "./DisclosureSummary";
import { useEffect, useRef, useState } from "react";
import { api, type ModelConfig, type Settings } from "./api";
import { isAndroid, native } from "./native/bridge";
export default function ModelSettings({ onSave }: { onSave: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null),
    [grade, setGrade] = useState<ModelConfig | null>(null),
    [ocr, setOcr] = useState<ModelConfig | null>(null);
  const [key, setKey] = useState(""),
    [ocrKey, setOcrKey] = useState(""),
    [shared, setShared] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [visible, setVisible] = useState(false),
    [savedKeyView, setSavedKeyView] = useState("");
  const revealRevision = useRef(0);
  const hideKey = () => {
    revealRevision.current++;
    setSavedKeyView("");
    setVisible(false);
  };
  useEffect(() => {
    const hide = () => {
      if (document.hidden) hideKey();
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("essay-background", hideKey);
    return () => {
      revealRevision.current++;
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("essay-background", hideKey);
    };
  }, []);
  useEffect(() => {
    api<Settings>("/api/settings")
      .then((s) => {
        setSettings(s);
        setGrade(s.ai.grade);
        setOcr(s.ai.ocr);
        setShared(
          s.ai.sameOCR ||
            !!s.ai.sharedOCRKey ||
            (!s.ai.grade.hasKey && !s.ai.ocr.hasKey),
        );
      })
      .catch((e) => setMessage(e.message));
  }, []);
  if (!settings || !grade || !ocr)
    return <p role="status">{message || "正在读取配置…"}</p>;
  const presets = settings.ai.presets;
  const changeProvider = (id: string, stage: "grade" | "ocr") => {
    const p = presets.find((p) => p.id === id)!,
      old = stage === "grade" ? grade : ocr;
    const config = {
      ...old,
      provider: id,
      baseUrl: p.baseUrl,
      protocol: p.protocol,
      model: (stage === "grade" ? p.gradeModel : p.ocrModel) || "",
      hasKey: false,
      clearKey: true,
    };
    if (stage === "grade") {
      hideKey();
      setGrade(config);
      setKey("");
      if (shared) {
        setOcr({ ...config, model: p.ocrModel || "" });
        setOcrKey("");
      }
    } else {
      setOcr(config);
      setOcrKey("");
    }
    setMessage("");
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const data = await api<{ ai: Settings["ai"] }>("/api/settings", "PUT", {
        ai: {
          grade: { ...grade, apiKey: key || undefined },
          ocr: shared
            ? {
                ...ocr,
                provider: grade.provider,
                baseUrl: grade.baseUrl,
                protocol: grade.protocol,
                shareKeyWithGrade: true,
              }
            : { ...ocr, apiKey: ocrKey || undefined },
        },
      });
      setSettings({ ...settings, ai: data.ai });
      setGrade(data.ai.grade);
      setOcr(data.ai.ocr);
      setKey("");
      setOcrKey("");
      hideKey();
      setMessage(
        data.ai.grade.hasKey
          ? "已加密保存，尚未测试连接。"
          : "配置已保存，当前未保存批改 API Key。",
      );
      onSave();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const test = async (stage: string) => {
    if (
      !window.confirm(
        "测试使用已保存的配置，发送短文本，可能产生少量费用。继续吗？",
      )
    )
      return;
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/api/ai-test", "POST", {
        stage,
      });
      setMessage(r.message);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggleKey = async () => {
    if (visible) {
      hideKey();
      return;
    }
    if (key) {
      setVisible(true);
      return;
    }
    if (!grade.hasKey) {
      setMessage("请先填写 API Key。");
      return;
    }
    const revision = ++revealRevision.current;
    setBusy(true);
    try {
      const result = await api<{ apiKey: string }>(
        "/api/settings/reveal-key",
        "POST",
        { stage: "grade" },
      );
      if (revealRevision.current !== revision) return;
      if (!result.apiKey) throw new Error("无法读取已保存的 Key，请重新填写。");
      setSavedKeyView(result.apiKey);
      setVisible(true);
      setMessage("");
    } catch (e) {
      if (revealRevision.current === revision) setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const checkNetwork = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("正在检查当前服务商地址的网络，不会发送 Key 或作文…");
    try {
      setMessage((await native.checkNetwork({ url: grade.baseUrl })).message);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
  ) => (
    <label className="field-label">
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
  const providerField = (stage: "grade" | "ocr") => (
    <label className="field-label">
      {stage === "grade" ? "服务商" : "识别服务商"}
      <select
        value={stage === "grade" ? grade.provider : ocr.provider}
        onChange={(e) => changeProvider(e.target.value, stage)}
      >
        {presets.map((p) => (
          <option value={p.id} key={p.id}>
            {p.id === "deepseek" ? "DeepSeek（推荐）" : p.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="simple-model-form">
      <fieldset className="editor-fields" disabled={busy}>
        <p className="config-intro">选择服务商，填写你的 API Key。</p>
        {!settings.ai.secureStorageAvailable && (
          <p className="notice" role="alert">
            当前运行方式没有系统加密服务，无法保存密钥。请在 Electron
            桌面版中配置；不会降级为明文存储。
          </p>
        )}
        {providerField("grade")}
        <div className="field-label key-field">
          <div className="key-label">
            <label htmlFor="model-api-key">API Key</label>
            {grade.hasKey && <span className="key-badge">已保存</span>}
          </div>
          <div className="model-input">
            <input
              type={visible ? "text" : "password"}
              autoComplete="off"
              id="model-api-key"
              spellCheck={false}
              autoCapitalize="none"
              value={key || savedKeyView}
              onChange={(e) => {
                setKey(e.target.value);
                setSavedKeyView("");
                setMessage("");
              }}
              placeholder={
                grade.hasKey ? "已保存，留空保留" : "填写自己的 API Key"
              }
            />
            <button
              type="button"
              className="key-visibility"
              aria-label={visible ? "隐藏 API Key" : "显示 API Key"}
              aria-pressed={visible}
              disabled={busy || (!key && !grade.hasKey)}
              onClick={() => void toggleKey()}
            >
              {visible ? "隐藏" : "显示"}
            </button>
          </div>
        </div>
        <p className="key-status" role="status" aria-live="polite">
          {message ||
            (key
              ? "新 Key 尚未保存。"
              : grade.hasKey
                ? "留空保留，输入新 Key 可替换。"
                : "密钥仅加密保存在本机。")}
        </p>
        <button
          className="primary wide"
          disabled={busy || !settings.ai.secureStorageAvailable}
          onClick={save}
        >
          {busy ? "正在保存或测试…" : "保存配置"}
        </button>
        <details className="model-advanced">
          <DisclosureSummary>高级设置</DisclosureSummary>
          {field("批改接口地址", grade.baseUrl, (v) => {
            hideKey();
            setGrade({ ...grade, baseUrl: v, clearKey: true, hasKey: false });
          })}
          {field("批改模型", grade.model, (v) =>
            setGrade({ ...grade, model: v }),
          )}
          <label className="field-label">
            接口协议
            <select
              value={grade.protocol}
              onChange={(e) => {
                hideKey();
                setGrade({
                  ...grade,
                  protocol: e.target.value,
                  clearKey: true,
                  hasKey: false,
                });
              }}
            >
              <option value="chat">Chat Completions</option>
              <option value="responses">Responses</option>
              <option value="anthropic">Messages</option>
            </select>
          </label>
          <label className="field-label">
            思考强度
            <select
              value={grade.effort}
              onChange={(e) => setGrade({ ...grade, effort: e.target.value })}
            >
              {["auto", "off", "low", "medium", "high", "max"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="field-label">
            JSON 模式
            <select
              value={grade.jsonMode}
              onChange={(e) => setGrade({ ...grade, jsonMode: e.target.value })}
            >
              {["auto", "prompt", "object"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="toggle-row">
            识别共用同一服务商与 Key
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => {
                setShared(e.target.checked);
                setMessage("");
                if (e.target.checked) {
                  const p = presets.find((p) => p.id === grade.provider);
                  setOcr({ ...grade, model: p?.ocrModel || "" });
                }
              }}
            />
          </label>
          {!shared && (
            <>
              {providerField("ocr")}
              {field("识别接口地址", ocr.baseUrl, (v) =>
                setOcr({ ...ocr, baseUrl: v, clearKey: true, hasKey: false }),
              )}
              <label className="field-label">
                识别协议
                <select
                  value={ocr.protocol}
                  onChange={(e) =>
                    setOcr({
                      ...ocr,
                      protocol: e.target.value,
                      clearKey: true,
                      hasKey: false,
                    })
                  }
                >
                  {["chat", "responses", "anthropic"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                识别 Key {ocr.hasKey ? "（已配置，留空保留）" : ""}
                <input
                  type="password"
                  autoComplete="off"
                  value={ocrKey}
                  onChange={(e) => {
                    setOcrKey(e.target.value);
                    setMessage("");
                  }}
                  placeholder={
                    ocr.hasKey
                      ? "••••••••（已保存，输入可替换）"
                      : "填写识别服务的 API Key"
                  }
                />
              </label>
            </>
          )}
          {field("图片识别模型（必须支持视觉输入）", ocr.model, (v) =>
            setOcr({ ...ocr, model: v }),
          )}
          <p className="config-intro">
            地区、套餐、自定义服务请填写对应的接口地址。无法仅凭 Key
            自动推断全部配置。
          </p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void test("grade")}
          >
            测试已保存的批改连接
          </button>
          {isAndroid() && (
            <button
              className="secondary wide"
              onClick={() => void checkNetwork()}
              disabled={busy}
            >
              检查网络（不调用模型）
            </button>
          )}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void test("ocr")}
          >
            测试已保存的识别文本连接
          </button>
          <label className="toggle-row">
            删除已保存的批改密钥
            <input
              type="checkbox"
              checked={!!grade.clearKey}
              onChange={(e) =>
                setGrade({ ...grade, clearKey: e.target.checked })
              }
            />
          </label>
          <button
            className="secondary wide"
            onClick={save}
            disabled={busy || !settings.ai.secureStorageAvailable}
          >
            保存高级配置
          </button>
        </details>
        <p className="privacy-note">作文仅在识别或批改时发送至所选服务商。</p>
      </fieldset>
    </div>
  );
}
