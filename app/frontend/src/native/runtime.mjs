import {
  PRESETS,
  normalizeConfig,
  buildRequest,
  outputText,
} from "./generated/providers.mjs";
import { createEngine } from "./generated/engine.mjs";
import { decodeBackup } from "./generated/backup.mjs";

const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const fields = (body) =>
  Object.fromEntries(
    ["title", "originalText", "essayText"].map((k) => {
      if (body[k] != null && typeof body[k] !== "string")
        fail("作文内容格式无效");
      const text = body[k] || "";
      if (text.length > 200000) fail("单项内容过长");
      return [k, text];
    }),
  );
const wordCount = (text) => text.trim().split(/\s+/).filter(Boolean).length;
const defaultConfig = (stage) => ({
  ...normalizeConfig({ provider: "deepseek" }, stage),
  credential: null,
});

/** Platform-independent local API. Bridge is injectable for fault-injection tests. */
export function createRuntime(bridge, options = {}) {
  let state,
    chain = Promise.resolve(),
    running = false;
  const jobs = [],
    pending = new Set();
  const leases = new Map();
  const uuid = options.uuid || (() => crypto.randomUUID());
  const ready = (async () => {
    const { value } = await bridge.readState();
    state =
      value == null
        ? {
            version: 1,
            users: [],
            currentUserId: null,
            submissions: [],
            settings: {
              theme: "light",
              fontScale: 1,
              ai: { grade: defaultConfig("grade"), ocr: defaultConfig("ocr") },
            },
          }
        : JSON.parse(value);
    if (
      state.version !== 1 ||
      !Array.isArray(state.users) ||
      !Array.isArray(state.submissions) ||
      !state.settings?.ai
    )
      fail("本机数据无法读取，请保留数据并联系开发者", 500);
    let recovered = false;
    for (const s of state.submissions)
      if (["pending", "grading"].includes(s.status)) {
        s.status = "error";
        s.error = "上次退出时批改中断，原稿已保留；请手动重新批改。";
        recovered = true;
      }
    if (recovered) await bridge.writeState({ value: JSON.stringify(state) });
  })();
  const transaction = (fn) => {
    const operation = chain
      .catch(() => {})
      .then(async () => {
        await ready;
        const previous = clone(state);
        try {
          const result = await fn();
          await bridge.writeState({ value: JSON.stringify(state) });
          return clone(result);
        } catch (e) {
          state = previous;
          throw e;
        }
      });
    chain = operation;
    return operation;
  };
  const read = async (fn) => {
    await ready;
    await chain.catch(() => {});
    return clone(fn());
  };
  const user = () =>
    state.users.find((u) => u.id === state.currentUserId) ||
    fail("未登录", 401);
  const visible = (s) => user().role === "teacher" || s.userId === user().id;
  const get = (id) => {
    const s = state.submissions.find((s) => s.id === id);
    if (!s) fail("作文不存在", 404);
    if (!visible(s)) fail("无权查看他人作文", 403);
    return s;
  };
  const decorate = (s) => ({
    ...s,
    authorName: state.users.find((u) => u.id === s.userId)?.name || "本机用户",
    queuePos: jobs.indexOf(s.id),
  });
  const newRecord = (input) => ({
    id: uuid(),
    userId: user().id,
    title: "未命名作文",
    originalText: "",
    essayText: "",
    status: "draft",
    result: null,
    error: null,
    teacherScore: null,
    teacherNote: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    draftRevision: 1,
    ...input,
  });
  const revise = (s, body) => {
    if (s.userId !== user().id) fail("只能编辑自己的草稿", 403);
    if (s.status !== "draft" || body.revision !== s.draftRevision)
      fail("草稿已在别处更新，当前输入已保留，请另存为新草稿", 409);
    Object.assign(s, fields(body));
    s.title = s.title.trim() || "未命名作文";
    s.draftRevision++;
    s.wordCount = wordCount(s.essayText);
    s.updatedAt = Date.now();
  };
  const publicSettings = () => ({
    theme: state.settings.theme,
    fontScale: state.settings.fontScale,
    version: "0.1.8",
    ai: {
      presets: PRESETS,
      secureStorageAvailable: true,
      sameOCR: !!state.settings.sameOCR,
      sharedOCRKey: !!state.settings.sharedOCRKey,
      ...Object.fromEntries(
        ["grade", "ocr"].map((stage) => {
          const { credential, ...config } = state.settings.ai[stage];
          return [
            stage,
            { ...config, hasKey: !!credential, storedKey: !!credential },
          ];
        }),
      ),
    },
  });
  const updateSettings = async (body) => {
    const s = state.settings;
    if (body.theme !== undefined) {
      if (!["light", "dark"].includes(body.theme)) fail("外观参数无效");
      s.theme = body.theme;
    }
    if (body.fontScale !== undefined) {
      if (![0.85, 1, 1.15, 1.3].includes(Number(body.fontScale)))
        fail("字体大小参数无效");
      s.fontScale = Number(body.fontScale);
    }
    if (body.ai !== undefined) {
      if (!body.ai || typeof body.ai !== "object" || Array.isArray(body.ai))
        fail("API配置格式不正确");
      for (const stage of ["grade", "ocr"]) {
        const input = body.ai[stage];
        if (input === undefined) continue;
        if (!input || typeof input !== "object" || Array.isArray(input))
          fail("模型配置格式不正确");
        if (stage === "ocr" && input.sameAsGrade) {
          s.ai.ocr = { ...s.ai.grade };
          s.sameOCR = true;
          s.sharedOCRKey = true;
          continue;
        }
        const config = normalizeConfig(input, stage),
          old = s.ai[stage];
        if (new URL(config.baseUrl).protocol !== "https:")
          fail("安卓首版仅支持HTTPS模型接口");
        const same =
          old.provider === config.provider &&
          old.baseUrl === config.baseUrl &&
          old.protocol === config.protocol;
        config.credential = same && !input.clearKey ? old.credential : null;
        if (stage === "ocr") {
          s.sameOCR = false;
          s.sharedOCRKey = false;
        }
        if (stage === "ocr" && input.shareKeyWithGrade) {
          const g = s.ai.grade;
          if (
            g.provider !== config.provider ||
            g.baseUrl !== config.baseUrl ||
            g.protocol !== config.protocol
          )
            fail("共用密钥须使用相同服务商、接口地址与协议");
          config.credential = g.credential;
          s.sharedOCRKey = true;
        } else if (input.apiKey !== undefined && input.apiKey !== "") {
          if (
            typeof input.apiKey !== "string" ||
            input.apiKey.trim().length < 8 ||
            /[\r\n]/.test(input.apiKey)
          )
            fail("API Key格式不正确");
          config.credential = (
            await bridge.seal({ value: input.apiKey.trim() })
          ).value;
        }
        s.ai[stage] = config;
      }
      if (
        body.ai.grade !== undefined &&
        body.ai.ocr === undefined &&
        s.sharedOCRKey
      ) {
        const g = s.ai.grade,
          o = s.ai.ocr;
        if (s.sameOCR) s.ai.ocr = { ...g };
        else if (
          g.provider === o.provider &&
          g.baseUrl === o.baseUrl &&
          g.protocol === o.protocol
        )
          s.ai.ocr = { ...o, credential: g.credential };
        else fail("共用密钥时更换接口须同时更新OCR配置");
      }
    }
    return { ok: true, ...publicSettings() };
  };
  const plainConfig = async (config) => ({
    ...config,
    apiKey: config.credential
      ? (await bridge.unseal({ value: config.credential })).value
      : "",
  });
  const transport =
    options.transport ||
    (async (messages, config, opts) => {
      if (!config.apiKey)
        fail("尚未填写API Key，请打开设置配置自己的密钥", 401);
      const request = buildRequest(messages, config, opts);
      let response;
      try {
        response = await bridge.http({
          url: request.url,
          headers: request.headers,
          body: JSON.stringify(request.body),
          timeout: opts.timeoutMs || 180000,
        });
      } catch (e) {
        throw Object.assign(
          new Error(
            (e.message || "网络连接中断") +
              " 服务商可能已处理并计费，为避免重复调用，本次未自动重发；请先返回查看结果再决定是否重试。",
          ),
          { retryable: false },
        );
      }
      if (response.status < 200 || response.status >= 300) {
        const hints = {
          400: "请求参数不兼容，请核对模型、协议及图片能力",
          401: "API Key无效，请在设置中更换",
          402: "服务商账户余额不足",
          403: "无权访问该模型",
          404: "模型或接口不存在",
          413: "图片或请求过大",
          429: "请求频率过高或额度不足",
        };
        fail(
          `模型服务返回 ${response.status}：${hints[response.status] || "服务暂时不可用，请稍后重试"}`,
          response.status,
        );
      }
      let data;
      try {
        data = JSON.parse(response.data);
      } catch {
        fail("服务商返回了非JSON响应，请检查接口地址", 502);
      }
      const text = outputText(data, config.protocol);
      if (!text) fail("模型未返回正文", 502);
      return text;
    });
  async function pump() {
    if (running) return;
    running = true;
    try {
      while (jobs.length) {
        const id = jobs.shift();
        const lease = leases.get(id);
        pending.delete(id);
        let snapshot;
        try {
          snapshot = await transaction(() => {
            const s = state.submissions.find((s) => s.id === id);
            if (!s || s.status !== "pending") return null;
            s.status = "grading";
            s.runId = uuid();
            return { submission: s, config: state.settings.ai.grade };
          });
          if (!snapshot) continue;
          const config = await plainConfig(snapshot.config),
            engine = createEngine(() => config, transport);
          const result = await engine.gradeSubmission(snapshot.submission);
          await transaction(() => {
            const s = state.submissions.find(
              (s) => s.id === id && s.runId === snapshot.submission.runId,
            );
            if (s) {
              s.result = result;
              s.status = "done";
              s.error = null;
              s.gradedAt = Date.now();
              s.updatedAt = Date.now();
              if (result.title) s.title = result.title;
            }
            return null;
          });
        } catch (e) {
          try {
            await transaction(() => {
              const s = state.submissions.find(
                (s) =>
                  s.id === id &&
                  (!snapshot || s.runId === snapshot.submission.runId),
              );
              if (s) {
                s.status = "error";
                s.error = String(e.message || e);
                s.updatedAt = Date.now();
              }
              return null;
            });
          } catch {
            /* Disk failure remains visible as an interrupted task on restart. */
          }
        } finally {
          if (lease) {
            if (leases.get(id) === lease) leases.delete(id);
            await bridge.endTask?.({ token: lease }).catch(() => {});
          }
        }
      }
    } finally {
      running = false;
    }
  }
  const schedule = (id) => {
    if (!pending.has(id)) {
      pending.add(id);
      jobs.push(id);
    }
    setTimeout(() => void pump(), 0);
  };
  const request = async (path, method = "GET", body = {}) => {
    body ??= {};
    if (path === "/api/me" && method === "GET")
      return read(() => ({ user: user() }));
    if (path === "/api/enter" && method === "POST")
      return transaction(() => {
        const name = String(body.username || "").trim();
        if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]{2,24}$/.test(name))
          fail("用户名需为2–24位中文、字母、数字或下划线");
        let u = state.users.find(
          (u) => u.username.toLowerCase() === name.toLowerCase(),
        );
        if (!u) {
          u = {
            id: uuid(),
            username: name,
            name,
            role: name === "教师" ? "teacher" : "student",
            createdAt: Date.now(),
          };
          state.users.push(u);
        }
        state.currentUserId = u.id;
        return { user: u };
      });
    if (path === "/api/settings/reveal-key" && method === "POST") {
      if (!["grade", "ocr"].includes(body.stage)) fail("密钥类型无效");
      const config = await read(() => {
        user();
        return state.settings.ai[body.stage];
      });
      return { apiKey: (await plainConfig(config)).apiKey };
    }
    if (path === "/api/settings") {
      if (method === "GET")
        return read(() => {
          user();
          return publicSettings();
        });
      if (method === "PUT")
        return transaction(() => {
          user();
          return updateSettings(body);
        });
    }
    if (path === "/api/ai-test" && method === "POST") {
      const config = await read(() => {
        user();
        if (!["grade", "ocr"].includes(body.stage)) fail("测试类型无效");
        return state.settings.ai[body.stage];
      });
      await transport(
        [{ role: "user", content: "Reply with OK." }],
        await plainConfig(config),
        { timeoutMs: 30000, reasoningEffort: "low" },
      );
      return {
        ok: true,
        message: "文本连接测试成功；图片能力与批改质量需要另外验证。",
      };
    }
    if (path === "/api/ocr" && method === "POST") {
      const config = await read(() => {
        user();
        return state.settings.ai.ocr;
      });
      if (!(body instanceof FormData)) fail("图片格式无效");
      const images = body.getAll("images");
      if (!images.length || images.length > 4) fail("请选择1–4张图片");
      const urls = await Promise.all(
        images.map(async (image) => {
          if (
            typeof image === "string" ||
            !["image/jpeg", "image/png", "image/webp"].includes(image.type) ||
            image.size > 12 * 1024 * 1024
          )
            fail("图片格式或大小无效");
          const bytes = new Uint8Array(await image.arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i += 8192)
            binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          return `data:${image.type};base64,${btoa(binary)}`;
        }),
      );
      const plain = await plainConfig(config);
      return {
        fields: await createEngine(() => plain, transport).recognizeImages(
          urls,
        ),
      };
    }
    if (path === "/api/submissions" && method === "GET")
      return read(() => {
        user();
        return {
          submissions: state.submissions
            .filter(visible)
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map(decorate),
        };
      });
    if (path === "/api/drafts" && method === "POST")
      return transaction(() => {
        const u = user();
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(body.clientId || ""))
          fail("草稿标识无效");
        const existing = state.submissions.find(
          (s) => s.userId === u.id && s.clientId === body.clientId,
        );
        if (existing) return { submission: decorate(existing) };
        const f = fields(body);
        if (!Object.values(f).some((t) => t.trim())) fail("空白内容无需保存");
        const s = newRecord({
          ...f,
          clientId: body.clientId,
          wordCount: wordCount(f.essayText),
        });
        s.title = s.title.trim() || "未命名作文";
        state.submissions.push(s);
        return { submission: decorate(s) };
      });
    const match = path.match(
      /^\/api\/(drafts|submissions)\/([^/]+)(?:\/(submit|regrade))?$/,
    );
    if (match) {
      const [, kind, id, action] = match;
      if (method === "GET" && !action)
        return read(() => ({ submission: decorate(get(id)) }));
      if (method === "PUT" && kind === "drafts")
        return transaction(() => {
          const s = get(id);
          revise(s, body);
          return { submission: decorate(s) };
        });
      if (method === "POST" && ["submit", "regrade"].includes(action)) {
        let acquired;
        let response;
        try {
          response = await transaction(async () => {
            const s = get(id);
            if (["pending", "grading"].includes(s.status))
              return { submission: decorate(s) };
            if (action === "submit") {
              if (s.status !== "draft") return { submission: decorate(s) };
              const f = fields(body);
              if (wordCount(f.essayText) < 30) fail("续写内容太短（至少30词）");
              if (!f.originalText.trim()) fail("请填写原文（含段首句）");
              revise(s, body);
            } else if (s.status === "draft")
              fail("请先核对草稿并提交批改", 409);
            acquired = uuid();
            await bridge.startTask?.({ token: acquired });
            leases.set(id, acquired);
            s.status = "pending";
            s.result = null;
            s.error = null;
            s.updatedAt = Date.now();
            return { submission: decorate(s) };
          });
        } catch (e) {
          if (acquired) {
            leases.delete(id);
            await bridge.endTask?.({ token: acquired }).catch(() => {});
          }
          throw e;
        }
        if (response.submission.status === "pending") schedule(id);
        return response;
      }
      if (method === "DELETE")
        return transaction(() => {
          get(id);
          state.submissions = state.submissions.filter((s) => s.id !== id);
          return { ok: true };
        });
      if (method === "PATCH")
        return transaction(() => {
          if (user().role !== "teacher") fail("仅教师可用", 403);
          const s = get(id);
          const score =
            body.teacherScore == null || body.teacherScore === ""
              ? null
              : Number(body.teacherScore);
          if (
            score !== null &&
            (!Number.isFinite(score) || score < 0 || score > 25)
          )
            fail("分数需在0–25之间");
          s.teacherScore = score;
          s.teacherNote = String(body.teacherNote || "");
          return { submission: decorate(s) };
        });
    }
    if (path === "/api/backup") {
      if (method === "GET")
        return read(() => {
          user();
          return {
            format: "essay-grader-backup",
            version: 1,
            exportedAt: Date.now(),
            submissions: state.submissions
              .filter((s) => s.userId === user().id)
              .map(({ userId, clientId, runId, queuePos, ...s }) => s),
          };
        });
      if (method === "POST")
        return transaction(() => {
          const u = user(),
            records = decodeBackup(body);
          for (const record of records)
            state.submissions.push(
              newRecord({
                ...record,
                userId: u.id,
                wordCount: wordCount(record.essayText),
              }),
            );
          return { imported: records.length };
        });
    }
    if (path === "/api/my-data" && method === "DELETE")
      return transaction(() => {
        const id = user().id;
        state.submissions = state.submissions.filter((s) => s.userId !== id);
        return { ok: true };
      });
    fail("此功能尚未接入安卓版本", 501);
  };
  return {
    request,
    whenIdle: async () => {
      await ready;
      for (let i = 0; running || jobs.length; i++) {
        if (i > 1000) throw new Error("Job timeout");
        await new Promise((r) => setTimeout(r, 10));
      }
      await chain;
    },
  };
}
