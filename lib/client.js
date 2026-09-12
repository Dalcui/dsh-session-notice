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
  ROUTE_PREFIX: () => ROUTE_PREFIX,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/BarkPluginCard.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var CARD_CSS = `
.dsn-card {
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-3);
  border-radius: 12px;
  list-style: none;
  transition: border-color .16s, background .16s;
}
.dsn-card:hover { border-color: var(--dsw-alias-label-dimmed); }
.dsn-cardOpen { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-label-dimmed); }
.dsn-header {
  appearance: none; width: 100%; font: inherit; color: inherit; text-align: left;
  cursor: pointer; background: 0 0; border: 0; border-radius: 12px;
  align-items: center; gap: 12px; padding: 14px 16px; display: flex;
}
.dsn-header:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.dsn-headText { flex-direction: column; flex: 1; gap: 4px; min-width: 0; display: flex; }
.dsn-name { color: var(--dsw-alias-label-primary); font-size: 15px; font-weight: 600; line-height: 1.4; }
.dsn-description { color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 1.5; }
.dsn-chevron { color: var(--dsw-alias-label-tertiary); flex: none; transition: transform .16s; }
.dsn-chevronOpen { transform: rotate(180deg); }
.dsn-pending {
  white-space: nowrap; background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary); border-radius: 999px; flex: none;
  padding: 1px 8px; font-size: 11px; font-weight: 500; line-height: 17px;
}
.dsn-body { border-top: 1px solid var(--dsw-alias-border-l2); margin: 0 16px; padding-bottom: 8px; }
.dsn-field { flex-direction: column; gap: 6px; padding: 12px 0; display: flex; }
.dsn-fieldHead { align-items: center; gap: 8px; display: flex; }
.dsn-fieldLabel { min-width: 0; color: var(--dsw-alias-label-primary); flex: 1; font-size: 13px; font-weight: 500; line-height: 1.5; }
.dsn-badges { align-items: center; gap: 8px; display: inline-flex; }
.dsn-badge {
  white-space: nowrap; background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary); border-radius: 999px;
  padding: 1px 8px; font-size: 11px; font-weight: 500; line-height: 17px;
}
.dsn-input {
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-3);
  height: 34px; font: inherit; color: var(--dsw-alias-label-primary);
  border-radius: 8px; padding: 0 12px; font-size: 13px; line-height: 1.5;
  box-sizing: border-box; width: 100%;
}
.dsn-input:focus-visible { border-color: var(--dsw-alias-brand-primary); outline: none; }
.dsn-input:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.dsn-hint { color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 12px; line-height: 1.5; }
.dsn-footer { border-top: 1px solid var(--dsw-alias-border-l2); justify-content: flex-end; align-items: center; gap: 8px; padding: 12px 0 4px; display: flex; }
.dsn-msg { min-width: 0; flex: 1; margin: 0; font-size: 12px; line-height: 1.5; }
.dsn-msgOk { color: var(--dsw-alias-label-secondary); }
.dsn-msgFailed { color: var(--dsw-alias-label-error); }
.dsn-btn { appearance: none; font: inherit; cursor: pointer; border: 1px solid #0000; border-radius: 8px; padding: 5px 14px; font-size: 13px; line-height: 1.5; }
.dsn-btnSecondary { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); background: 0 0; }
.dsn-btnSecondary:hover:not(:disabled) { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-dimmed); }
.dsn-btnPrimary { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3); }
.dsn-btn:disabled { opacity: .4; cursor: default; }
.dsn-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsn-testResult { flex-direction: column; gap: 4px; margin: 0 0 8px; font-size: 12px; line-height: 1.5; display: flex; }
.dsn-testOk { color: var(--dsw-alias-label-secondary); }
.dsn-testFailed { color: var(--dsw-alias-label-error); }
.dsn-ready { color: var(--dsw-alias-label-primary); font-weight: 600; }
`;
var STYLE_ID = "dsh-session-notice-settings-style";
function injectCardStyle() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CARD_CSS;
  document.head.appendChild(style);
}
function ChevronIcon(open) {
  const className = open ? "dsn-chevron dsn-chevronOpen" : "dsn-chevron";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": true, className, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "path",
    {
      d: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z",
      fill: "currentColor"
    }
  ) });
}
function BarkPluginCard({ rpc }) {
  const [view, setView] = (0, import_react.useState)(null);
  const [loadError, setLoadError] = (0, import_react.useState)("");
  const [server, setServer] = (0, import_react.useState)("");
  const [keyDraft, setKeyDraft] = (0, import_react.useState)("");
  const [group, setGroup] = (0, import_react.useState)("");
  const [bodyChars, setBodyChars] = (0, import_react.useState)("200");
  const [saving, setSaving] = (0, import_react.useState)(false);
  const [saveMsg, setSaveMsg] = (0, import_react.useState)(null);
  const [testing, setTesting] = (0, import_react.useState)(false);
  const [testView, setTestView] = (0, import_react.useState)(null);
  const [open, setOpen] = (0, import_react.useState)(false);
  injectCardStyle();
  const load = async () => {
    const res = await rpc("state", {});
    if (!res.ok) {
      setLoadError(res.error?.message ?? "RPC failed");
      return;
    }
    const value = res.value;
    setView(value);
    setServer(value.server);
    setGroup(value.group);
    setBodyChars(String(value.maxBodyChars ?? 200));
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
    const charsNumber = Number(bodyChars.trim());
    if (Number.isFinite(charsNumber) && Math.floor(charsNumber) !== (view?.maxBodyChars ?? 200)) {
      ;
      patch.maxBodyChars = Math.floor(charsNumber);
    }
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
  const dirty = server.trim() !== (view?.server ?? "") || keyDraft.length > 0 || group !== (view?.group ?? "") || Number.isFinite(Number(bodyChars.trim())) && Math.floor(Number(bodyChars.trim())) !== (view?.maxBodyChars ?? 200);
  const cardClass = `dsn-card${open ? " dsn-cardOpen" : ""}`;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { className: cardClass, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        className: "dsn-header",
        "aria-expanded": open,
        "aria-label": `${open ? "\u6536\u8D77\u8BBE\u7F6E" : "\u5C55\u5F00\u8BBE\u7F6E"}: dsh-session-notice`,
        onClick: () => setOpen(!open),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsn-headText", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsn-name", children: "Bark \u4F1A\u8BDD\u901A\u77E5" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsn-description", children: "\u4F1A\u8BDD\u8F6E\u6B21\u505C\u6B62\u65F6\u7ECF Bark \u63A8\u9001\u5230\u624B\u673A\uFF1B\u5728\u4F1A\u8BDD\u5934\u90E8\u6309\u94AE\u6309\u4F1A\u8BDD\u5F00\u5173" })
          ] }),
          dirty ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsn-pending", children: "\u672A\u4FDD\u5B58" }) : null,
          ChevronIcon(open)
        ]
      }
    ),
    open ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsn-body", children: [
      loadError.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "dsn-msg dsn-msgFailed", role: "status", children: [
        "\u8BBE\u7F6E\u52A0\u8F7D\u5931\u8D25\uFF1A",
        loadError
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsn-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsn-fieldHead", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "dsn-fieldLabel", htmlFor: "dsn-server", children: "Bark \u670D\u52A1\u5668" }),
          view?.serverMasked === true ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsn-badges", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsn-badge", children: "\u542B\u51ED\u636E" }) }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            id: "dsn-server",
            className: "dsn-input",
            type: "text",
            value: server,
            placeholder: "https://api.day.app",
            disabled: saving || testing,
            onChange: (event) => setServer(event.target.value)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsn-hint", children: "\u5B98\u65B9 http://api.day.app \u6216\u81EA\u5EFA\u670D\u52A1\u5668\uFF1B\u53EF\u5E26\u8DEF\u5F84\u524D\u7F00\uFF0CBasic Auth \u7528 user:pass@host \u5F62\u5F0F" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsn-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsn-fieldHead", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "dsn-fieldLabel", htmlFor: "dsn-key", children: "\u8BBE\u5907\u5BC6\u94A5\uFF08key\uFF09" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsn-badges", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsn-badge", children: view?.keyConfigured === true ? `\u5DF2\u914D\u7F6E ${view.keyMasked}` : "\u672A\u914D\u7F6E" }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            id: "dsn-key",
            className: "dsn-input",
            type: "password",
            value: keyDraft,
            autoComplete: "off",
            placeholder: view?.keyConfigured === true ? "\u7559\u7A7A = \u4E0D\u4FEE\u6539\uFF1B\u8F93\u5165\u65B0\u503C\u66FF\u6362" : "\u7C98\u8D34 Bark key",
            disabled: saving || testing,
            onChange: (event) => setKeyDraft(event.target.value)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsn-hint", children: "\u5BC6\u94A5\u53EA\u5B58 Host \u4FA7\uFF0C\u754C\u9762\u4EC5\u663E\u793A\u672B 4 \u4F4D\uFF0C\u4E0D\u843D\u6D4F\u89C8\u5668\u3001\u4E0D\u8FDB\u65E5\u5FD7" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsn-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsn-fieldHead", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "dsn-fieldLabel", htmlFor: "dsn-group", children: "\u5206\u7EC4\uFF08group\uFF09" }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            id: "dsn-group",
            className: "dsn-input",
            type: "text",
            value: group,
            placeholder: "\u9ED8\u8BA4\u6309\u5DE5\u4F5C\u533A\u5206\u7EC4",
            disabled: saving || testing,
            onChange: (event) => setGroup(event.target.value)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsn-hint", children: "\u540C\u4E00\u5206\u7EC4\u5728\u624B\u673A\u901A\u77E5\u91CC\u6309\u9879\u76EE\u805A\u5408\u3001\u652F\u6301\u6309\u5206\u7EC4\u9759\u97F3\uFF1B\u6E05\u7A7A = \u6309\u5DE5\u4F5C\u533A\u81EA\u52A8" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsn-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsn-fieldHead", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "dsn-fieldLabel", htmlFor: "dsn-body-chars", children: "\u6B63\u6587\u6458\u8981\u5B57\u6570" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsn-badges", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsn-badge", children: "\u9ED8\u8BA4 200" }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            id: "dsn-body-chars",
            className: "dsn-input",
            type: "number",
            min: 40,
            max: 1e3,
            value: bodyChars,
            placeholder: "200",
            disabled: saving || testing,
            onChange: (event) => setBodyChars(event.target.value)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsn-hint", children: "\u901A\u77E5\u53EA\u663E\u793A\u7EA6 4 \u884C\uFF0C\u8D85\u51FA\u6309\u300C\u9996\u6BB5 + \u672B\u6BB5\u300D\u6458\u8981\u5E76\u6807\u6CE8\u603B\u5B57\u6570\uFF1B\u8303\u56F4 40\u20131000" })
      ] }),
      testView !== null && testView.error === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsn-testResult", role: "status", children: [
        testView.steps.map((step) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: step.ok ? "dsn-testOk" : "dsn-testFailed", children: [
          step.ok ? "\u2713" : "\u2717",
          " [",
          step.step,
          "] ",
          step.message
        ] }, step.step)),
        testView.ready ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsn-ready", children: "\u914D\u7F6E\u5DF2\u5C31\u7EEA \u2713" }) : null,
        testView.causalHint !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsn-testFailed", children: testView.causalHint }) : null
      ] }) : null,
      testView?.error !== void 0 && testView.error.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsn-msg dsn-msgFailed", role: "status", children: testView.error }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsn-footer", children: [
        saveMsg !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: `dsn-msg ${saveMsg.ok ? "dsn-msgOk" : "dsn-msgFailed"}`, role: "status", children: saveMsg.text }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsn-btn dsn-btnSecondary", disabled: saving || testing || !dirty, onClick: () => void load(), children: "\u653E\u5F03" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsn-btn dsn-btnPrimary", disabled: saving || testing || !dirty, onClick: () => void save(), children: saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsn-btn dsn-btnSecondary", disabled: saving || testing, onClick: () => void test(), children: testing ? "\u6D4B\u8BD5\u4E2D\u2026" : "\u6D4B\u8BD5\u63A8\u9001" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsn-hint", children: "\u300C\u6D4B\u8BD5\u63A8\u9001\u300D\u4F1A\u771F\u53D1\u4E00\u6761\u901A\u77E5\u5230\u624B\u673A\uFF08ping \u2192 push \u2192 \u5931\u8D25\u624D register\uFF09\uFF0C\u8BF7\u5728\u624B\u673A\u4E0A\u786E\u8BA4" })
    ] }) : null
  ] });
}

