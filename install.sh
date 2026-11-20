#!/usr/bin/env bash
# Installs this Herdr setup into ~/.config/herdr-app (or $HERDR_APP_HOME):
# the crest layout, its mods, the Tokyo Night theme, keys.json, and settings.json (merged over yours).
# Everything it replaces is copied to <home>-backup-<time> first.
set -euo pipefail

src=$(cd "$(dirname "$0")" && pwd)
home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
backup="$home-backup-$(date +%Y%m%d-%H%M%S)"

for tool in rsync jq; do
  command -v "$tool" >/dev/null || { echo "install.sh needs $tool" >&2; exit 1; }
done

mods=()
for dir in "$src"/mods/*/; do mods+=("$(basename "$dir")"); done

# Copy what's at <home>/<path> into the backup before it's replaced.
save() {
  [ -e "$home/$1" ] || return 0
  mkdir -p "$backup/$(dirname "$1")"
  cp -R "$home/$1" "$backup/$1"
}

mkdir -p "$home/mods" "$home/layouts" "$home/themes"

for m in "${mods[@]}"; do
  save "mods/$m"
  # Herdr writes gpui-kit.d.ts and jsconfig.json into mod folders; leave them be.
  rsync -a --delete --exclude gpui-kit.d.ts --exclude jsconfig.json "$src/mods/$m/" "$home/mods/$m/"
done

for f in layouts/crest.json layouts/crest.svg themes/tokyo-night.json keys.json; do
  save "$f"
  cp "$src/$f" "$home/$f"
done

# settings.json holds per-machine things too (worktree folder, herdr-core path): keep
# those and set only the keys this repo has.
save settings.json
if [ -f "$home/settings.json" ]; then
  jq -s '.[0] * .[1]' "$home/settings.json" "$src/settings.json" > "$home/settings.json.tmp"
  mv "$home/settings.json.tmp" "$home/settings.json"
else
  cp "$src/settings.json" "$home/settings.json"
fi

echo "Installed ${#mods[@]} mods, the crest layout, the tokyo-night theme, keys.json and settings.json into $home"
[ -d "$backup" ] && echo "Replaced files are in $backup"

if ! command -v herdr-app >/dev/null; then
  echo "herdr-app isn't on PATH: open Herdr and pick the crest layout (ctrl-shift-l)."
  exit 0
fi

failed=0
for m in "${mods[@]}"; do
  herdr-app check "$home/mods/$m" >/dev/null || { echo "check failed: mods/$m" >&2; failed=1; }
done
[ "$failed" = 0 ] && echo "All mods pass herdr-app check"

if herdr-app status >/dev/null 2>&1; then
  herdr-app do layout.switch --name crest >/dev/null && echo "Switched Herdr to the crest layout"
else
  echo "Herdr isn't running: open it and pick the crest layout (ctrl-shift-l)."
fi
exit "$failed"
