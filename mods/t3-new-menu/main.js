// New: open a tab in a live space, reopen a bookmarked project, or start a space on a chosen machine.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, spaces, panes, machines, run, closeOverlay, props, home, shared, setShared } from "herdr";
import { projectMark, placeOf, newTab } from "./project.js";
import { dormantProjects } from "./projects.js";
import { newSpacePlan } from "./new-space.js";
import { step, scrollList } from "./list.js";
import { keyOf, keyLabel } from "./tip.js";
import { stopsInit, stop, focusRoot } from "./focus.js";
import { KEY, closedKey } from "./store.js";
import { keycap, footAction, paletteFooter } from "./palette.js";

// As T3's command item: 6 + a 20px title + a 16px line + 6.
const ROW = 48;
// The list's share of T3's 420 once its border, search, top inset and heading, bottom inset and footer are in; the popup hugs its content.
const LIST_MAX = 420 - 2 - 48 - 8 - 28 - 8 - 41;
const STATE = { ready: "Connected", loading: "Loading…", unavailable: "Unavailable" };

export default class NewMenu extends View {
  init(_props, cx) {
    stopsInit(this, cx, "modal");
    this.at = 0;
    this.filter = "";
    this.picking = Boolean(props()?.pick); // choosing the machine for a new space; the sidebar's New space opens here
    const field = (placeholder) => {
      const input = InputState.new({ placeholder });
      input.on("change", (_e, cx) => { this.filter = input.value(); this.at = 0; cx.notify(); });
      input.on("submit", () => { this.choose(this.items()[this.at]); });
      return input;
    };
    this.spaceInput = field("Search spaces…");
    this.machineInput = field("Search machines…");
    (this.picking ? this.machineInput : this.spaceInput).focus();
  }

  // For the buttons that open this: see justClosed in focus.js. New space's and New tab's apart, as each opens the other's step.
  close() { setShared(closedKey("t3-new-menu", this.picking ? "pick" : undefined), Date.now()); }

  // The current space first, then its machine's, so a machine's spaces stay together.
  items(plan = undefined) {
    const q = this.filter.toLowerCase();
    if (this.picking) return (plan ?? newSpacePlan()).candidates.map(({ machine, layout }) => ({
      key: `machine:${machine ?? ""}`, machine, name: machine ?? "This computer", sub: machine ? STATE[layout] : "Local", off: layout !== "ready",
    })).filter((m) => m.name.toLowerCase().includes(q));
    const ps = panes(), all = spaces(), homeId = shared(KEY.home), here = all.find(s => s.active)?.machine ?? null;
    const rank = (s) => (s.active ? 0 : (s.machine ?? null) === here ? 1 : 2);
    const live = all.filter(s => s.id !== homeId && `${s.name} ${s.machine ?? ""} ${placeOf(s, ps)}`.toLowerCase().includes(q))
      .sort((a, b) => rank(a) - rank(b) || (a.machine ?? "").localeCompare(b.machine ?? ""))
      .map(s => ({ key: `space:${s.id}`, space: s }));
    const dormant = dormantProjects(all, ps, homeId, shared(KEY.projects), machines())
      .filter(p => `${p.name} ${p.machine ?? ""} ${p.folder}`.toLowerCase().includes(q))
      .map(p => {
        const key = `project:${p.machine ?? ""}:${p.folder}`;
        // The project mark remembers its last icon by id.
        return { key, project: { ...p, id: key }, off: p.off };
      });
    return [...live, ...dormant];
  }

  choose(item) {
    if (!item || item.off) return;
    closeOverlay(props().overlay);
    const p = item.project;
    if (item.space) newTab(item.space);
    else if (p) run("space.new", { folder: p.folder, machine: p.machine ?? "", ...(p.named ? { name: p.name } : {}) });
    else run("space.new", { machine: item.machine ?? "" });
  }

  showMachines(on, cx) {
    this.picking = on;
    this.at = 0;
    this.filter = "";
    const input = on ? this.machineInput : this.spaceInput;
    input.set_value("");
    input.focus();
    cx.notify();
  }

