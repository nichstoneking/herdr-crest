// Loads the menu in a fake `herdr`: ordering, scrolling, and where new tabs and spaces open.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const kit = require("./check-kit.js");
const element = kit.elements(), { find } = kit;
const text = (n) => typeof n === "string" ? n : n?.items ? n.items.map(text).join(" ") : "";

let spaces, machines, panes = [], closed = 0, checking = true;
let openProps = {};
const calls = [], state = {};
const cx = { notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {}, is_focused: () => false }) };
let platform = "macos";
const context = vm.createContext({
  View: class {}, div: element, svg: element, image: element, h_flex: element, v_flex: element, Input: { new: element },
  InputState: { new: () => { const on = {}; let value = ""; return { on: (e, f) => { on[e] = f; }, value: () => value, focus() {}, set_value(v) { value = v; }, type(v) { value = v; on.change({}, cx); }, submit() { on.submit(); } }; } },
  settings: () => ({ zoom: 1 }),
  theme: () => ({ foreground: "#fff" }), spaces: () => spaces, machines: () => machines, panes: () => panes, run: (name, args) => calls.push([name, args]),
  shared: (k) => state[k], setShared: (k, v) => { state[k] = v; }, closeOverlay() { closed++; }, props: () => ({ overlay: "o", ...openProps }), window: () => ({ platform }), keys: () => [{ section: "global", keys: "cmd-n", action: "space.new" }], home: () => "/home/me",
  checking: () => checking, prepareSpace() {}, exec: async () => { throw new Error("No icon probe in the test"); },
});
const read = (file) => fs.readFileSync(path.join(__dirname, file), "utf8");
// Keep project helpers in their module scope so their private keyOf doesn't collide with tip.js.
const projects = `const { projectMark, placeOf, newTab, dormantProjects } = (() => {
${["project.js", "projects.js"].map((file) => kit.strip(read(file))).join("\n")}
return { projectMark, placeOf, newTab, dormantProjects };
})();`;
const src = ["color.js", "store.js", "list.js", "tip.js", "focus.js", "palette.js", "new-space.js", "main.js"]
  .map((file) => kit.strip(read(file))).join("\n").replace("export default class", "globalThis.Mod = class");
vm.runInContext(projects + "\n" + src, context);
const open = () => { const m = new context.Mod(); m.init({}, cx); return m; };
const list = (m) => find(m.render(), "new-rows");
const keysOf = (m) => list(m).items.map((n) => n.key);
const click = (m, id) => find(list(m), id).handlers.on_click({}, cx);
const press = (m, key, platform = false) => m.render().handlers.on_key_down({ key, modifiers: { platform } }, cx);
const take = () => JSON.parse(JSON.stringify(calls.splice(0)));

const local = (id, active = false) => ({ id, name: id, folder: "/home/me/" + id, machine: null, active });
const remote = (id, active = false) => ({ id, name: id, folder: "", machine: "kvm", active });
machines = [{ name: null, layout: "ready" }, { name: "kvm", layout: "ready" }, { name: "away", layout: "unavailable" }];

// The current space leads, a machine's spaces stay together, ⌘n follows what's shown.
spaces = [remote("r1"), local("a"), remote("r2", true), local("b")];
let m = open();
assert.deepEqual(keysOf(m), ["space:r2", "space:r1", "space:a", "space:b"]);
press(m, "3", true);
assert.deepEqual(take(), [["tab.new", { space: "a", folder: "/home/me/a" }]]);
// A row's number reads as the platform names the key that picks it.
assert.ok(text(find(list(m), "space:a")).includes("⌘3"));
platform = "linux";
assert.ok(text(find(list(open()), "space:a")).includes("Super+3"), "not a Mac's ⌘ elsewhere");
platform = "macos";

// New work doesn't start in Home, shown or not.
state["t3-tabs.home"] = "a";
assert.deepEqual(keysOf(open()), ["space:r2", "space:r1", "space:b"]);
delete state["t3-tabs.home"];

// Up and down keep the highlighted row on screen, round the ends too; six rows show.
spaces = Array.from({ length: 9 }, (_, i) => local("s" + i, i === 0));
m = open();
press(m, "up");
assert.deepEqual([m.at, keysOf(m).at(-1)], [8, "space:s8"]);
press(m, "down");
assert.deepEqual([m.at, keysOf(m)[0]], [0, "space:s0"]);
for (let i = 0; i < 6; i++) press(m, "down");
assert.deepEqual([keysOf(m)[0], keysOf(m).at(-1)], ["space:s1", "space:s6"]);
// The pointer lights a row.
find(list(m), "space:s3").handlers.on_hover(true, cx);
assert.equal(m.at, 3);
spaces = [local("a", true), remote("r1"), local("b")];
m = open();
m.spaceInput.type("kvm");
assert.deepEqual(keysOf(m), ["space:r1"], "search finds a space by its machine");
assert.equal(m.at, 0);
m.spaceInput.type("nothing");
assert.equal(list(m), null);
press(m, "down"); // no rows: nothing to reach, nothing thrown
click(open(), "space:r1");
assert.deepEqual(take(), [["tab.new", { space: "r1", folder: "" }]]);

