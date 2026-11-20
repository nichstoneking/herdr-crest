// The Files page's logic outside Herdr: git's answers, ignored marks, the tree's rows, the search, sorting, file kinds, the
// icons' order and files, and the shell scripts it runs, for real, in a throwaway repo.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const kit = require("./check-kit.js");
const paneHeadCentre = kit.paneHeadCentre(fs.readFileSync(path.join(__dirname, "../../layouts/herdr-t3.json"), "utf8"));

const load = (file) => fs.readFileSync(path.join(__dirname, file), "utf8")
  .replace(/^import [^;]*;\r?\n/gm, "").replace(/^export (async function|function|const) /gm, "$1 ").replace(/^export \{[\s\S]*?\};?\s*$/m, "");
const context = vm.createContext({});
vm.runInContext([load("color.js"), load("file-tree.js"), load("file-listing.js"), load("model.js"),
  "globalThis.m = { join, LIST, IGNORED, PROBE, REMOTE_SEARCH, REMOTE_MAX, ancestors, parseListing, parseIgnored, markIgnored, folderEntries, treeRows, terms, narrows, filterPaths, rankPaths, kindOf, languageOf, readProblem, failedRead, ticket };"].join("\n"), context);
const m = context.m;
const { plain } = kit;

// A fake `herdr` element tree, and finding in it.
const element = kit.elements({ args: "all", adds: ["child"] }), { walk, find } = kit;
const labels = (root) => walk(root).map((n) => n.style.accessibility_label?.[0]).filter(Boolean);
const space = (id, folder, active = false, machine = null) => ({ id, folder, machine, active, tabs: [{ id: `${id}-tab`, active: true }] });

// The page, started in a fake `herdr`: the panel on `page` with Review installed too, every folder holding a.js (changed) and
// b.js. Each folder is in Git but `/n…`. `w` is the world: what ran, what's watched, the editors made, reads held back.
function makePage({ page = "files", spaces = [space("s1", "/r", true)], listing = null, appDir = null, clock = Date } = {}) {
  const w = { spaces, windowActive: true, ran: [], read: [], watchers: [], made: [], hold: null, held: [], stall: null, stalled: [], files: ["a.js", "b.js"], notified: 0,
    props: null, overlays: [], closed: [], commands: [], focusCalls: 0 };
  const shared = {}, wrote = [], store = new Map([["lines.wrap", "false"], ["nav.width", "300"]]), timers = [], everies = [], failed = [];
  const commands = [];
  let wake = null, running = null;
  const exec = async (cmd, args, o = {}) => {
    const line = [cmd, ...args].join(" "), cwd = o.cwd ?? (cmd === "sh" ? args[3] : "") ?? "";
    w.ran.push({ line, cwd, on: o.on ?? null });
    if (cmd === "open" && args[0] === "-Ra") return { code: args[1] === "Zed" ? 0 : 1, stdout: "" };
    if (w.stall?.(line)) await new Promise((r) => w.stalled.push(r));
    // As Herdr's exec when the process can't start (its run_blocking's spawn error).
    if (w.fail?.(line)) throw new Error("cannot run sh: Too many open files (os error 24)");
    const actual = w.runExec?.(cmd, args, o);
    if (actual) return actual;
    if (line.includes("rev-parse")) return cwd.startsWith("/n") ? { code: 128, stdout: "" } : { code: 0, stdout: `${cwd}\n\n` };
    if (cmd === "pwd") return { code: 0, stdout: `${cwd}\n` };
    if (line.includes(" status ")) return { code: 0, stdout: "1 .M N... 100644 100644 100644 h1 h2 a.js\0" };
    if (line.includes("ls-files")) return { code: 0, stdout: w.files.map((f) => `${f}\0`).join("") };
    if (cmd === "sh" && args[1] === m.LIST) return { code: 0, stdout: listing ? (listing.get(cwd) ?? "") : cwd.endsWith("/src") ? "d\0d\0" : "f\0a.js\0f\0b.js\0" };
    if (cmd === "sh" && args[1] === m.PROBE) return { code: 0, stdout: "12 0\n" };
    // Git's answer for the repository the folder (its cwd) is in: what `w.ignores` says it ignores there, as names.
    if (cmd === "sh" && args[1] === m.IGNORED) return { code: 0, stdout: w.ignores?.get(cwd) ?? "" };
    return { code: 0, stdout: "" };
  };
  const task = () => ({ cancelled: false, done: false, cancel() { this.cancelled = true; }, is_done() { return this.done || this.cancelled; } });
  // As Herdr's: cancelling a task stops nothing already awaited (a watch, an exec); it only says it's done.
  const cx = {
    notify() { w.notified++; }, stop_propagation() { cx.stopped = true; }, write_to_clipboard() {}, focus_handle: () => { const h = { focus() { w.focusCalls++; w.focused = h; }, is_focused: () => w.focused === h }; return h; },
    spawn(f) {
      const t = task();
      Promise.resolve().then(() => { running = t; try { return f(cx); } finally { running = null; } }).then(() => { t.done = true; }, (e) => failed.push(e));
      return t;
    },
    sleep: async () => {},
    timer: { every(ms, f) { everies.push([ms, f]); return task(); }, after(ms, f) { timers.push([ms, f]); return task(); } },
  };
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); if (failed.length) throw failed[0]; };
  const fire = async (ms) => { for (const [at, f] of timers.splice(0)) if (at <= ms) f(cx); else timers.push([at, f]); await settle(); };
  // A second of Herdr's clock: what runs on the page's repeating timers, hidden or not.
  const tick = async () => { for (const [, f] of everies) f(cx); await settle(); await fire(0); };
  const body = { id: "panel-body", active: page, children: [{ id: "files" }, { id: "review" }, { id: "panel-empty" }] };
  const layout = { id: "root", children: [{ id: "work" }, { id: "panel", children: [body] }] };
  const ctx = vm.createContext({ checking: () => false,
    View: class {}, div: element, svg: element, image: (src) => element("image", src), h_flex: element, v_flex: element,
    Input: { new: element }, Editor: { new: (state) => element("editor", state) }, TextView: { markdown: element }, Popup: { new: (id, trigger) => element().id(id).child(trigger) },
    InputState: { new: () => { let v = ""; const events = w.inputEvents = {}; return { on(name, f) { events[name] = f; }, value: () => v,
      set_value(x) { assert.ok(!w.drawing, "InputState.set_value must run outside the draw"); v = x; }, focus() { events.focus?.({}, cx); } }; } },
    EditorState: { new: (o) => { const e = { wrap: o.soft_wrap, text: o.value, language: o.language, released: false, release() { this.released = true; return true; } }; w.made.push(e); return e; } },
    spaces: () => w.spaces, agents: () => [], focused: () => null, panes: () => [], layout: () => layout,
    theme: () => ({ foreground: "#ffffff", dim: "#888888", accent: "#0000ff", border: "#444444", input: "#555555", background: "#111111" }), settings: () => ({ zoom: 1, font_family: "mono" }), window: () => ({ active: w.windowActive, platform: "macos" }), appHome: () => appDir ?? "/tmp/none",
    shared: (k) => shared[k], setShared: (k, v) => { wrote.push(k); shared[k] = v; },
    run(c) { w.commands.push(c); }, notify() {}, exec, keys: () => [],
    props: () => w.props, openOverlay: (o) => { w.overlays.push(o); return `o${w.overlays.length}`; }, closeOverlay: (id) => { w.closed.push(id); },
    readTextFile: async (p) => { w.read.push(p); return w.hold && p.startsWith(w.hold) ? new Promise((r) => w.held.push(() => r("held\n"))) : w.texts?.[p] ?? "const a = 1;\n"; },
    watchFolder: (p) => new Promise((resolve, reject) => w.watchers.push({ path: p, task: running, resolve, reject })),
    nextCommand: () => commands.length ? Promise.resolve(commands.shift()) : new Promise((r) => { wake = r; }),
    fs: { unlink: async (...args) => { if (appDir) fs.unlinkSync(...args); },
      mkdir: async (...args) => { if (appDir) fs.mkdirSync(...args); },
      writeFile: async (...args) => { if (appDir) fs.writeFileSync(...args); } },
    Buffer,
    localStorage: { getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    Date: clock, Promise, Math, Number, String, Boolean, Map, Set, Object, Array, JSON, RegExp, Error, Uint8Array,
  });
  const files = ["store.js", "focus.js", "trigger.js", "tip.js", "list.js", "menu-row.js", "terminal-context.js", "surfaces.js", "panel.js", "open-in.js", "pierre-icons-data.js", "pierre-icons.js", "file-tree.js", "file-listing.js", "nav-column.js", "submenu.js", "popup-menu.js", "panel-states.js", "model.js", "menus.js", "main.js"];
  const buttons = load("color.js") + "\nconst { drawButton, split, ghostButton, tint, DISABLED, GROUP_GAP } = (() => {\n" + load("button.js") + "\nreturn { drawButton: button, split, ghostButton, tint, DISABLED, GROUP_GAP };\n})();\n";
  vm.runInContext((buttons + files.map(load).join("\n")).replace("export default class", "globalThis.Mod = class"), ctx);
  const send = (c) => { if (wake) { const x = wake; wake = null; x(c); } else commands.push(c); };
  const view = new ctx.Mod();
  view.init({}, cx);
  const render = view.render.bind(view);
  view.render = (cx) => { w.drawing = true; try { return render(cx); } finally { w.drawing = false; } };
  // One of its menus: another copy, opened with these props.
  // One of its menus: another copy, opened with these props; they stay the app's props until `w.props = null`.
  const menu = (p) => { w.props = { overlay: "m1", ...p }; const v = new ctx.Mod(); v.init({}, cx); return v; };
  const show = (p) => { body.active = p; };
  const activate = (id) => { w.spaces = w.spaces.map((s) => ({ ...s, active: s.id === id })); };
  return { view, cx, w, settle, fire, tick, send, shared, wrote, store, show, activate, ctx, menu };
}

