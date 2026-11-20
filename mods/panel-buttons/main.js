// Icon-only Files / Changes buttons for the tab bar, like stock Herdr's (without the titles).
// Files shows or hides the right panel (column `gitview-panel` > stack `gitview-body` >
// `files`, the files-t3 mod). Changes splits the focused pane to the right with the
// review pane (mod review-pane: every changed file stacked, like Zed's git: diff), or
// closes it if the shown tab already has one.
// Keys: `panel-buttons.files`, `panel-buttons.changes`, `panel-buttons.toggle`.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { focused, layout, nextCommand, panes, run, spaces, theme } from "herdr";

const PANEL = "gitview-panel", STACK = "gitview-body";
const find = (n, id) => n?.id === id ? n : (n?.children ?? []).reduce((hit, c) => hit ?? find(c, id), null);

function state() {
  const root = layout(), panel = find(root, PANEL), body = find(root, STACK);
  return { open: Boolean(panel && !panel.hidden), page: body?.active ?? null };
}

function files() {
  const s = state();
  if (s.open && s.page === "files") return run("layout.hide", { id: PANEL });
  run("layout.select", { stack: STACK, child: "files" });
  run("layout.show", { id: PANEL });
}

// The repo to show: the focused terminal's folder, on its machine (as the Files mod finds it).
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder || null, on: on ?? null };
}

const PANE_MOD = "review-pane";
const shownTab = () => focused()?.tab ?? spaces().find((s) => s.active)?.tabs.find((t) => t.active)?.id ?? null;
const changesPane = () => {
  const tab = shownTab();
  return tab ? panes().find((p) => p.mod === PANE_MOD && p.tab === tab) ?? null : null;
};

function changes() {
  const open = changesPane();
  if (open) return run("pane.close", { pane: open.pane });
  const tab = shownTab();
  if (!tab) return;
  // Split beside the focused pane; with a layout block focused (no pane), the tab's focused one.
  const f = focused(), mine = panes().filter((p) => p.tab === tab);
  const from = mine.find((p) => p.pane === f?.pane) ?? mine.find((p) => p.focused) ?? mine[0];
  const { cwd, on } = location();
  run("pane.split", { direction: "right", ...(from ? { pane: from.pane } : {}), mod: PANE_MOD, props: { cwd, on, space: spaces().find((s) => s.active)?.id ?? null } });
}

function toggle() {
  if (state().open) run("layout.hide", { id: PANEL });
  else files();
}

export default class PanelButtons extends View {
  init(_props, cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "files") files();
        else if (c === "changes") changes();
        else if (c === "toggle") toggle();
        cx.notify();
      }
    });
  }

  render() {
    const t = theme(), s = state();
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, icon, action) => {
      const on = id === "changes" ? Boolean(changesPane()) : s.open && s.page === id;
      return div().id(`panel-${id}`).size(28).flex_none().flex().items_center().justify_center().rounded(6)
        .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(st => st.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", stop).on_click(action)
        .child(svg(icon).size(15));
    };
    return h_flex().size_full().gap(2).items_center().justify_end().bg(t.chrome)
      .child(button("files", "mods/files/file.svg", files))
      .child(button("changes", "mods/changes/changes.svg", changes));
  }
}
