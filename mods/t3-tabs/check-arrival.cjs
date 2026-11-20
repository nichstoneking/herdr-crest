// Observe the work frame at the selection, before either Tabs block can render in the destination.
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const kit = require("./check-kit.js"), el = kit.elements();
const read = (file) => fs.readFileSync(`${__dirname}/${file}`, "utf8");
const mod = (file, name) => kit.strip(read(file)).replace("export default class", `globalThis.${name} = class`);
const navigation = kit.bundle(read, "navigation.js");
const panel = `const GROUP_GAP = (() => { ${kit.strip(read("button.js"))}; return GROUP_GAP; })();
${kit.strip(read("surfaces.js"))}\n${kit.strip(read("panel.js"))}`;

function fixture(from, { hidden = false, buttons = false } = {}) {
  const saved = { "t3-tabs.home": "h", "t3.panels": {
    b: { tabs: [{ id: "files", born: 1 }], active: "files", open: true, wide: true },
  } };
  let active = from, child = from === "h" ? "home-main" : "main", row = from === "h" && !hidden && !buttons ? 8 : 40;
  const caption = buttons ? 8 + 3 * 28 : 0;
  let open = from === "b", wide = open, page = open ? "files" : "panel-empty", end = open ? 0 : caption + (from === "h" ? 0 : 32);
  const spaces = () => ["a", "b", "h"].map(id => ({ id, active: id === active, machine: null, name: id === "h" ? "Home\u200b" : id,
    named: true, tabs: [{ id: `t-${id}`, active: true }] }));
  const panes = () => spaces().map(s => ({ tab: s.tabs[0].id, pane: `p-${s.id}`, ...(s.id === "h" ? { mod: "t3-home" } : { terminal: `k-${s.id}` }) }));
  const commands = [], frames = [];
  const values = () => [active, child, row, page, open, wide, end];
  function paint() {
    for (const [cmd, args] of commands.splice(0)) {
      if (cmd === "layout.select" && args.stack === "work-main") child = args.child;
      if (cmd === "layout.select" && args.stack === "panel-body") page = args.child;
      if (cmd === "layout.resize" && args.id === "tabs-row") row = args.px;
      if (cmd === "layout.resize" && args.id === "window-end") end = args.px;
      if (args?.id === "panel") open = cmd === "layout.show";
      if (args?.id === "work") wide = cmd === "layout.hide";
      if (cmd === "space.select") active = args.id;
      if (cmd === "tab.select") active = args.id.replace(/^t-/, "");
      if (cmd === "pane.focus") active = args.pane.replace(/^p-/, "");
      if (cmd === "agent.focus") active = args.terminal.replace(/^k-/, "");
    }
    frames.push(values());
  }
  const cx = { spawn() {}, notify() {}, focus_handle() {} };
  const globals = {
    View: class {}, div: el, h_flex: el, v_flex: el, theme: () => ({}), props: () => ({ part: "keys" }), settings: () => ({}),
    shared: key => saved[key], setShared: (key, val) => { saved[key] = val; }, window: () => ({ buttons }),
    spaces, panes, agents: () => [], terminals: () => [], machines: () => [], focused: () => null,
    layout: () => ({ children: [{ id: "sidebar", hidden, children: [{ id: "sidebar-lists", active: "lists" }] },
      { id: "work", hidden: wide, children: [{ id: "tabs-row", size: { px: row } }, { id: "window-end", size: { px: end } }, { id: "work-main", active: child }] },
      { id: "panel", hidden: !open, children: [{ id: "panel-body", active: page, children: ["panel-empty", "files", "review"].map(id => ({ id })) }] }] }),
    run: (cmd, args) => commands.push([cmd, args]), rememberTerminal() {}, hc() {}, home() {}, openOverlay() {}, closeOverlay() {}, notify() {},
    stop: (_, __, ___, node, _radius, opts) => { node.enter = opts?.enter; return node; },
  };
  const scope = vm.createContext(globals);
  vm.runInContext(`${navigation}\n${panel}\n${mod("main.js", "Tabs")}\n${mod("../t3-spaces/main.js", "Spaces")}\nglobalThis.jump = { focusPane, focusAgent };`, scope);
  const keys = new scope.Tabs(); keys.init(null, cx); keys.render(); paint();
  return { frames, keys, paint, saved, commands, press: cmd => keys.navigation.handle(cmd, cx),
    go: space => scope.jump.focusPane(`p-${space}`), agent: space => scope.jump.focusAgent(`k-${space}`),
    click: (id, keyboard) => {
      const w = spaces().find(s => s.id === id), row = new scope.Spaces().row({ w }, {}, panes(), false);
      if (keyboard) row.enter();
      else {
        kit.fire(row, "on_mouse_down:left", { position: {} }, cx);
        kit.fire(row, "on_mouse_up:left", {}, cx);
      }
    },
  };
}

(async () => {
  const wideFiles = ["b", "main", 40, "files", true, true, 0];
  const closed = ["a", "main", 40, "panel-empty", false, false, 32];
  for (const jump of [f => f.press("space:2"), f => f.press("space-prev"), f => f.go("b"), f => f.agent("b"),
    f => f.click("b", false), f => f.click("b", true)]) {
    const f = fixture("h");
    await jump(f); f.paint();
    assert.deepEqual(f.frames.at(-1), wideFiles, "first frame leaving Home has the destination's row, header and maximized Files");
  }
  for (const [hidden, buttons, homeHeight, end] of [[false, false, 8, 0], [true, false, 40, 0], [false, true, 40, 92]]) {
    const f = fixture("b", { hidden, buttons });
    await f.press("home"); f.paint();
    assert.deepEqual(f.frames.at(-1), ["h", "home-main", homeHeight, "panel-empty", false, false, end], "first frame into Home removes the pane header and restores its own panel");
  }
  for (const [key, want] of [["space:1", closed], ["space:2", wideFiles]]) {
    const f = fixture("a");
    await f.press("home"); await f.press(key);
    f.keys.render(); // The model has not acknowledged either select and layout() still reports A's original geometry.
    f.paint();
    assert.deepEqual(f.frames.at(-1), want, "the latest jump wins before either selection is observed");
    f.keys.render(); f.paint();
    assert.deepEqual(f.frames.at(-1), want, "the observed target keeps its destination frame");
    assert.equal(f.saved["t3.panels"].a, undefined, "the abandoned Home frame is not saved to the source");
  }
  {
    const f = fixture("b");
    await f.press("space:1"); f.paint();
    assert.deepEqual(f.frames.at(-1), closed, "an ordinary space switch does not briefly inherit an open wide panel");
  }
  console.log("ok: known space arrivals have their work frame and panel before the first destination paint");
})().catch(e => { console.error(e); process.exit(1); });