async function dragRows() {
  for (const on of [null, "vps"]) {
    const root = "/work root/项目's", names = ["a '中文.txt", "line\nbreak.txt", "literal\\backslash.txt"];
    const { view, cx, w, settle, ctx } = makePage({ spaces: [space("drag", root, true, on)] });
    view.render(cx); await settle();
    const st = view.current();
    st.entries = new Map([["", [...names.map(name => ({ name, dir: false })), { name: "folder", dir: true }]],
      ["folder", [{ name: "child", dir: true }]], ["folder/child", [{ name: "x.txt", dir: false }]]]);
    st.expanded = new Set(["folder", "folder/child"]); st.rows = null;
    const reads = w.read.length, tree = view.tree(st, ctx.theme());
    for (const name of names) assert.deepEqual(plain(find(tree, `row-${name}`).style.drag_paths ?? null), [[`${root}/${name}`], { on }], "native drag receives the absolute path unchanged and its source machine");
    assert.deepEqual(plain(find(tree, "row-folder/child").style.drag_paths), [[`${root}/folder`], { on }], "a compact folder chain drags its outermost path");
    assert.equal(ctx.treeRow(ctx.theme(), "mods/review", { path: "x.txt", name: "x.txt", depth: 0 }, "review-row").style.drag_paths, undefined, "Review rows gain no drag source");
    assert.equal(st.file, null, "configuring a drag source does not open a file");
    assert.equal(w.read.length, reads);
    find(tree, `row-${names[0]}`).handlers.on_click({}, cx); await settle();
    assert.equal(st.file, names[0], "ordinary file clicks still open the file");
    find(tree, "row-folder/child").handlers.on_click({}, cx);
    assert.equal(st.expanded.has("folder/child"), false, "ordinary folder clicks still collapse it");
  }
}

async function page() {
  const { view, cx, w, settle, fire, send, shared, wrote, store, ctx } = makePage();
  assert.equal(w.inputEvents.submit, undefined, "hierarchical search is not a flat picker that opens on input submit");
  let root = view.render(cx);
  await settle();
  root = view.render(cx);
  assert.ok(find(root, "row-a.js") && find(root, "row-b.js"), "the folder's files in the tree");
  assert.equal(find(root, "t3-files-toolbar"), null, "generic Files starts directly at the tree search, with no root-name toolbar");
  // Its search row is the page's first, under the panel head: its centre on the work column's pane header's, as Review's and a
  // file's 32 bars; the tree still starts 40 under the row's top, where it did and where it does under a nav column's head.
  {
    const holds = (n, id) => n && typeof n === "object" && n.items && (n.key === id || n.items.some((c) => holds(c, id)));
    const head = walk(root).filter((n) => n.style.h && holds(n, "t3-files-search-field") && n.key !== "t3-files-search-field").pop().style;
    assert.equal(paneHeadCentre.head + head.h[0] / 2, paneHeadCentre.left, "the search row's centre on the pane header's");
    assert.equal(head.h[0] + (head.mb?.[0] ?? 0), 40, "the tree where it was");
  }
  assert.ok(!w.ran.some(r => r.line.includes(" status ")), "Files reads ignored paths, not Review's change statuses");
  assert.equal(find(root, "row-a.js").style.tooltip, undefined, "tree rows have no path tooltip, including truncated names");
  find(root, "row-a.js").handlers.on_click({ modifiers: {} }, cx); await settle();
  find(view.render(cx), "row-b.js").handlers.on_click({ modifiers: { platform: true } }, cx); await settle();
  assert.equal(view.current().selected, "b.js", "one row selected: Cmd-click is a click, as there's nothing to do with many");

  // A file opened from elsewhere (a command, a tab) shows in the tree without taking the keyboard from where it is.
  w.focused = "terminal";
  send("open:a.js");
  await settle(); view.render(cx); await fire(0); await settle();
  root = view.render(cx);
  assert.ok(find(root, "t3-files-code"), "the file shows");
  // Its header is Review's bar, controls centred: the Tree switch stays put between the pages (R1). Its centre is the work
  // column's pane header's, so the two rows read as one line across the window.
  const bar = find(root, "t3-files-toolbar").style.h[0];
  assert.ok(bar === 32 && !find(root, "t3-files-toolbar").style.mb, "Review's 32 bar, nothing under it");
  assert.equal(paneHeadCentre.head + bar / 2, paneHeadCentre.left, "its row's centre on the pane header's");
  // Its first crumb's box at 12, under the panel head's first tab's box; its words a sm button's 10 in, where Review's scope
  // button has its words (check-pane.cjs), so switching pages doesn't move the first letter.
  {
    const first = find(root, "crumb-").style, crumbs = find(root, "t3-files-breadcrumbs").style, box = find(root, "t3-files-toolbar").style.px[0] + (crumbs.pl?.[0] ?? 0) + (first.ml?.[0] ?? 0);
    assert.equal(box, paneHeadCentre.tabEdge, "the first crumb's box on the panel head's first tab's");
    assert.equal(box, 12);
    assert.equal(box + (first.pl ?? first.px)[0], 12 + 10, "its words 10 in, as a sm button's");
  }
  // Its icons 14 in their 28 buttons, as T3's file toolbar (the panel head's stay 16).
  assert.equal(find(root, "t3-files-switches").style.gap[0], 4, "Preview, Wrap and Tree 4 apart (P3), each its own fill");
  for (const id of ["t3-files-render-mode", "t3-files-wrap", "t3-files-nav-toggle"]) assert.deepEqual(find(root, id).items.map((n) => n.style.size?.[0]), [14], `${id}: a 14 icon`);
  // As T3's: the tree column's left rule at 60% of the border, no rule under its head, the search with no hover fill.
  assert.ok(!find(root, "t3-files-nav").style.border_l && find(root, "t3-files-nav-rule").style.opacity[0] === 0.6, "a faint rule");
  assert.ok(!find(root, "t3-files-nav-head").style.border_b, "no rule under the column's head");
  assert.equal(find(root, "t3-files-search-field").style.hover, undefined, "the search field: no hover fill");
  // The crumbs' › lights as the bar's buttons: the text color at 4% hovered, 7% with its menu up.
  assert.equal(find(root, "browse-").hoverStyle.bg[0], "#ffffff0a");
  assert.equal(w.focused, "terminal", "an external reveal doesn't focus the tree");
  w.focused = "native-editor"; cx.stopped = false;
  find(root, "t3-files-content").handlers["on_mouse_down:left"]({}, cx);
  if (!cx.stopped) root.handlers["on_mouse_down:left"]({}, cx);
  assert.equal(w.focused, "native-editor", "a native Editor drag-start does not bubble up and lose focus to the Files root");
  assert.equal(find(root, "t3-files-review"), null, "no Open in Review button");
  assert.ok(!labels(root).includes("Open in Review"));
  // A row's menu: a popup of this mod's at the pointer, for that row.
  find(root, "row-a.js").handlers["on_mouse_down:right"]({}, cx);
  const rowMenu = w.overlays.at(-1);
  assert.equal(rowMenu.props.source.tab, "s1-tab", "for the space's tab in view, which it closes without");
  assert.deepEqual([rowMenu.mod, rowMenu.kind, rowMenu.props.files, rowMenu.props.path, rowMenu.at], ["t3-files", "popup", "row", "a.js", undefined], "at the pointer");

  // Review's old ask to show a file here is left alone.
  shared["t3-files.reveal"] = { space: "s1", file: "b.js", n: Date.now() + 60000 };
  view.render(cx);
  await fire(0);
  root = view.render(cx);
  assert.ok(find(root, "crumb-a.js") && !find(root, "crumb-b.js"), "still on a.js");

  // Wrap is this page's: the button writes nothing both pages share.
  find(root, "t3-files-wrap").handlers.on_click({}, cx);
  assert.equal(store.get("lines.wrap"), "true");
  root = view.render(cx);
  await fire(0);
  assert.equal(view.current().view.code.wrap, true, "the editor made again, wrapped");

  // The code keeps the width it was laid out at while its room moves, cut off; the new one once it holds 300 ms.
  const code = () => find(view.render(cx), "t3-files-code");
  const editorWidth = () => code().items[0].style.w?.[0];
  code().handlers.on_size_change({ width: 600, height: 400 }, cx);
  assert.equal(editorWidth(), 600, "the first width at once");
  code().handlers.on_size_change({ width: 640, height: 400 }, cx);
  assert.equal(editorWidth(), 600, "held while it moves");
  await fire(299);
  assert.equal(editorWidth(), 600);
  await fire(300);
  assert.equal(editorWidth(), 640, "the room held: its width");

  // Search and the keyboard's command still work; neither page wrote a request to the other.
  send("search:b");
  await settle();
  root = view.render(cx);
  assert.ok(find(root, "row-b.js"), "search filters the same tree, not a separate picker");
  assert.equal(find(root, "row-a.js"), null, "nonmatches are hidden");
  find(root, "row-b.js").handlers.on_click({ modifiers: {} }, cx);
  await settle();
  view.render(cx); await fire(0);
  assert.equal(view.current().query, "b", "opening a search-tree file keeps the search, unlike external tab reveal");
  // Its tab picked, the one already shown too: the search clears and the tree shows the file (T3's reveal).
  vm.runInContext('activateSurface("file:b.js")', ctx);
  view.render(cx); await fire(0);
  assert.equal(view.current().query, "", "picking a tab clears the search");
  send("open:README.md"); await settle();
  root = view.render(cx);
  assert.equal(find(root, "tip-over-crumb-"), null, "the user explicitly removed breadcrumb tooltips even where T3 has them");
  assert.equal(find(root, "tip-over-t3-files-open-more"), null, "the split arrow keeps only its accessibility label");
  assert.equal(find(root, "t3-files-open-group").style.border_color?.[0], "#555555", "Open in is T3's header split: outlined in input, as button.js draws it");
  assert.equal(find(root, "t3-files-main").style.bg?.[0], "#111111", "the content on background, apart from the tree on chrome");
  assert.ok(find(root, "t3-files-wrap"), "Preview keeps the word-wrap slot so the other controls do not move");
  assert.equal(find(root, "t3-files-wrap").handlers.on_click, undefined, "word wrap is off in Preview");
  find(root, "t3-files-render-mode").handlers.on_click({}, cx);
  assert.ok(find(view.render(cx), "t3-files-wrap").handlers.on_click, "raw Markdown has word wrap");
  find(view.render(cx), "t3-files-render-mode").handlers.on_click({}, cx);
  assert.equal(find(view.render(cx), "t3-files-wrap").handlers.on_click, undefined, "cached Editor does not enable word wrap in Preview");
  send("open:cached.md"); await settle();
  assert.ok(find(view.render(cx), "t3-files-md"));
  send("open:README.md"); await settle();
  find(view.render(cx), "t3-files-render-mode").handlers.on_click({}, cx);
  send("open:cached.md"); await settle();
  assert.ok(find(view.render(cx), "t3-files-code"), "a cached Preview-only Markdown gains its Editor when reopened in global Code mode");
  find(view.render(cx), "t3-files-render-mode").handlers.on_click({}, cx);
  send("open:README.md"); await settle();
  // A breadcrumb is the person's own move: the tree takes the keyboard once it's there.
  w.focused = "terminal";
  find(view.render(cx), "crumb-").handlers.on_click({}, cx);
  view.render(cx); // Files may draw again before applying the breadcrumb's tab.
  await fire(0); await settle();
  root = view.render(cx);
  assert.equal(find(root, "t3-files-code"), null, "a directory surface has no file preview");
  assert.ok(find(root, "crumb-README.md"), "directory navigation retains the source trail");
  assert.ok(!w.read.includes("/r"), "a directory is never read as text");
  assert.equal(w.focused, view.treeHandle, "a breadcrumb's folder takes the keyboard to the tree");
  find(root, "crumb-README.md").handlers.on_click({}, cx); await settle(); await fire(0);
  assert.ok(find(view.render(cx), "t3-files-md"), "the retained trail returns to its original file");
  // ›: the folder's menu, a popup of its own under it; on while it's up, a press that closed it doesn't open it again.
  root = view.render(cx);
  find(root, "browse-").handlers["on_mouse_down:left"]({ bounds: { x: 100, y: 50, width: 16, height: 20 } }, cx);
  find(root, "browse-").handlers.on_click({}, cx);
  const crumbMenu = w.overlays.at(-1);
  assert.deepEqual(plain([crumbMenu.props.files, crumbMenu.props.dir, crumbMenu.at]), ["folder", "", { x: 100, y: 74 }], "under the ›, its left edge with it");
  assert.equal(find(view.render(cx), "browse-").style.bg[0], "#ffffff12", "on while its menu is up");
  const made = w.overlays.length;
  find(view.render(cx), "browse-").handlers["on_mouse_down:left"]({ bounds: { x: 100, y: 50, width: 16, height: 20 } }, cx);
  shared["t3-files.menuClosed"] = Date.now();
  find(view.render(cx), "browse-").handlers.on_click({}, cx);
  assert.equal(w.overlays.length, made, "the press that closed it doesn't open it again");
  // Opened from the keys (no press), its first row lit (t3-tokens「菜单行」).
  find(view.render(cx), "browse-").handlers.on_click({}, cx);
  assert.equal(w.overlays.at(-1).props.lit, 0, "keys light the first row");
  // A breadcrumb menu's file is the person's pick: it opens and the tree takes the keyboard.
  w.focused = "terminal";
  send("pick:b.js"); await settle(); await fire(0);
  assert.ok(find(view.render(cx), "crumb-b.js"), "the picked file opens");
  assert.equal(w.focused, view.treeHandle);
  assert.deepEqual(wrote.filter((k) => /reveal/.test(k)), [], "no cross-page request");
}