  row(item, i, ps) {
    const t = theme(), on = this.at === i, { space, project } = item, entry = space ?? project, h = home();
    const short = (p) => (p && h && p.startsWith(h) ? "~" + p.slice(h.length) : p ?? "");
    const folder = space ? placeOf(space, ps) : project?.folder;
    // An empty folder on a live remote space is its home.
    const sub = entry ? (space?.machine ? folder || "~" : short(folder)) : item.sub;
    return h_flex().id(item.key).w_full().h(ROW).px(8).py(6).gap(8).rounded(4).items_center().flex_none()
      .role("button").accessibility_label(entry?.name ?? item.name)
      .when(on, el => el.bg(t.selected))
      .when(Boolean(item.off), el => el.opacity(0.64))
      .on_hover((over, cx) => { if (over && this.at !== i) { this.at = i; cx.notify(); } })
      .on_click(() => this.choose(item))
      // As T3's CommandPaletteTitleIcon: level with the title, not the row.
      .child(h_flex().w(16).h(20).pt(2).self_start().flex_none().items_center().justify_center()
        .child(entry ? projectMark("mods/t3-new-menu", entry, 16, t, ps) : svg(`mods/t3-new-menu/icons/${item.machine ? "server" : "monitor"}.svg`).size(16).text_color(t.muted)))
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_color(t.foreground).child(entry?.name ?? item.name))
        .child(h_flex().min_w(0).gap(4).items_center().text_size(12).line_height("16px").text_color(t.dim)
          // As T3 marks a remote thread: a server icon, then the name.
          .when(Boolean(entry?.machine), el => el
            .child(svg("mods/t3-new-menu/icons/server.svg").size(12).flex_none().text_color(t.muted))
            .child(div().flex_none().text_color(t.muted).child(`${entry.machine} ·`)))
          .child(div().min_w(0).truncate().child(sub))))
      .when(Boolean(entry) && i < 9, el => el.child(div().flex_none().text_size(12).font_medium().text_color(t.muted).child(keyLabel(`cmd-${i + 1}`))));
  }

  render() {
    const t = theme(), ps = panes(), plan = newSpacePlan(), items = this.items(plan);
    // ⌘N doesn't ask: it only names what this button does when there's nothing to ask.
    const newKey = plan.ask ? "" : keyOf("space.new");
    return focusRoot(this, v_flex().id("new-menu").size_full().min_h(0).rounded(16).border(1).border_color(t.border).bg(t.popover).shadow_2xl().text_size(14).line_height("20px")
      .on_key_down((e, cx) => {
        if (e.key === "escape") return closeOverlay(props().overlay);
        const to = step(e, this.at, items.length);
        if (to >= 0) this.at = to;
        else if (!this.picking && /^[1-9]$/.test(e.key) && e.modifiers.platform) { cx.stop_propagation(); return this.choose(items[Number(e.key) - 1]); }
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().h(36).my(6).flex_none().pl(18).pr(20).gap(7).items_center()
        .child(svg("mods/t3-new-menu/icons/search.svg").size(16).flex_none().text_color(t.dim))
        .child(Input.new(this.picking ? this.machineInput : this.spaceInput).flex_1().h_full().text_size(14).text_color(t.foreground)))
      .child(div().mt(8).px(16).py(6).flex_none().text_size(12).line_height("16px").font_medium().text_color(t.muted).child(this.picking ? "Machines" : "Spaces"))
      .child(div().flex_none().mb(8).px(8)
        .when(items.length > 0, el => el.child(scrollList(this, "new-rows", { count: items.length, row: ROW, at: this.at, height: Math.min(items.length * ROW, LIST_MAX),
          draw: (i) => this.row(items[i], i, ps), wheeled: (keep) => { this.at = keep; } })))
        .when(items.length === 0, el => el.child(div().py(40).text_center().text_color(t.dim).child(this.picking ? "No matching machines." : "No matching spaces."))))
      .child(paletteFooter(t, [["↑ ↓", "Navigate"], ["Enter", this.picking ? "New space" : "New tab"], ["Esc", "Close"]], this.picking
        ? stop(this, t, "new-back", footAction(t, "new-back", "Back to spaces").on_click((_e, cx) => this.showMachines(false, cx)).child("← Spaces"), 8)
        : stop(this, t, "space-new", footAction(t, "space-new", "New space").on_click((_e, cx) => plan.ask ? this.showMachines(true, cx) : this.choose(plan.candidates[0]))
          .child(svg("mods/t3-new-menu/icons/folder-plus.svg").size(14).text_color(t.muted))
          .child("New space")
          .when(Boolean(newKey), row => row.child(keycap(t, newKey))), 8))));
  }
}
