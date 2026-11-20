# herdr-crest

My [Herdr](https://herdr.dev) app setup, ready to install on another machine. The `crest` layout is [herdr-t3](https://github.com/JinJieBeWater/herdr-t3) (T3 Code-style sidebar, slim tabs, framed panes) in Tokyo Night colours, with **Files** and **Changes** buttons at the end of the tab bar. Changes opens the [review pane](https://github.com/nichstoneking/herdr-review-pane) beside your terminal.

## Install

Needs Herdr 0.1.16 or newer, `rsync` and `jq`.

```sh
git clone https://github.com/nichstoneking/herdr-crest ~/GitHub/herdr-crest
~/GitHub/herdr-crest/install.sh
```

`install.sh` does the following:

1. Copies anything it's about to replace to `~/.config/herdr-app-backup-<time>`.
2. Copies the layout, the mods, the Tokyo Night theme and `keys.json` into `~/.config/herdr-app` (or `$HERDR_APP_HOME`).
3. Merges `settings.json` over yours. Keys this repo doesn't set, like a worktree folder or a herdr-core path, stay as they are.
4. Runs `herdr-app check` on every mod and switches a running Herdr to the `crest` layout.

Run it again after pulling to update. To undo, copy the backup folder's contents back.

Also install these:

- **[JetBrainsMono Nerd Font](https://www.nerdfonts.com)**, the UI font in `settings.json` (`brew install --cask font-jetbrains-mono-nerd-font`), or remove `ui_font` from `settings.json` before installing.
- **`git`**, and **[`gh`](https://cli.github.com)** signed in, on each machine whose repos you review. The review pane uses them for diffs and pull requests.

## What's in it

| Path | What |
|---|---|
| `layouts/crest.json` | The window: herdr-t3's layout with the changes below |
| `themes/tokyo-night.json` | [Tokyo Night](https://github.com/folke/tokyonight.nvim)'s Night colours; sidebar and bars in its darker `#16161e`, accent `#7aa2f7` |
| `mods/t3-*` | herdr-t3's mods from upstream commit [`a790cc2`](https://github.com/JinJieBeWater/herdr-t3/commit/a790cc280cfbc27e856672edb457e3ee4061cd92), without `t3-files` (only its right panel used it). Only `t3-chrome` is changed: it looks for the layout named `crest` instead of `herdr-t3` |
| `mods/panel-buttons` | The tab bar's Files and Changes buttons |
| `mods/review-pane` | The review pane (same as [herdr-review-pane](https://github.com/nichstoneking/herdr-review-pane)) |
| `mods/files-t3` | Herdr's Files mod with herdr-t3's 8px corners and no outline |
| `keys.json` | Herdr's keys, herdr-t3's keys, and the overrides below |
| `settings.json` | Font, size and weight, sounds on |

## How it differs from herdr-t3

- **Tab bar:** herdr-t3's Actions button and window-controls block are replaced by `panel-buttons`, 62px wide with two 28px buttons:
  - **Files** shows or hides a right panel (440px; 320 to 900) with `files-t3`, the browser for the focused terminal's folder.
  - **Changes** splits the focused pane with the review pane, or closes the review pane if the tab already has one.
- **Right panel:** herdr-t3's Files and Review panel (`t3-files`, `t3-chrome` surfaces) is removed from the layout, and `t3-files` with it.
- **Sidebar:** opens on Lists (Spaces + Agents) instead of Inbox. `cmd-shift-l` still switches between them.
- **Look:** the layout sets the `tokyo-night` theme, in light and dark mode alike. The theme picker in Settings still overrides it.
- **Keys** in the `crest` layout:

| Key | Does |
|---|---|
| `cmd-shift-g` | Open or close the review pane (`panel-buttons.changes`) |
| `cmd-shift-e` | Show or hide Files (`panel-buttons.files`) |
| `cmd-alt-b` | Show or hide the right panel (`panel-buttons.toggle`) |
| `cmd-b` | Show or hide the sidebar (`layout.toggle:sidebar`) |

All other keys are herdr-t3's; see its [guide](https://github.com/JinJieBeWater/herdr-t3/blob/main/docs/user/guide.md).

## Changing it

Herdr reloads mods as you edit them in `~/.config/herdr-app`. To save your edits back here, run:

```sh
cd ~/GitHub/herdr-crest
for m in mods/*/; do rsync -a --delete --exclude gpui-kit.d.ts --exclude jsconfig.json ~/.config/herdr-app/$m $m; done
cp ~/.config/herdr-app/layouts/crest.{json,svg} layouts/ && cp ~/.config/herdr-app/themes/tokyo-night.json themes/ && cp ~/.config/herdr-app/keys.json .
```

`settings.json` is copied by hand, since your live one can hold machine-specific paths.

## Credits

The layout and the `t3-*` mods are [herdr-t3](https://github.com/JinJieBeWater/herdr-t3) by JinJieBeWater (Apache-2.0). The colours are [Tokyo Night](https://github.com/folke/tokyonight.nvim) by Folke Lemaitre (MIT). The review pane started from [herdr-gitview](https://github.com/ChmaraX/herdr-gitview) by Adam Chmara (MIT), and its icons are from [Lucide](https://lucide.dev). See `LICENSE`.