async function lateReveal() {
  const listing = new Map([["/r", "d\0src\0f\0b.js\0"], ["/r/src", "d\0deep\0f\0x.js\0"], ["/r/src/deep", "f\0a.js\0"]]);
  for (const move of ["tab", "tab before redraw", "folder row", "arrow key"]) {
    const { view, cx, w, settle, fire, send, ctx } = makePage({ listing });
    view.render(cx); await settle();
    send("open:b.js"); await settle();
    const root = () => view.render(cx);
    find(root(), "t3-files-tree-s1").handlers.on_size_change({ height: 48 }, cx);
    root();

    w.stall = line => line.includes(m.LIST) && line.endsWith("/r/src");
    send("pick:src/deep/a.js"); await settle();
    assert.equal(w.stalled.length, 1, "the breadcrumb menu's pick is waiting for A's ancestor");

    if (move === "folder row") find(root(), "row-src").handlers.on_click({}, cx);
    else if (move === "arrow key") find(root(), "t3-files-tree").handlers.on_key_down({ key: "end" }, cx);
    else vm.runInContext('activateSurface("file:b.js")', ctx);
    if (move !== "tab before redraw") { root(); await fire(0); root(); }
    w.focused = "terminal";
    const focusCalls = w.focusCalls;
    w.stall = null; w.stalled.splice(0).forEach(release => release()); await settle();
    assert.equal(w.focusCalls, focusCalls, `${move}: A's late reveal did not request focus`);
    assert.equal(w.focused, "terminal", `${move}: focus stays on the terminal`);
    assert.ok(!w.ran.some(r => r.line.includes(m.LIST) && r.cwd === "/r/src/deep"), `${move}: the stale reveal did not read the next ancestor`);
    root(); await fire(0);
    const after = root();
    if (move.startsWith("tab")) {
      assert.equal(find(after, "row-b.js")?.style.bg?.[0], "#ffffff1f", `${move}: B is visible and selected`);
      assert.equal(find(after, "row-src/deep/a.js"), null, `${move}: the tree did not jump to A`);
    }
  }
}

// The menus are popups of their own (menus.js): a breadcrumb's folder read as it opens, a folder in it shown in place; a file
// picked asks the page to show it and closes the menu; a row's menu offers what its row can do, Open with beside it.
async function menus() {
  const { cx, w, settle, menu, ctx } = makePage();
  const source = { space: "s1", tab: "t1", root: "/r", on: null };
  w.spaces = [{ ...space("s1", "/r", true), tabs: [{ id: "t1", active: true }] }];
  const rowsOf = (v) => walk(v.render(cx)).map(n => n.key).filter(k => k?.startsWith("files-menu-") && k !== "files-menu-list");
  // Herdr's window (the fake's `window` is herdr's window() too).
  Object.assign(ctx.window, { mouse_position: () => ({ x: 10, y: 10 }), viewport_size: () => ({ width: 1200, height: 800 }) });
  const top = menu({ files: "folder", source, dir: "", file: "a.js" }); await settle();
  assert.deepEqual(rowsOf(top), ["files-menu-a.js", "files-menu-b.js"], "the folder's entries, read as it opens; at its crumb's folder, no Back");
  // As T3's FileBreadcrumbs: a folder changes this one menu in place, Back to where it was on top; no popup beside it.
  top.entries = [{ name: "src", dir: true }, ...top.entries];
  const keys = (v, key) => v.render(cx).handlers.on_key_down({ key }, cx);
  const made = w.overlays.length;
  keys(top, "down"); keys(top, "enter"); await settle();
  assert.equal(w.overlays.length, made, "no submenu: the same popup");
  assert.deepEqual(rowsOf(top), ["files-menu-..", "files-menu-src/d"], "src's entries, read, under Back");
  // ← goes back up, and at the crumb's own folder does nothing; Back does what ← does.
  keys(top, "left"); await settle();
  assert.deepEqual(rowsOf(top), ["files-menu-a.js", "files-menu-b.js"], "back at the crumb's folder");
  keys(top, "left"); assert.deepEqual(plain(w.closed), [], "← at the top stays open");
  const sub = menu({ files: "folder", source, dir: "src", file: "a.js" }); await settle();
  assert.ok(!rowsOf(sub).includes("files-menu-.."), "a crumb's menu goes no higher than its crumb");
  sub.entries = [{ name: "d", dir: true }];
  keys(sub, "down"); keys(sub, "enter"); await settle();
  sub.render(cx); walk(sub.render(cx)).find((n) => n.key === "files-menu-..").handlers.on_click({}, cx); await settle();
  assert.ok(!rowsOf(sub).includes("files-menu-.."), "Back returns to src");
  // A file: the page asked to show it, this menu closed. Esc closes it too.
  sub.entries = [{ name: "x.js", dir: false }];
  keys(sub, "down"); keys(sub, "enter");
  assert.deepEqual(w.commands.at(-1), "t3-files.pick:src/x.js");
  assert.deepEqual(plain(w.closed), ["m1"], "the one menu closes");
  keys(top, "escape"); assert.equal(w.closed.length, 2, "Esc closes it");
  // A row's: Open with lists the editors beside it; Insert is off with no terminal in the tab.
  const row = menu({ files: "row", source, path: "a.js", agent: null, editors: ["Zed"] });
  assert.deepEqual(rowsOf(row), ["files-menu-open", "files-menu-reveal", "files-menu-open-with", "files-menu-copy-path", "files-menu-mention"]);
  keys(row, "down"); keys(row, "down"); keys(row, "down"); keys(row, "right");
  assert.deepEqual(plain([w.overlays.at(-1).props.files, w.overlays.at(-1).props.editors]), ["editors", ["Zed"]]);
  w.props = null;
}

