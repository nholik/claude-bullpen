#!/usr/bin/env bash
# Takes a real screenshot of the mod: starts Claude Code with this folder as a
# plugin inside a detached tmux session at a fixed size, types a command,
# waits, and captures the screen with colors. No model call is made for a
# slash command like `/bullpen demo`.
#
#   scripts/snap.sh                      # /bullpen demo at 160x48, capture after 12s
#   COLS=110 ROWS=40 WAIT=6 scripts/snap.sh "/bullpen demo"
#   SHOTS="3 8 14" scripts/snap.sh       # several captures at those seconds
#
# Writes .scratch/snaps/<name>-<t>s.ansi (view with `cat`) and a .png beside it
# (needs python3 with Pillow). Requires tmux and the claude CLI.

set -euo pipefail

cmd="${1:-/bullpen demo}"
cols="${COLS:-160}"
rows="${ROWS:-48}"
shots="${SHOTS:-${WAIT:-12}}"
name="${NAME:-snap}"
startup="${STARTUP:-8}"
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/.scratch/snaps"
session="bullpen-snap-$$"

mkdir -p "$out"
tmux_cmd=(tmux -L "$session" -f "$out/tmux.conf")
cleanup() { "${tmux_cmd[@]}" kill-server 2>/dev/null || true; }
trap cleanup EXIT

# Isolate capture settings from the user's tmux server, preserving RGB colors.
cat >"$out/tmux.conf" <<'EOF'
set -g default-terminal "tmux-256color"
set -as terminal-features ",*:RGB"
EOF
"${tmux_cmd[@]}" new-session -d -s "$session" -x "$cols" -y "$rows" \
	-e COLORTERM=truecolor -e FORCE_COLOR=3 -c "$root" "claude --plugin-dir '$root'"
sleep "$startup"
if "${tmux_cmd[@]}" capture-pane -p -t "$session" | grep -q "one you trust"; then
	echo "Claude Code is asking whether to trust $root." >&2
	echo "Run \`claude\` there once and choose 'Yes, I trust this folder', then retry." >&2
	exit 2
fi
"${tmux_cmd[@]}" send-keys -t "$session" -l "$cmd"
sleep 0.5
"${tmux_cmd[@]}" send-keys -t "$session" Enter

elapsed=0
for t in $shots; do
	sleep $((t - elapsed))
	elapsed=$t
	file="$out/$name-${t}s"
	"${tmux_cmd[@]}" capture-pane -p -e -t "$session" >"$file.ansi"
	if python3 -c "import PIL" 2>/dev/null; then
		python3 "$root/scripts/ansi2png.py" "$file.ansi" "$file.png"
	fi
	echo "$file.ansi"
done