// src/client/ToggleButton.tsx
var import_react2 = require("react");
var import_jsx_runtime2 = require("react/jsx-runtime");
function BellIcon(enabled) {
  const common = {
    width: 13,
    height: 13,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true
  };
  if (enabled) {
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { ...common, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M13.7 21a2 2 0 0 1-3.4 0" })
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { ...common, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M18 8a6 6 0 0 0-9.3-5.1" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h13" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M13.7 21a2 2 0 0 1-3.4 0" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "m2 2 20 20" })
  ] });
}
function ToggleButton({ rpc, sessionId }) {
  const [enabled, setEnabled] = (0, import_react2.useState)(false);
  const [ready, setReady] = (0, import_react2.useState)(false);
  const [busy, setBusy] = (0, import_react2.useState)(false);
  (0, import_react2.useEffect)(() => {
    let alive = true;
    setReady(false);
    void (async () => {
      const res = await rpc("state", {});
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
        // 与设置卡片同款主题变量（跟随明暗主题）。
        border: `1px solid ${enabled ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-border-l2)"}`,
        background: enabled ? "var(--dsw-alias-bg-module-platform)" : "transparent",
        color: enabled ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-label-secondary)",
        fontSize: 12,
        fontWeight: 500,
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.6 : 1
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { display: "inline-flex", alignItems: "center" }, children: BellIcon(enabled) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: enabled ? "\u4F1A\u901A\u77E5" : "\u4E0D\u901A\u77E5" })
      ]
    }
  );
}

// src/client/index.tsx
var ROUTE_PREFIX = "/plugins/dsh-session-notice";
var inject = ["slots"];
function apply(ctx) {
  const rpc = async (endpoint, payload) => {
    try {
      const isGet = endpoint === "state";
      const response = await fetch(`${ROUTE_PREFIX}/${endpoint}`, {
        method: isGet ? "GET" : "POST",
        headers: isGet ? void 0 : { "Content-Type": "application/json" },
        body: isGet ? void 0 : JSON.stringify(payload ?? {})
      });
      const body = await response.json();
      if (body.ok === true) return { ok: true, value: body.value };
      return { ok: false, error: { message: body.message ?? `HTTP ${response.status}` } };
    } catch (error) {
      return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } };
    }
  };
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