// Herdr colors a file on the UI thread, ~1.5 ms a KB (large-file-highlight.md), and a new editor starts at the top. Opened,
// a file up to 256 KB is colored at once: a stall, never a jump. Where the text goes back to the top anyway (rewritten, Wrap
// switched), one over 16 KB shows plain and is colored once left alone: 10 s unchanged, 300 ms; not once scrolled, until
// opened again; a smaller one is colored at once, as it costs a few ms.
// Past 256 KB, only when asked.
async function largeFiles() {
  const big = "let x = 1;\n".repeat(20000), huge = "y".repeat(1024 * 1024);
  const { view, cx, w, settle, fire, show } = makePage();
  const small = "let x = 1;\n".repeat(800);
  w.texts = { "/r/big.js": big, "/r/huge.js": huge, "/r/small.js": small };
  const open = async (path) => { view.pick(view.current(), path, cx); await settle(); view.render(cx); };
  const code = () => view.current().view.code, colored = () => w.made.filter((e) => e.language === "js" && e.text.length > 50000);
  const wheel = () => find(view.render(cx), "t3-files-code").handlers.on_scroll_wheel({}, cx);
  view.render(cx); await settle();
  await open("small.js");
  w.texts["/r/small.js"] = small + "// 1\n"; view.recheck(view.current(), cx); await settle(); view.render(cx);
  assert.deepEqual([code().language, code().text.length], ["js", small.length + 5], "8 KB rewritten: colored at once");
  find(view.render(cx), "t3-files-wrap").handlers.on_click({}, cx); view.render(cx); await fire(0);
  assert.deepEqual([code().wrap, code().language], [true, "js"], "8 KB, Wrap switched: colored at once");
  find(view.render(cx), "t3-files-wrap").handlers.on_click({}, cx); view.render(cx); await fire(0);
  await open("big.js");
  assert.deepEqual([code().language, code().text.length], ["js", big.length], "opened, 200 KB: colored at once");
  view.recheck(view.current(), cx); await settle();
  assert.equal(colored().length, 1, "read again unchanged: left as it is");
  // Rewritten while it shows: the new text at once, plain; colored once it has held 10 s, here once it shows again.
  w.texts["/r/big.js"] = big + "// 1\n"; view.recheck(view.current(), cx); await settle(); view.render(cx);
  assert.deepEqual([code().language, code().text.length], [undefined, big.length + 5], "rewritten: plain at once");
  await fire(300);
  assert.equal(code().language, undefined, "not colored while it may still be being written");
  w.texts["/r/big.js"] = big + "// 2\n"; view.recheck(view.current(), cx); await settle(); view.render(cx);
  const before = colored().length;
  show("review");
  await fire(10000);
  assert.equal(code().language, undefined, "not while hidden");
  show("files"); view.render(cx); await fire(300);
  assert.deepEqual([code().language, colored().length - before], ["js", 1], "held 10 s, shown again: colored once");
  // Scrolled while plain: left plain, without the notice, until it's opened again.
  w.texts["/r/big.js"] = big + "// 3\n"; view.recheck(view.current(), cx); await settle(); view.render(cx);
  wheel(); await fire(10000); view.render(cx); await fire(300);
  assert.equal(code().language, undefined, "scrolled while plain: not swapped under the reader");
  assert.equal(find(view.render(cx), "t3-files-highlight"), null, "no notice: it's under the limit");
  w.texts["/r/big.js"] = big + "// 4\n"; view.recheck(view.current(), cx); await settle(); view.render(cx); await fire(10000);
  assert.equal(code().language, undefined, "rewritten again: still left plain");
  await open("a.js"); await open("big.js");
  assert.equal(code().language, "js", "switched back to: colored at once");
  wheel();
  // Lines changed: the plain text at once, the colors 300 ms later.
  find(view.render(cx), "t3-files-wrap").handlers.on_click({}, cx);
  view.render(cx); await fire(0);
  assert.deepEqual([code().wrap, code().language], [true, undefined], "wrapped at once, plain");
  view.render(cx); await fire(299);
  assert.equal(code().language, undefined);
  await fire(300);
  assert.equal(code().language, "js", "then colored: a scroll while colored doesn't count");
  // Past the automatic limit: plain, with a way to color it.
  await open("huge.js"); await fire(300); await fire(10000); view.render(cx);
  assert.equal(code().language, undefined, "a file past the limit stays plain");
  const ask = find(view.render(cx), "t3-files-highlight-anyway");
  assert.ok(ask, "and says how to color it");
  ask.handlers.on_click({}, cx);
  assert.equal(code().language, "js", "colored when asked");
  assert.equal(find(view.render(cx), "t3-files-highlight"), null, "the bar goes");
}

async function collapseDuringExpansion() {
  const chain = makePage({ listing: new Map([["/r", "d\0src\0"], ["/r/src", "d\0nested\0"], ["/r/src/nested", "f\0a.js\0"]]) });
  chain.view.render(chain.cx); await chain.settle();
  chain.w.stall = line => line.includes(m.LIST) && line.endsWith("/src");
  chain.view.toggle(chain.view.current(), "src", chain.cx); await chain.settle();
  chain.view.foldAll(chain.view.current(), chain.cx);
  chain.w.stall = null; chain.w.stalled.splice(0).forEach(done => done()); await chain.settle();
  assert.equal(chain.view.current().expanded.size, 0, "late compact-chain reads must not reopen after Collapse all");
  // A home-sized fixture: 24 roots × 6 projects × 30 files, with a later directory read still in flight.
  const listing = new Map(), names = Array.from({ length: 24 }, (_, i) => `folder-${i}`);
  listing.set("/r", names.map(n => `d\0${n}\0`).join(""));
  for (const name of names) {
    listing.set(`/r/${name}`, Array.from({ length: 6 }, (_, i) => `d\0project-${i}\0`).join(""));
    for (let j = 0; j < 6; j++) listing.set(`/r/${name}/project-${j}`, Array.from({ length: 30 }, (_, i) => `f\0file-${i}.ts\0`).join(""));
  }
  const { view, cx, w, settle } = makePage({ listing });
  view.render(cx); await settle(); view.render(cx);
  w.stall = line => line.includes(m.LIST) && line.endsWith("/folder-1");
  view.foldAll(view.current(), cx); await settle();
  assert.ok(view.current().expanded.size > 0, "expansion has made visible progress");
  view.foldAll(view.current(), cx);
  assert.equal(view.current().expanded.size, 0, "collapse is immediate");
  w.stall = null; w.stalled.splice(0).forEach(done => done()); await settle();
  assert.equal(view.current().expanded.size, 0, "late expansion reads must not reopen the tree after Collapse all");
  view.foldAll(view.current(), cx); await settle();
  const rows = view.rows(view.current());
  assert.ok(rows.length > 4000, "the performance guard uses thousands of visible tree rows");
  view.render(cx);
  let visited = 0;
  for (const row of rows) for (const key of ["dir", "path"]) {
    const value = row[key];
    Object.defineProperty(row, key, { get() { visited++; return value; }, configurable: true });
  }
  view.render(cx);
  assert.ok(visited < 1000, `a warm render must only inspect visible rows, not scan all ${rows.length}: visited ${visited}`);
}

// Expand all on a big folder, then the page's refresh, which lists every open folder again. Herdr runs each exec as a process
// with two pipes, under a GUI app's 256 open files: dozens at once failed to start (Too many open files) and every folder said
// it couldn't be listed. Reads go a few at a time. One that fails says so on its folder's row; the tree stays.
async function manyFolders() {
  const listing = new Map(), names = Array.from({ length: 60 }, (_, i) => `f${i}`);
  listing.set("/r", names.map((n) => `d\0${n}\0`).join(""));
  for (const n of names) listing.set(`/r/${n}`, "f\0a.js\0");
  const { view, cx, w, settle } = makePage({ listing });
  view.render(cx); await settle();
  view.foldAll(view.current(), cx); await settle();
  assert.equal(view.current().expanded.size, 60, "all open");
  w.stall = (line) => line.includes(m.LIST);
  view.recheck(view.current(), cx); await settle();
  let most = w.stalled.length;
  while (w.stalled.length) { w.stalled.splice(0).forEach((go) => go()); await settle(); most = Math.max(most, w.stalled.length); }
  w.stall = null;
  assert.ok(most > 0 && most <= 8, `a refresh lists a few folders at a time, not every open one at once: ${most}`);
  // A folder that can't be listed: its row says so and retries; the rest of the tree is drawn.
  w.fail = (line) => line.includes(m.LIST) && line.endsWith("/f3");
  view.recheck(view.current(), cx); await settle();
  let root = view.render(cx);
  const row = find(root, "row-f3"), retry = find(root, "t3-files-retry-f3");
  assert.ok(row && retry && walk(row).includes(retry), "the error on its folder's own row");
  assert.ok(find(root, "row-f2") && find(root, "row-f40"), "the other folders still drawn");
  assert.equal(walk(root).filter((n) => String(n.key).startsWith("t3-files-retry-")).length, 1, "no list of errors over the tree");
  w.fail = null;
  retry.handlers.on_click({}, cx); await settle();
  root = view.render(cx);
  assert.equal(find(root, "t3-files-retry-f3"), null, "retried: listed");
  assert.ok(find(root, "row-f3/a.js"), "and its file shows");
}

