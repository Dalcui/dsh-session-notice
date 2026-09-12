window.__ModuleLoader__.load({id:"dsh-session-notice",factory:function(require){var module={exports:{}};var exports=module.exports;Object.defineProperty(exports,Symbol.toStringTag,{value:"Module"});
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  RPC_CHANNEL: () => RPC_CHANNEL,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/BarkPluginCard.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
function BarkPluginCard({ rpc }) {
  const [view, setView] = (0, import_react.useState)(null);
  const [loadError, setLoadError] = (0, import_react.useState)("");
  const [server, setServer] = (0, import_react.useState)("");
  const [keyDraft, setKeyDraft] = (0, import_react.useState)("");
  const [group, setGroup] = (0, import_react.useState)("");
  const [saving, setSaving] = (0, import_react.useState)(false);
  const [saveMsg, setSaveMsg] = (0, import_react.useState)(null);
  const [testing, setTesting] = (0, import_react.useState)(false);
  const [testView, setTestView] = (0, import_react.useState)(null);
  const [open, setOpen] = (0, import_react.useState)(false);
  const load = async () => {
    const res = await rpc("get", {});
    if (!res.ok) {
      setLoadError(res.error?.message ?? "RPC failed");
      return;
    }
    const value = res.value;
    setView(value);
    setServer(value.server);
    setGroup(value.group);
    setKeyDraft("");
    setLoadError("");
  };
  (0, import_react.useEffect)(() => {
    void load();
  }, []);
  const saveDraft = async () => {
    const patch = {};
    if (server.trim() !== (view?.server ?? "")) patch.server = server;
    if (keyDraft.length > 0) patch.key = keyDraft;
    if (group !== (view?.group ?? "")) patch.group = group;
    if (Object.keys(patch).length === 0) return true;
    const res = await rpc("set", patch);
    if (!res.ok) {
      setSaveMsg({ ok: false, text: res.error?.message ?? "\u4FDD\u5B58\u5931\u8D25" });
      return false;
    }
    setKeyDraft("");
    await load();
    return true;
  };
  const save = async () => {
    setSaving(true);
    setSaveMsg(null);
    const landed = await saveDraft();
    if (landed) setSaveMsg({ ok: true, text: "\u5DF2\u4FDD\u5B58" });
    setSaving(false);
  };
  const test = async () => {
    setTesting(true);
    setTestView(null);
    setSaveMsg(null);
    const landed = await saveDraft();
    if (!landed) {
      setTesting(false);
      return;
    }
    const res = await rpc("test", {});
    setTesting(false);
    if (!res.ok) {
      setTestView({ steps: [], ready: false, error: res.error?.message ?? "\u6D4B\u8BD5\u5931\u8D25" });
      return;
    }
    setTestView(res.value);
  };
  if (loadError.length > 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: "8px 0", color: "var(--dsw-alias-label-error)" }, children: [
      "\u8BBE\u7F6E\u52A0\u8F7D\u5931\u8D25\uFF1A",
      loadError
    ] });
  }
  const inputStyle = {
    width: "100%",
    boxSizing: "border-box",
    height: 34,
    borderRadius: 8,
    border: "1px solid var(--dsw-alias-border-l4, #ccc)",
    background: "var(--dsw-alias-bg-layer-3, transparent)",
    color: "var(--dsw-alias-label-primary, inherit)",
    padding: "0 12px",
    fontSize: 13
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        onClick: () => setOpen((previous) => !previous),
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "10px 0",
          background: "none",
          border: "none",
          cursor: "pointer",
          font: "inherit",
          textAlign: "left",
          color: "var(--dsw-alias-label-primary, inherit)"
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }, children: [
            "Bark \u4F1A\u8BDD\u901A\u77E5",
            view !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 12, fontWeight: 400, color: "var(--dsw-alias-label-secondary, #666)", marginLeft: 8 }, children: view.keyConfigured ? `\u5BC6\u94A5\u5DF2\u914D\u7F6E\uFF08${view.keyMasked}\uFF09` : "\u5BC6\u94A5\u672A\u914D\u7F6E" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" }, children: open ? "\u6536\u8D77 \u25B4" : "\u5C55\u5F00 \u25BE" })
        ]
      }
    ),
    open && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 10, padding: "0 0 10px" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 13, fontWeight: 500, marginBottom: 4 }, children: "Bark \u670D\u52A1\u5668" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            style: inputStyle,
            value: server,
            placeholder: "https://api.day.app",
            onChange: (event) => setServer(event.target.value)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)", marginTop: 4 }, children: "\u5B98\u65B9\u6216\u81EA\u5EFA Bark Server\uFF08\u53EF\u5E26\u8DEF\u5F84\u524D\u7F00\u6216 user:pass@ \u57FA\u672C\u9274\u6743\uFF09" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: 13, fontWeight: 500, marginBottom: 4 }, children: [
          "\u5BC6\u94A5",
          view?.keyConfigured === true && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)", marginLeft: 8 }, children: [
            "\u5DF2\u914D\u7F6E\uFF08",
            view.keyMasked,
            "\uFF09"
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            style: inputStyle,
            type: "password",
            value: keyDraft,
            placeholder: view?.keyConfigured === true ? "\u7559\u7A7A = \u4E0D\u4FEE\u6539\uFF1B\u8F93\u5165\u65B0\u503C\u66FF\u6362" : "\u7C98\u8D34 Bark key",
            autoComplete: "off",
            onChange: (event) => setKeyDraft(event.target.value)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)", marginTop: 4 }, children: "\u5BC6\u94A5\u53EA\u5B58 Host \u4FA7\u3001\u754C\u9762\u4EC5\u663E\u793A\u672B 4 \u4F4D\uFF0C\u4E0D\u843D\u6D4F\u89C8\u5668\u3001\u4E0D\u8FDB\u65E5\u5FD7" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 13, fontWeight: 500, marginBottom: 4 }, children: "\u5206\u7EC4\uFF08group\uFF09" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            style: inputStyle,
            value: group,
            placeholder: "\u9ED8\u8BA4\u6309\u5DE5\u4F5C\u533A\u5206\u7EC4",
            onChange: (event) => setGroup(event.target.value)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)", marginTop: 4 }, children: "\u540C\u4E00\u5206\u7EC4\u5728\u624B\u673A\u901A\u77E5\u91CC\u6309\u9879\u76EE\u805A\u5408\u3001\u652F\u6301\u6309\u5206\u7EC4\u9759\u97F3\uFF1B\u6E05\u7A7A = \u6309\u5DE5\u4F5C\u533A\u81EA\u52A8" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, marginTop: 2 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            disabled: saving || testing,
            onClick: () => void save(),
            style: { flex: 1, height: 32, borderRadius: 8, border: "1px solid var(--dsw-alias-border-l4, #ccc)", background: "var(--dsw-alias-bg-layer-3, transparent)", color: "var(--dsw-alias-label-primary, inherit)", cursor: "pointer" },
            children: saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            disabled: saving || testing,
            onClick: () => void test(),
            style: { flex: 1, height: 32, borderRadius: 8, border: "1px solid var(--dsw-alias-border-l4, #ccc)", background: "var(--dsw-alias-bg-layer-3, transparent)", color: "var(--dsw-alias-label-primary, inherit)", cursor: "pointer" },
            children: testing ? "\u6D4B\u8BD5\u4E2D\u2026" : "\u6D4B\u8BD5\u63A8\u9001\uFF08\u8BF7\u7559\u610F\u624B\u673A\uFF09"
          }
        )
      ] }),
      saveMsg !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 12, color: saveMsg.ok ? "var(--dsw-alias-label-success, #2f9e44)" : "var(--dsw-alias-label-error, #d64545)" }, children: saveMsg.text }),
      testView?.error !== void 0 && testView.error.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-error, #d64545)" }, children: testView.error }),
      testView !== null && testView.error === void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }, children: [
        testView.steps.map((step) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { color: step.ok ? "var(--dsw-alias-label-success, #2f9e44)" : "var(--dsw-alias-label-error, #d64545)" }, children: [
          step.ok ? "\u2713" : "\u2717",
          " [",
          step.step,
          "] ",
          step.message
        ] }, step.step)),
        testView.ready && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-success, #2f9e44)", fontWeight: 600 }, children: "\u914D\u7F6E\u5DF2\u5C31\u7EEA \u2713" }),
        testView.causalHint !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-error, #d64545)" }, children: testView.causalHint })
      ] })
    ] })
  ] });
}

