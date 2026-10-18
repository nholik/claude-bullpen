#!/usr/bin/env bash
# One-command worktree setup for builders and the gate. Creates the worktree,
# lays down .claude-plugin/types (gitignored) and runs a real `npm install`
# (never symlink node_modules: the vendor-freshness check then fails on
# rewritten path comments).
#
#   scripts/worktree.sh <issue> <slug>        # .worktrees/<issue> on branch <issue>-<slug>, from origin/main
#   scripts/worktree.sh --existing <name> <branch>
#                                             # .worktrees/<name> on a local branch <name> tracking origin/<branch> (gate)
#   scripts/worktree.sh --remove <name>       # refuses if uncommitted changes; else removes the worktree and its branch
#
# Prints the worktree path as its last line.

set -euo pipefail

# The main checkout, even when run from inside a worktree.
root="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"
cd "$root"

die() {
	echo "worktree.sh: $*" >&2
	exit 1
}

usage() {
	sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//' >&2
	exit 2
}

setup() {
	local dir="$1"
	local types="$root/.claude-plugin/types"
	if [[ -s "$types/claude-code/index.d.ts" ]]; then
		mkdir -p "$dir/.claude-plugin"
		cp -r "$types" "$dir/.claude-plugin/"
	else
		(cd "$dir" && scripts/ci-types.sh)
	fi
	(cd "$dir" && npm install --no-audit --no-fund)
	echo "$dir"
}

case "${1:-}" in
--remove)
	[[ $# -eq 2 ]] || usage
	dir="$root/.worktrees/$2"
	[[ -d "$dir" ]] || die "no worktree at $dir"
	[[ -z "$(git -C "$dir" status --porcelain)" ]] || die "$dir has uncommitted changes; commit or discard them first"
	branch="$(git -C "$dir" symbolic-ref --short -q HEAD || true)"
	git worktree remove "$dir"
	[[ -z "$branch" ]] || git branch -D "$branch"
	echo "removed $dir"
	;;
--existing)
	[[ $# -eq 3 ]] || usage
	name="$2"
	branch="$3"
	dir="$root/.worktrees/$name"
	[[ ! -e "$dir" ]] || die "$dir already exists"
	git show-ref --verify --quiet "refs/heads/$name" && die "branch $name already exists"
	git fetch -q origin "$branch"
	git worktree add "$dir" -b "$name" FETCH_HEAD
	setup "$dir"
	;;
-* | "")
	usage
	;;
*)
	[[ $# -eq 2 ]] || usage
	[[ "$1" =~ ^[0-9]+$ ]] || die "issue must be a number, got: $1"
	[[ "$2" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "slug must be lowercase letters, digits and dashes, got: $2"
	branch="$1-$2"
	dir="$root/.worktrees/$1"
	[[ ! -e "$dir" ]] || die "$dir already exists"
	git show-ref --verify --quiet "refs/heads/$branch" && die "branch $branch already exists"
	git fetch -q origin main
	git worktree add "$dir" -b "$branch" origin/main
	setup "$dir"
	;;
esac