async function slowRefresh() {
  let now = 100000;
  const { view, cx, w, settle, tick } = makePage({ clock: { now: () => now } });
  w.stall = (line) => line.includes(m.LIST);
  view.render(cx); await tick();
  const rootReads = () => w.ran.filter(r => r.line.includes(m.LIST)).length;
  assert.equal(rootReads(), 1, "started the root listing");
  for (let i = 0; i < 3; i++) { now += 5000; await tick(); }
  find(view.render(cx), "t3-files-refresh").handlers.on_click({}, cx); await settle();
  assert.equal(rootReads(), 1, "three poll intervals and a manual refresh join the slow root listing");
  w.stall = null;
  w.stalled.splice(0).forEach(end => end()); await settle();
  assert.ok(find(view.render(cx), "row-a.js"), "the single read publishes the tree");
  find(view.render(cx), "t3-files-refresh").handlers.on_click({}, cx); await settle();
  assert.equal(rootReads(), 2, "a later refresh can start once the first one finishes");

  view.open(view.current(), "a.js", cx); await settle();
  w.hold = "/r/a.js";
  now += 5000; await tick();
  assert.equal(w.held.length, 1, "the next batch finished the tree and is refreshing the open text file");
  for (let i = 0; i < 3; i++) { now += 5000; await tick(); }
  assert.equal(rootReads(), 3, "polling still joins the batch while only its file read is pending");
  assert.equal(w.held.length, 1);
  w.hold = null;
  w.held.splice(0).forEach(end => end()); await settle();
  assert.equal(view.current().view.text, "held\n");
}

async function hideQueuedRefresh() {
  const folders = Array.from({ length: 12 }, (_, i) => `folder-${i}`);
  const listing = new Map([["/r", folders.map(name => `d\0${name}\0`).join("")], ...folders.map(name => [`/r/${name}`, "f\0old.js\0"])]);
  const { view, cx, w, settle, show, tick } = makePage({ listing });
  view.render(cx); await tick();
  view.foldAll(view.current(), cx); await settle();
  w.stall = line => line.includes(m.LIST) || line.includes(m.IGNORED);
  find(view.render(cx), "t3-files-refresh").handlers.on_click({}, cx); await settle();
  assert.equal(w.stalled.length, 8, "all eight slots are occupied, more paths wait");
  const started = w.ran.length, notified = w.notified;
  const old = w.stalled.splice(0);
  show("review"); // Before the next sync, queued work must see the new layout itself.
  old.splice(0, 1).forEach(end => end()); await settle();
  assert.equal(w.ran.length, started, "freeing a slot while hidden must start zero execs");
  assert.equal(w.notified, notified, "a late hidden answer doesn't redraw Files");
  listing.set("/r", "f\0new.js\0");
  w.stall = null;
  show("files"); await tick();
  assert.equal(w.ran.slice(started).filter(r => r.cwd === "/r" && r.line.includes(m.LIST)).length, 1, "reopening starts one fresh root listing while old commands are still held");
  old.forEach(end => end()); await settle();
  assert.ok(find(view.render(cx), "row-new.js"), "reopened Files shows the fresh tree");
  assert.equal(w.ran.slice(started).filter(r => r.line.includes(m.LIST)).length, folders.length + 1, "only the reopened batch starts folder listings");
}