// src/client/ToggleButton.tsx
var import_react2 = require("react");
var import_jsx_runtime2 = require("react/jsx-runtime");
function ToggleButton({ rpc, sessionId }) {
  const [enabled, setEnabled] = (0, import_react2.useState)(false);
  const [ready, setReady] = (0, import_react2.useState)(false);
  const [busy, setBusy] = (0, import_react2.useState)(false);
  (0, import_react2.useEffect)(() => {
    let alive = true;
    setReady(false);
    void (async () => {
      const res = await rpc("get", {});
      if (!alive || !res.ok) return;
      const sessions = res.value?.enabledSessions ?? [];
      setEnabled(sessions.includes(sessionId));
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [sessionId]);
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await rpc("toggle", { sessionId });
      if (res.ok) setEnabled(Boolean(res.value?.enabled));
    } finally {
      setBusy(false);
    }
  };
  if (!ready) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "button",
    {
      type: "button",
      title: enabled ? "\u56DE\u5408\u505C\u6B62\u65F6\u4F1A Bark \u901A\u77E5\u624B\u673A\uFF1B\u70B9\u51FB\u53D6\u6D88" : "\u70B9\u51FB\u5F00\u542F\uFF1A\u672C\u4F1A\u8BDD\u56DE\u5408\u505C\u6B62\u65F6 Bark \u901A\u77E5\u624B\u673A",
      onClick: () => void toggle(),
      disabled: busy,
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 28,
        padding: "0 10px",
        borderRadius: 8,
        border: enabled ? "1px solid var(--dsw-alias-brand-primary, #4d6bfe)" : "1px solid var(--dsw-alias-border-l4, #ccc)",
        background: enabled ? "var(--dsw-alias-brand-primary-soft, rgba(77,107,254,0.12))" : "var(--dsw-alias-bg-layer-3, transparent)",
        color: enabled ? "var(--dsw-alias-brand-primary, #4d6bfe)" : "var(--dsw-alias-label-secondary, #666)",
        fontSize: 12,
        fontWeight: 500,
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.6 : 1
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: enabled ? "\u{1F514}" : "\u{1F515}" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: enabled ? "\u4F1A\u901A\u77E5" : "\u4E0D\u901A\u77E5" })
      ]
    }
  );
}

// src/client/index.tsx
var RPC_CHANNEL = "/bark-notify";
var inject = ["slots", "connection"];
function apply(ctx) {
  const rpc = (endpoint, payload) => ctx.connection.rpc.call(
    RPC_CHANNEL,
    endpoint,
    payload
  );
  ctx.slots.inject(
    "settings.plugin.item",
    () => ctx.slots.register(
      {
        name: "settings.plugin.item",
        key: "bark-notify",
        inject: () => ({ rpc })
      },
      BarkPluginCard
    )
  );
  ctx.slots.inject(
    "conversation.session.header.utilities",
    () => ctx.slots.register(
      {
        name: "conversation.session.header.utilities",
        id: "bark-notify-toggle",
        order: 20,
        inject: () => ({ rpc })
      },
      ToggleButton
    )
  );
}
return module.exports;}});
