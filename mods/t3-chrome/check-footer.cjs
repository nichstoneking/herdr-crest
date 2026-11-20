const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { elements, find, fire, strings, bundle, plain } = require("./check-kit.js");

const el = elements(), calls = [], spaces = [], panes = [], saved = {}, app = {};
const theme = { chrome: "#111111", dim: "#777777", foreground: "#ffffff", accent: "#abcdef" };
let now = 10000;
const cx = { notify() {}, stop_propagation() {}, focus_handle: () => ({ is_focused: () => false }) };
const scope = vm.createContext({
  View: class {}, div: el, h_flex: el, svg: src => el("svg", src), theme: () => theme,
  props: () => ({ footer: true }), settings: () => ({ zoom: 2 }), updates: () => ({ app }),
  spaces: () => spaces, panes: () => panes, shared: key => saved[key], keys: () => [], window: () => ({ platform: "macos" }),
  run: (name, args) => calls.push([name, args === undefined ? null : plain(args)]), Date: { now: () => now },
});
vm.runInContext(bundle(file => fs.readFileSync(__dirname + "/" + file, "utf8")), scope);
const tips = new Map();
vm.runInContext("const drawButton = button; tip = globalThis.recordTip;", Object.assign(scope, {
  recordTip: (_v, _t, id, label, button, options) => { tips.set(id, [label, plain(options ?? {})]); return button; },
}));
const view = new scope.Mod(), render = () => view.render(cx), cleanUp = () => find(render(), "clean-up");
view.init({}, cx);
spaces.push({ id: "one", machine: null, tabs: [{ id: "tab-one" }] });
panes.push({ tab: "tab-one" });

// Clean up opens at once: its dialog names what closes, and t3-tabs says when there's nothing to clean up.
const icon = cleanUp();
assert.ok(icon, "Clean up is in the footer");
assert.equal(icon.style.w, 32);
assert.equal(icon.style.h, 32);
assert.equal(icon.items[0].source, "mods/t3-chrome/icons/trash-2.svg");
assert.deepEqual(strings(icon), []);
assert.deepEqual(tips.get("clean-up"), ["Clean up", { action: "t3-tabs.cleanup" }]);
const buttons = find(render(), "footer-buttons");
assert.equal(buttons.style.gap, 4);
assert.deepEqual(buttons.items.map(button => button.key), ["settings", "t3-settings", "clean-up"]);

saved["t3.notice"] = { gen: 1, at: now, action: "Settled", count: 3, shown: true, live: true };
assert.ok(find(render(), "undo-notice-undo"));
assert.ok(cleanUp(), "still there beside Undo");
delete saved["t3.notice"];

fire(cleanUp(), "on_click", {}, cx);
assert.deepEqual(calls.map(([name]) => name), ["t3-tabs.cleanup"]);
console.log("ok: Clean up footer button and tooltip");