async function imagePreview(machine) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "t3-files-image-"));
  try {
    const source = "a 'b image.svg", appDir = path.join(tmp, "preview home"), sourcePath = path.join(tmp, source);
    const drawing = fill => `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="${fill}"/></svg>\n`;
    const { view, cx, w, tick, send, settle } = makePage({ appDir, clock: { now: () => 100000 },
      spaces: [space("s1", tmp, true, machine)], listing: new Map([[tmp, `f\0${source}\0`]]) });
    const attempts = [];
    w.runExec = (cmd, args, { on }) => {
      if (cmd !== "cp" && !(on === machine && machine && (cmd === "base64" || cmd === "sh" && args.at(-1) === sourcePath))) return;
      const probe = cmd === "sh" && args[1] === m.PROBE;
      if (!probe) attempts.push({ cmd, args, on });
      try { return { code: 0, stdout: execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
      catch (e) { return { code: e.status ?? 1, stdout: "", stderr: String(e.stderr) }; }
    };
    const shown = () => walk(find(view.render(cx), "t3-files-content")).find(n => n.kind === "image")?.source;
    const bytes = image => fs.readFileSync(path.join(appDir, image), "utf8");
    fs.writeFileSync(sourcePath, drawing("red"));
    view.render(cx); await tick();
    send(`open:${source}`); await settle();
    const first = shown();
    assert.ok(first, `the ${machine ? "remote" : "local"} preview draws an image for a path with spaces and quotes`);
    assert.equal(bytes(first), drawing("red"));
    assert.equal(attempts.length, 1);
    if (machine) {
      assert.equal(attempts[0].on, machine);
      assert.equal(attempts[0].cmd, "sh", "the remote image command feeds base64 via shell stdin redirection");
      assert.equal(attempts[0].args.at(-1), sourcePath, "the path travels as a separate argument");
    }
    fs.writeFileSync(sourcePath, drawing("blue"));
    view.current().refreshed -= 10000; await tick();
    assert.equal(attempts.length, 1, "polling doesn't copy an image again");
    assert.equal(shown(), first);
    find(view.render(cx), `row-${source}`).handlers.on_click({}, cx); await settle();
    const second = shown();
    assert.equal(attempts.length, 2, "explicitly selecting the same path reads it again");
    assert.notEqual(second, first, "the host sees a new image path even in the same millisecond");
    assert.equal(bytes(second), drawing("blue"), "the rendered path contains the replacement bytes");
    assert.equal(fs.existsSync(path.join(appDir, first)), false, "the superseded copy is released");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// Expand all's reach, as T3's: each folder asks the repository it's in (a clone inside the space's folder too) which of its
// entries are ignored, and those stay closed; folders in no repository open as any. Here the space's folder isn't one.
async function expandReach() {
  const listing = new Map([["/n", "d\0repo\0d\0notes\0"], ["/n/repo", "d\0node_modules\0d\0src\0"], ["/n/repo/src", "f\0a.ts\0"],
    ["/n/repo/node_modules", "d\0pkg\0"], ["/n/notes", "f\0n.md\0"]]);
  const { view, cx, w, settle } = makePage({ listing, spaces: [space("s1", "/n", true)] });
  w.ignores = new Map([["/n/repo", "node_modules/\0"]]);
  view.render(cx); await settle();
  assert.equal(view.current().git, null, "the space's folder isn't a repository");
  view.foldAll(view.current(), cx); await settle();
  const open = [...view.current().expanded].sort();
  assert.deepEqual(open, ["notes", "repo", "repo/src"], "the clone's ignored node_modules stays closed; folders in no repository open");
  assert.ok(view.rows(view.current()).find((r) => r.path === "repo/node_modules")?.ignored, "and it's dimmed as ignored");
}

// It works only for what shows: the Files page, open, in the window in front, for the active space; nothing is watched, so
// nothing runs behind it. The last 3 spaces shown keep all they read; older ones keep their file and open folders, and read
// again when back. A space closed lets go of all of it.
async function resources() {
  const { view, cx, w, tick, settle, show, activate, send } = makePage({ page: "review", spaces: [space("s1", "/r1", true)] });
  const ran = () => w.ran.splice(0).map((r) => r.line);
  const st = (id) => view.states.get(id);
  const full = () => [...view.states.values()].filter((s) => s.entries.size).map((s) => s.id);
  await settle(); ran();

  // Hidden: drawn or not, a while on, nothing read.
  view.render(cx); await tick(); await tick();
  assert.deepEqual(ran(), [], "hidden: no I/O");
  // Shown: read at once.
  show("files"); await tick();
  let lines = ran();
  assert.ok(lines.some((l) => l.includes("rev-parse")) && lines.some((l) => l.includes(m.LIST)), `read: ${lines}`);
  assert.ok(view.render(cx) && st("s1").entries.has(""));
  // While it shows, asked again every 5 s here; a refresh that took long asks less often (10 times as long), a minute at most.
  await tick();
  assert.deepEqual(ran(), [], "not again within 5 s");
  st("s1").refreshed -= 5000; await tick();
  assert.ok(ran().some((l) => l.includes(m.LIST)), "again after 5 s");
  st("s1").refreshed -= 5000; st("s1").took = 1000; await tick();
  assert.deepEqual(ran(), [], "a 1 s refresh: not again for 10 s");
  st("s1").refreshed -= 5000; await tick();
  assert.ok(ran().some((l) => l.includes(m.LIST)), "again after 10 s");
  st("s1").refreshed -= 59000; st("s1").took = 60000; await tick();
  assert.deepEqual(ran(), []);
  st("s1").refreshed -= 1000; await tick();
  assert.ok(ran().some((l) => l.includes(m.LIST)), "a minute at most");
  st("s1").took = 0;

  // A search showing is found again with each refresh: a file gone leaves it, a new one joins.
  send("search:js"); await settle();
  const paths = () => plain(st("s1").found.results.map((r) => r.path).sort());
  assert.deepEqual(paths(), ["a.js", "b.js"]);
  w.files = ["0.js", "b.js", "c.js"]; st("s1").refreshed -= 5000; await tick();
  assert.deepEqual(paths(), ["0.js", "b.js", "c.js"], "refreshed: a.js gone, 0.js and c.js in");
  send("search:"); await settle(); w.files = ["a.js", "b.js"];

  // An image shown is copied once: a refresh leaves it be (picking it again reads it again).
  send("open:p.png"); await settle();
  assert.ok(ran().includes("cp /r1/p.png " + st("s1").view.image.replace("cache/", "/tmp/none/cache/")), "the image copied");
  st("s1").refreshed -= 5000; await tick();
  assert.ok(!ran().some((l) => l.startsWith("cp ")), "a refresh copies it no more");

  // Hidden while a folder opens (`src` holds just `d`, which would open with it) or a path is revealed, before the timer
  // has seen it: what comes back is dropped, nothing more is asked, nothing drawn.
  const hiddenMid = async (start, what) => {
    w.stall = (l) => l.includes(m.LIST) && l.endsWith("/r1/src"); start(); await settle();
    assert.equal(w.stalled.length, 1, `${what}: listing src`);
    ran(); show("review"); const notified = w.notified;
    w.stall = null; w.stalled.splice(0).forEach((r) => r()); await settle();
    assert.deepEqual(ran(), [], `${what}: nothing asked after`);
    assert.equal(w.notified, notified, `${what}: nothing drawn`);
    assert.ok(!st("s1").entries.has("src"), `${what}: the answer dropped`);
    show("files"); await tick(); ran();
  };
  await hiddenMid(() => view.toggle(st("s1"), "src", cx), "a folder opening");
  st("s1").expanded.clear(); st("s1").entries.delete("src");
  await hiddenMid(() => view.reveal(st("s1"), "src/d/x.js", cx), "a path revealed");
  st("s1").expanded.clear(); st("s1").entries.delete("src");

  // Hidden mid-read: what comes back is dropped, and nothing more is asked, the open file not read again.
  send("open:a.js"); await settle();
  st("s1").refreshed -= 5000; w.stall = (l) => l.includes(m.LIST); await tick();
  show("review"); await tick();
  const version = st("s1").version, refreshed = st("s1").refreshed, notified = w.notified;
  ran(); w.read.length = 0; w.stall = null; w.stalled.splice(0).forEach((r) => r()); await settle();
  assert.deepEqual([st("s1").refreshed, w.notified], [refreshed, notified], "hidden: a late refresh notes and draws nothing");
  await tick(); st("s1").refreshed -= 60000; await tick();
  assert.deepEqual(ran(), [], "hidden: a late answer asks nothing more, and no poll");
  assert.deepEqual(w.read, [], "hidden: the file not read again");
  assert.equal(st("s1").version, version, "hidden: a late answer is dropped");
  // The window behind: the same.
  show("files"); await tick(); ran();
  w.windowActive = false; st("s1").refreshed -= 60000; await tick();
  assert.deepEqual(ran(), [], "window behind: no I/O");
  w.windowActive = true; await tick();
  assert.ok(ran().some((l) => l.includes(m.LIST)), "in front again: read at once");

  // Outside Git and on another machine: listed, asked again while shown (another machine every 10 s).
  w.spaces = [...w.spaces, space("n", "/n"), space("v", "/x", false, "vps")];
  // Hidden while it asks Git where it is: nothing asked after.
  w.stall = (l) => l.includes("rev-parse"); activate("n"); await tick(); show("review");
  w.stall = null; w.stalled.splice(0).forEach((r) => r()); await settle();
  assert.deepEqual(ran(), ["git rev-parse --show-toplevel --show-prefix"], "hidden mid-load: nothing more");
  assert.equal(st("n").git, undefined, "hidden mid-load: Git's answer dropped, so it loads again when back");
  show("files"); await tick();
  assert.ok(ran().some((l) => l.includes(m.LIST)), "outside Git: listed");
  activate("v"); await tick();
  assert.ok(w.ran.filter((r) => r.line.includes(m.LIST)).every((r) => r.on === "vps") && w.ran.some((r) => r.on === "vps"), "another machine's, there");
  ran();
  assert.ok(view.render(cx) && st("v").entries.has(""), "another machine's tree");
  st("v").refreshed -= 5000; await tick();
  assert.deepEqual(ran(), [], "another machine: not within 10 s");
  st("v").refreshed -= 5000; await tick();
  assert.ok(ran().some((l) => l.includes(m.LIST)), "another machine: again after 10 s");
  // Hidden while another machine's file is checked: it isn't read after.
  w.stall = (l) => l.includes(m.PROBE); view.open(st("v"), "a.js", cx); await settle();
  assert.equal(w.stalled.length, 1, "probing");
  w.read.length = 0; ran(); w.windowActive = false;
  w.stall = null; w.stalled.splice(0).forEach((r) => r()); await settle();
  assert.deepEqual([ran(), w.read], [[], []], "hidden mid-probe: not read");
  w.windowActive = true; await tick();
  assert.ok(w.read.includes("/x/a.js"), "back: read");
  ran();
  assert.equal(w.watchers.length, 0, "nothing ever watched");

  // Four spaces, a file open in each: the oldest lets go of what it read, its editor released, and keeps its file and folders.
  w.spaces = ["s1", "s2", "s3", "s4"].map((id, i) => space(id, `/r${i + 1}`, id === "s1"));
  await tick();
  assert.ok(!view.states.has("n") && !view.states.has("v"), "closed spaces dropped");
  st("s1").expanded.add("src");
  for (const id of ["s1", "s2", "s3", "s4"]) {
    activate(id); await tick(); send("open:a.js"); await settle();
    if (id === "s1") { send("search:b"); await settle(); }
    view.render(cx);
  }
  const old = st("s1");
  assert.equal(st("s1").file, "a.js");
  assert.deepEqual([st("s1").query, st("s1").found], ["b", null], "its search's words kept, not its results");
  assert.deepEqual(full(), ["s2", "s3", "s4"], "three spaces keep all they read");
  assert.equal(old.view, null, "s1's view let go");
  assert.ok(w.made.filter((e) => e.text).length >= 4 && w.made.every((e) => e === st("s2").view?.code || e === st("s3").view?.code || e === st("s4").view?.code || e.released), "every other editor released");
  // Back: read again, its file too.
  w.read.length = 0; ran();
  activate("s1"); await tick();
  assert.ok(ran().some((l) => l.includes(m.LIST)) && w.read.includes("/r1/a.js"), "back: read again");
  assert.ok(st("s1").view?.code && !st("s1").view.code.released, "its file in an editor again");
  assert.ok(st("s1").expanded.has("src"), "its folders as they were");
  assert.deepEqual(plain(st("s1").found.results.map((r) => r.path)), ["b.js"], "its search found again");
  assert.deepEqual(full(), ["s3", "s4", "s1"]);

  // A read still under way when its space lets go comes back to nothing: no editor made, nothing kept.
  w.hold = "/r2"; activate("s2"); await tick();
  assert.equal(w.held.length, 1, "s2's file being read");
  for (const id of ["s3", "s4", "s1"]) { activate(id); await tick(); }
  assert.deepEqual(full(), ["s3", "s4", "s1"], "s2 let go");
  const made = w.made.length;
  w.held.splice(0).forEach((r) => r()); await settle();
  assert.equal(w.made.length, made, "a stale read makes no editor");
  assert.equal(st("s2").view, null, "and leaves nothing behind");
  w.hold = null;

  // A space closed: all of it let go.
  const gone = st("s3").view.code;
  w.spaces = w.spaces.filter((s) => s.id !== "s3"); await tick();
  assert.ok(!view.states.has("s3") && gone.released, "a closed space's editor released");
}

// The words in the field and the tree under them always agree: words it can't search yet (the window behind) show as being
// searched, never as another search's results or the whole tree, and are searched once it's in front.
async function searchMatchesWords() {
  const { view, cx, w, settle, tick, send } = makePage();
  view.render(cx); await settle(); await tick();
  send("search:a"); await settle();
  let root = view.render(cx);
  assert.ok(find(root, "row-a.js") && !find(root, "row-b.js"), "a: a.js only");
  w.windowActive = false;
  send("search:b"); await settle();
  root = view.render(cx);
  assert.equal(find(root, "row-a.js"), null, "b, not searched yet: a's result isn't shown under it");
  assert.ok(find(root, "t3-files-tree-loading"), "b, not searched yet: shown as being searched");
  w.windowActive = true; await tick();
  root = view.render(cx);
  assert.ok(find(root, "row-b.js") && !find(root, "row-a.js"), "in front: b's result");
  send("search:"); await settle();
  w.windowActive = false;
  send("search:b"); await settle();
  root = view.render(cx);
  assert.equal(find(root, "row-a.js"), null, "from no search: not the whole tree under the words");
}

async function closeKeys() {
  const { view, cx, w, send, settle, shared, ctx } = makePage();
  const keys = require("../../keys.json"), bindings = keys["mod:t3-files"];
  for (const key of ["cmd-w", "ctrl-alt-shift-x", "cmd-shift-w", "ctrl-alt-x"]) {
    assert.equal(keys["mod:review"][key], bindings[key]?.replace(/^t3-files\./, "review."), `${key} routes to the same close action in Files and Review`);
  }
  shared["t3.panels"] = { s1: { open: true, tabs: [{ id: "files", born: 1 }], active: "files" } };
  view.render(cx); await settle();
  const press = async (key) => {
    const action = bindings[key];
    assert.ok(action?.startsWith("t3-files."), `${key} is handled by Files when it has the keyboard`);
    send(action.slice("t3-files.".length)); await settle();
  };
  for (const key of ["cmd-shift-w", "ctrl-alt-x", "cmd-w", "ctrl-alt-shift-x"]) {
    const tree = view.tree(view.current(), ctx.theme());
    find(tree, "row-a.js").handlers["on_mouse_down:right"]({}, cx);
    const id = `o${w.overlays.length}`;
    await press(key);
    assert.equal(w.closed.at(-1), id, `${key} dismisses the open tree menu`);
    assert.equal(shared["t3.panels"].s1.active, "files", `${key} keeps the tab when a menu is open`);
    ctx.menuClosed(id);
  }
  for (const key of ["cmd-shift-w", "ctrl-alt-x"]) {
    await press(key);
    assert.equal(shared["t3.panels"].s1.active, "files", `${key} leaves the tab alone without a menu`);
  }
  await press("cmd-w");
  assert.equal(shared["t3.panels"].s1.active, null, "the tab close key still closes the surface with no menu");
}

async function surfaceCache() {
  const { view, cx, w, settle, fire, send, tick } = makePage();
  view.render(cx); await settle(); await fire(0);
  const st = view.current();
  const editors = [];
  for (const file of ["a.js", "b.js", "c.js", "d.js"]) { view.open(st, file, cx); await settle(); editors.push(st.view.code); }
  assert.equal(st.previews.size, 3); assert.equal(editors[0].released, true, "fourth file evicts oldest Editor");
  view.open(st, "b.js", cx); await settle(); assert.equal(st.view.code, editors[1], "recent file retains its native reading state");
  w.windowActive = false; await tick();
  w.windowActive = true; await tick();
  assert.equal(st.view.code, editors[1], "hiding a surviving tab retains its native reading state");
  send("close"); await settle(); await tick();
  assert.equal(editors[1].released, true, "closed file releases its Editor");
  view.open(st, "b.js", cx); await settle(); assert.notEqual(st.view.code, editors[1], "re-add starts with a new Editor");
}

async function firstPreviewFrame() {
  const { view, cx, w, ctx, fire, send, settle } = makePage();
  const draw = () => view.render(cx);
  const code = (frame) => find(frame, "t3-files-code")?.items[0].source?.text;
  w.texts = { "/r/a.js": "// ALPHA", "/r/b.js": "// BRAVO" };
  draw(); await settle();
  for (const file of ["a.js", "b.js"]) { send(`open:${file}`); await settle(); draw(); await fire(0); }
  send("search:b"); await settle();
  const readCount = w.read.length, editorCount = w.made.length;
  w.focused = "terminal";
  ctx.activateSurface("file:a.js");
  let frame = draw(); // No timers, including no 0ms timer, have run since the tab switch.
  assert.deepEqual([ctx.panelState().active, Boolean(find(frame, "crumb-a.js")), code(frame), find(frame, "row-a.js")?.style.bg?.[0]],
    ["file:a.js", true, "// ALPHA", "#ffffff1f"], "the active tab, breadcrumb, code and tree selection agree in the first frame");
  assert.ok(kit.strings(find(frame, "t3-files-search-field")).includes("Search files"), "the first frame does not show the old query beside the restored tree");

  ctx.openFile("unread.js");
  frame = draw();
  assert.ok(find(frame, "crumb-unread.js") && find(frame, "t3-files-loading"), "an uncached tab shows its own loading state in the first frame");
  assert.equal(code(frame), undefined, "an uncached tab never shows the old Editor");
  ctx.activateSurface("file:b.js");
  await fire(0);
  assert.equal(code(draw()), "// BRAVO", "only the latest tab still owns the preview after the timer");
  assert.equal(w.read.length, readCount, "the superseded tab never starts a read and cached code is not re-read on a switch");
  assert.equal(w.made.length, editorCount, "tab switches reuse cached Editors");
  assert.equal(w.focused, "terminal", "external tab switches do not take focus");
  assert.equal(view.search.value(), "", "the native input follows the cleared query after the draw");

  ctx.activateSurface("file:unread.js");
  draw(); await fire(0);
  assert.equal(code(draw()), "const a = 1;\n", "an uncached tab that stays selected finishes loading");

  send("search:a"); await settle();
  ctx.activateSurface("file:b.js"); draw();
  send("search:b"); await settle(); await fire(0);
  assert.equal(view.search.value(), "b", "a deferred clear must not erase a newer query");
  assert.ok(!find(draw(), "row-a.js"), "the newer query still owns the tree");
}

async function treeLoadingDelay() {
  const findLoading = (page) => find(page.view.render(page.cx), "t3-files-tree-loading");
  const fast = makePage();
  fast.ctx.showPage("files");
  assert.equal(findLoading(fast), null, "a cold tree does not flash Loading on its first frame");
  await fast.settle();
  await fast.fire(150);
  assert.equal(findLoading(fast), null, "a fast read does not leave a stale loading message");
  assert.ok(find(fast.view.render(fast.cx), "row-a.js"), "a fast read goes directly to rows");

  for (const result of ["rows", "failure", "hidden"]) {
    const slow = makePage(), { view, cx, w, ctx, settle, fire, show } = slow;
    ctx.showPage("files");
    w.stall = (line) => line.includes(m.LIST);
    view.render(cx); await settle();
    assert.equal(w.stalled.length, 1, "the root read is pending");
    await fire(149);
    assert.equal(findLoading(slow), null, "no placeholder before 150ms even with a read still pending");
    if (result === "hidden") {
      show("review");
      const notified = w.notified;
      await fire(150);
      assert.equal(w.notified, notified, "a hidden tree's stale timer cannot request a redraw");
      w.stall = null; w.stalled.pop()(); await settle();
      show("files");
      assert.equal(findLoading(slow), null, "returning starts a fresh wait without a placeholder");
      await settle();
      assert.ok(find(view.render(cx), "row-a.js"), "a fresh read can finish after returning");
      continue;
    }
    await fire(150);
    assert.ok(findLoading(slow), "a slow read shows Loading at 150ms while still pending");
    if (result === "failure") w.fail = w.stall;
    w.stall = null; w.stalled.pop()(); await settle();
    assert.equal(findLoading(slow), null, "the read result replaces Loading immediately");
    const frame = view.render(cx);
    if (result === "rows") assert.ok(find(frame, "row-a.js"), "the tree shows the rows after a slow success");
    else {
      const error = find(frame, "t3-files-retry-");
      assert.ok(error, "the tree shows its root error after a slow failure");
      w.fail = null; error.handlers.on_click({}, cx); await settle();
      assert.ok(find(view.render(cx), "row-a.js"), "retry still restores the tree");
    }
  }
}

async function latePreview() {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3-files-late-preview-"));
  try {
    const { view, cx, w, ctx, send, settle, tick } = makePage({ appDir });
    view.render(cx); await tick();
    send("open:b.js"); await settle(); // keep the Files page open when the other tab closes
    const replace = (file) => {
      ctx.closeSurface(`file:${file}`); ctx.openFile(file);
      // The panel updated its tabs; Files hasn't rendered or run its timer yet.
    };

    w.hold = "/r/a.js";
    send("open:a.js"); await settle();
    assert.equal(w.held.length, 1, "the original file is still being read");
    replace("a.js");
    const made = w.made.length;
    w.hold = null; w.held.pop()(); await settle();
    const staleEditors = w.made.length - made;
    w.texts = { "/r/a.js": "const newVersion = 1;\n" };
    await tick();
    assert.equal(w.made.at(-1)?.text, w.texts["/r/a.js"], "the new tab reads the new text");

    const cache = path.join(appDir, "cache/t3-files");
    let bytes = "old image";
    w.runExec = (cmd, args) => {
      if (cmd !== "cp") return;
      fs.writeFileSync(args[1], bytes);
      return { code: 0, stdout: "" };
    };
    w.stall = (line) => line.startsWith("cp /r/p.png ");
    send("open:p.png"); await settle();
    assert.equal(w.stalled.length, 1, "the original image is still being copied");
    replace("p.png");
    w.stall = null; w.stalled.pop()(); await settle();
    const staleImages = fs.readdirSync(cache).length;
    bytes = "new image";
    await tick();
    const image = walk(find(view.render(cx), "t3-files-content")).find(n => n.kind === "image");
    assert.ok(image, "the new tab draws its image");
    assert.equal(fs.readFileSync(path.join(appDir, image.source), "utf8"), bytes);
    assert.deepEqual({ staleEditors, staleImages }, { staleEditors: 0, staleImages: 0 }, "closing a tab invalidates its pending text and image before Files syncs");
  } finally { fs.rmSync(appDir, { recursive: true, force: true }); }
}

(async () => {
  // A listing in the tree's order: folders first, then names as people read them (shared/check-file-tree.cjs has the order).
  assert.deepEqual(plain(m.parseListing("f\0file10\0f\0file2\0")).map((e) => e.name), ["file2", "file10"]);
  assert.deepEqual(plain(m.parseListing("f\0b.txt\0d\0src\0f\0a b.md\0")), [{ name: "src", dir: true }, { name: "a b.md", dir: false }, { name: "b.txt", dir: false }]);
  assert.deepEqual(plain(m.ancestors("a/b/c.js")), ["a", "a/b"]);
  assert.deepEqual([m.join("", "a"), m.join("a", ""), m.join("/r/", "a"), m.join("/", "a")], ["a", "a", "/r/a", "/a"]);

  // Files only decorates ignored entries; a deleted path is not invented as a ghost tree row.
  const ignored = new Set(["dist", "old.log"]);
  m.markIgnored(ignored, "", [{ name: "dist", dir: true }, { name: "old.log", dir: false }, { name: "src", dir: true }], m.parseIgnored("dist/\0"));
  assert.deepEqual(plain([...ignored]), ["dist"]);
  const tree = { entries: new Map([["", [{ name: "dist", dir: true }, { name: "src", dir: true }, { name: "a.md", dir: false }]], ["dist", [{ name: "x.js", dir: false }]], ["src", [{ name: "b.js", dir: false }]]]),
    expanded: new Set(["dist", "src"]), ignored, marks: new Map([["src/c.js", "D"], ["src/b.js", "M"]]) };
  const rows = (st) => m.treeRows(m.folderEntries(st), (p) => st.expanded.has(p));
  assert.deepEqual(plain(rows(tree)).map((r) => [r.path, r.depth, r.ignored]),
    [["dist", 0, true], ["dist/x.js", 1, true], ["src", 0, false], ["src/b.js", 1, false], ["a.md", 0, false]]);
  tree.expanded.delete("src");
  assert.equal(rows(tree).some((r) => r.path.startsWith("src/")), false, "a closed folder's rows go");
  // A folder holding just a folder is one row with it once open, ignored as its last folder is.
  const chain = { entries: new Map([["", [{ name: "a", dir: true }]], ["a", [{ name: "b", dir: true }]], ["a/b", [{ name: "c.js", dir: false }]]]),
    expanded: new Set(["a", "a/b"]), ignored: new Set(["a/b"]), marks: new Map() };
  assert.deepEqual(plain(rows(chain)).map((r) => [r.path, r.name, r.ignored]), [["a/b", "a / b", true], ["a/b/c.js", "c.js", true]]);

  // Search: every term, case aside; a longer query starts from the last one's matches; it pauses every 5000, and stops
  // when a newer query comes.
  assert.deepEqual(plain(m.terms("  Review  DIFF ")), ["review", "diff"]);
  assert.equal(m.narrows("review d", "review"), true);
  assert.equal(m.narrows("revie", "review"), false);
  const paths = Array.from({ length: 12000 }, (_, i) => `packages/pkg-${i % 7}/src/Component-${i}.tsx`), lower = paths.map((p) => p.toLowerCase());
  let pauses = 0;
  const pause = async () => { pauses++; };
  const all = await m.filterPaths(lower, m.terms("PKG-3 component-1"), null, pause);
  assert.equal(pauses, 2, "12000 paths: two pauses");
  assert.ok(all.length > 0 && all.every((i) => paths[i].includes("pkg-3") && paths[i].includes("Component-1")));
  const narrower = await m.filterPaths(lower, m.terms("pkg-3 component-11"), all, pause);
  assert.deepEqual(plain(narrower), plain(await m.filterPaths(lower, m.terms("pkg-3 component-11"), null, pause)), "from the last matches, the same as from all");
  let calls = 0;
  assert.equal(await m.filterPaths(lower, ["src"], null, pause, () => ++calls < 1), null, "a newer query stops it");

  // Kinds and the Editor's languages.
  assert.equal(m.kindOf("a/Logo.PNG"), "image");
  assert.equal(m.kindOf("README.md"), "markdown");
  assert.equal(m.kindOf("Makefile"), "text");
  for (const [name, lang] of [["a.tsx", "js"], ["a.jsonc", "json"], ["a.yml", "yaml"], ["a.rs", "rust"], ["Makefile", "makefile"], ["GNUmakefile", "makefile"], ["a.hpp", "cpp"], ["a.toml", undefined], ["a.md", undefined], ["Dockerfile", undefined]])
    assert.equal(m.languageOf(name), lang, name);
  assert.match(m.readProblem(new Error("Text file exceeds 1 MiB")), /larger than 1 MB/);
  assert.deepEqual([m.failedRead("This file can't be read."), m.failedRead("This image can't be read."), m.failedRead("This is a binary file, so there's no text to show."), m.failedRead("This file was deleted.")], [true, true, false, false], "a failed read is retried from the error bar; what a file is, said on the page");
  assert.match(m.readProblem("stream did not contain valid UTF-8"), /binary/);
  assert.match(m.readProblem("Is a directory (os error 21)"), /can't be read/);

  // A newer request of the same kind makes the older one's answer stale; another kind's doesn't.
  const st = {};
  const first = m.ticket(st, "file"), list = m.ticket(st, "list:"), second = m.ticket(st, "file");
  assert.equal(first(), false);
  assert.equal(second(), true);
  assert.equal(list(), true);

  // Results in order: a file name holding every term first, then the shorter path, then as text.
  assert.deepEqual(plain(await m.rankPaths(["docs/indexing/x.md", "src/a/index.ts", "a/index.js", "index.md", "b/index.js"], m.terms("index"))),
    ["index.md", "a/index.js", "b/index.js", "src/a/index.ts", "docs/indexing/x.md"]);
  assert.deepEqual(plain(await m.rankPaths(["shared/file-menu.js", "docs/file/menu.md"], m.terms("file menu"))), ["shared/file-menu.js", "docs/file/menu.md"], "every term in the name");
  // Only the shown ones are kept in order, and a search matching most of a big repo pauses as the filter does: sorting
  // 110k matches in one go ran past Herdr's script limit (performance-audit.md).
  pauses = 0;
  const ranked = await m.rankPaths(paths, m.terms("src"), 200, pause);
  assert.equal(pauses, 2, "12000 matches: two pauses");
  const sorted = [...paths].sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).slice(0, 200);
  assert.deepEqual(plain(ranked), sorted, "the first 200, in the order a full sort gives");

  // The shell scripts, run: listing, ignored, the remote probe and search, in a repo with awkward names.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t3-files-check-"));
  try {
    const sh = (script, args, cwd = dir) => execFileSync("sh", ["-c", script, "t3-files", ...args], { cwd, encoding: "latin1", stdio: ["ignore", "pipe", "ignore"] });
    const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir });
    git("init", "-q");
    fs.mkdirSync(path.join(dir, "src/deep"), { recursive: true });
    fs.mkdirSync(path.join(dir, "node_modules/pkg"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n*.log\n");
    fs.writeFileSync(path.join(dir, "src/Read Me.md"), "# hi\n");
    fs.writeFileSync(path.join(dir, "src/deep/Main.TS"), "x\n");
    fs.writeFileSync(path.join(dir, ".env"), "A=1\n");
    fs.writeFileSync(path.join(dir, "app.log"), "log\n");
    fs.writeFileSync(path.join(dir, "node_modules/pkg/i.js"), "\n");
    fs.writeFileSync(path.join(dir, "bin.dat"), Buffer.from([1, 0, 2, 3]));
    git("add", "-A");
    git("commit", "-qm", "x");
    assert.deepEqual(plain(m.parseListing(sh(m.LIST, [dir]))).map((e) => `${e.dir ? "d" : "f"}:${e.name}`),
      ["d:node_modules", "d:src", "f:.env", "f:.gitignore", "f:app.log", "f:bin.dat"], ".git left out, dotfiles in");
    assert.throws(() => sh(m.LIST, [path.join(dir, "nope")]), "a folder that's gone fails");
    assert.deepEqual(plain([...m.parseIgnored(sh(m.IGNORED, [dir, ""]))].sort()), ["app.log", "node_modules"]);
    assert.deepEqual(plain([...m.parseIgnored(sh(m.IGNORED, [path.join(dir, "src"), "src/"]))]), [], "nothing ignored: no failure");
    assert.equal(sh(m.PROBE, [path.join(dir, "bin.dat")]).trim(), "4 1");
    assert.equal(sh(m.PROBE, [path.join(dir, "src/Read Me.md")]).trim(), "5 0");
    assert.throws(() => sh(m.PROBE, [path.join(dir, "nope")]));
    const search = (q) => sh(m.REMOTE_SEARCH, [q]).split("\n").filter(Boolean).sort();
    assert.deepEqual(search("main src"), ["src/deep/Main.TS"]);
    assert.deepEqual(search("read me"), ["src/Read Me.md"]);
    assert.deepEqual(search("'\\\"$(x)"), [], "the query is data");
    assert.deepEqual(search("pkg"), [], "ignored files aren't searched");
    fs.rmSync(path.join(dir, ".git"), { recursive: true });
    assert.deepEqual(search("pkg"), ["node_modules/pkg/i.js"], "outside Git: find");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  await collapseDuringExpansion();
  await manyFolders();
  await slowRefresh();
  await hideQueuedRefresh();
  await imagePreview(null);
  await imagePreview("remote");
  await expandReach();
  await largeFiles();
  await page();
  await lateReveal();
  await dragRows();
  await resources();
  await closeKeys();
  await surfaceCache();
  await firstPreviewFrame();
  await treeLoadingDelay();
  await latePreview();
  await searchMatchesWords();
  await menus();
  console.log("t3-files checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