// Bookmarks follow live spaces, and neither the creation folder nor the current folder duplicates a live space.
spaces = [remote("r1"), { ...local("a", true), tabs: [{ id: "tab-a" }] }];
panes = [{ tab: "tab-a", cwd: "/home/me/current" }];
state["t3.projects"] = [
  { machine: null, folder: "/home/me/a", name: "Open at creation" },
  { machine: null, folder: "/home/me/current", name: "Open now" },
  { machine: null, folder: "/home/me/archive", name: "My Archive", named: true },
  { machine: "kvm", folder: "/srv/repo", name: "Repo" },
  { machine: "away", folder: "/srv/offline", name: "Offline" },
  { machine: "missing", folder: "/srv/gone", name: "Missing" },
];
m = open();
assert.deepEqual(keysOf(m), [
  "space:a", "space:r1", "project::/home/me/archive", "project:kvm:/srv/repo",
  "project:away:/srv/offline", "project:missing:/srv/gone",
]);
const archive = find(list(m), "project::/home/me/archive");
assert.equal(archive.style.h, 48);
assert.ok(text(archive).includes("My Archive ~/archive ⌘3"));
const beforeOpen = closed;
press(m, "3", true);
assert.equal(closed, beforeOpen + 1);
assert.deepEqual(take(), [["space.new", { folder: "/home/me/archive", machine: "", name: "My Archive" }]]);

// A bookmark with no cached icon falls back to its own mark when another bookmark has an icon.
checking = false;
state["t3.spaceIcons"] = { '[null,"/home/me/archive"]': "cache/archive.svg" };
const marked = list(open());
assert.ok(kit.walk(find(marked, "project::/home/me/archive")).some((node) => node.kind === "cache/archive.svg"));
assert.ok(kit.strings(find(marked, "project:kvm:/srv/repo")).includes("R"));
checking = true;
delete state["t3.spaceIcons"];

// Search matches a bookmark's name, machine and full folder.
for (const query of ["My Archive", "/HOME/ME/ARCHIVE"]) {
  m.spaceInput.type(query);
  assert.deepEqual(keysOf(m), ["project::/home/me/archive"]);
}
m.spaceInput.type("KVM");
assert.deepEqual(keysOf(m), ["space:r1", "project:kvm:/srv/repo"]);
const repo = find(list(m), "project:kvm:/srv/repo");
assert.deepEqual(kit.strings(repo).slice(-4), ["Repo", "kvm ·", "/srv/repo", "⌘2"]);
assert.ok(kit.walk(repo).some((node) => node.kind === "mods/t3-new-menu/icons/server.svg"));
assert.equal(repo.style.opacity, undefined);
press(m, "down");
m.spaceInput.submit();
assert.deepEqual(take(), [["space.new", { folder: "/srv/repo", machine: "kvm" }]]);

// An unavailable or unreported machine cannot open a bookmark by click, Enter or a numbered shortcut.
for (const [query, id] of [["away", "project:away:/srv/offline"], ["missing", "project:missing:/srv/gone"]]) {
  m = open();
  m.spaceInput.type(query);
  assert.equal(find(list(m), id).style.opacity, 0.64);
  const beforeDisabled = closed;
  click(m, id);
  m.spaceInput.submit();
  press(m, "1", true);
  assert.deepEqual(take(), []);
  assert.equal(closed, beforeDisabled);
}
panes = [];
delete state["t3.projects"];
spaces = [local("a", true), remote("r1"), local("b")];

// New space asks which machine; one that's away can't be picked.
m = open();
find(m.render(), "space-new").handlers.on_click({}, cx);
assert.deepEqual(take(), []);
assert.deepEqual(keysOf(m), ["machine:", "machine:away", "machine:kvm"]);
click(m, "machine:away");
assert.deepEqual(take(), []);
click(m, "machine:kvm");
assert.deepEqual(take(), [["space.new", { machine: "kvm" }]]);
m = open();
find(m.render(), "space-new").handlers.on_click({}, cx);
assert.equal(find(m.render(), "new-back").style.tab_index, 0, "Tab reaches ← Spaces");
find(m.render(), "new-back").handlers.on_click({}, cx);
assert.deepEqual(keysOf(m), ["space:a", "space:b", "space:r1"], "Back returns to the spaces");
assert.equal(find(m.render(), "space-new").style.tab_index, 0, "and New space, so the machine step is there without a mouse");
m = open();
find(m.render(), "space-new").handlers.on_click({}, cx);
click(m, "machine:");
assert.deepEqual(take(), [["space.new", { machine: "" }]], "This computer");

// The sidebar's New space opens on the machines; ⌘N, which doesn't ask, isn't offered as the same thing.
openProps = { pick: true };
m = open();
assert.deepEqual(keysOf(m), ["machine:", "machine:away", "machine:kvm"]);
click(m, "machine:kvm");
assert.deepEqual(take(), [["space.new", { machine: "kvm" }]]);
openProps = {};
assert.ok(!text(open().render()).includes("⌘N"), "no ⌘N beside a button that asks");

// On a remote space its machine is offered first; with one machine there is nothing to ask.
spaces = [local("a"), remote("r1", true)];
m = open();
find(m.render(), "space-new").handlers.on_click({}, cx);
assert.equal(keysOf(m)[0], "machine:kvm");
machines = [{ name: null, layout: "ready" }];
spaces = [local("a", true)];
m = open();
find(m.render(), "space-new").handlers.on_click({}, cx);
assert.deepEqual(take(), [["space.new", { machine: "" }]]);
assert.ok(text(open().render()).includes("⌘N"), "⌘N beside a button that does the same");

// Its contents are there from the first frame: a fade leaves the popup blank.
assert.notEqual(typeof open().render().style.opacity, "number");
// Closing says which step it was on, for the buttons that open each to toggle.
openProps = {}; open().close();
assert.ok(state["t3-new-menu.closed"] && !state["t3-new-menu.pickClosed"]);
openProps = { pick: true }; open().close();
assert.ok(state["t3-new-menu.pickClosed"]);
openProps = {};
console.log("ok new menu");
