#!/usr/bin/env bash
# Writes .claude-plugin/types/ (which tsc needs) without signing in: Claude
# Code lays the mod API types down when it loads the mod at session start, and
# an interactive session gets that far signed out once onboarding and folder
# trust are pre-answered. Runs it in a throwaway config dir under a pty
# (`script`), waits for the types, then stops it. No model call is made.
#
#   scripts/ci-types.sh          # used by CI; needs the claude CLI on PATH

set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
types="$root/.claude-plugin/types/claude-code/index.d.ts"
limit="${TIMEOUT:-60}"

if [[ -s "$types" ]]; then
	echo "types already present: $types"
	exit 0
fi

config="$(mktemp -d)"
cleanup() {
	# script, claude and its helpers share one process group (setsid below).
	[[ -n "${pid:-}" ]] && kill -- "-$pid" 2>/dev/null || true
	rm -rf "$config"
}
trap cleanup EXIT

printf '{"hasCompletedOnboarding":true,"theme":"dark","projects":{"%s":{"hasTrustDialogAccepted":true}}}\n' \
	"$root" >"$config/.claude.json"

cd "$root"
CLAUDE_CONFIG_DIR="$config" TERM=xterm-256color \
	setsid script -qec "claude --plugin-dir ." /dev/null >/dev/null </dev/null &
pid=$!

for _ in $(seq "$limit"); do
	if [[ -s "$types" ]]; then
		# Let the writer finish the other type folders.
		sleep 2
		echo "wrote $(dirname "$(dirname "$types")")"
		exit 0
	fi
	sleep 1
done

echo "claude did not write $types within ${limit}s" >&2
exit 1
