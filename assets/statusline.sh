#!/bin/bash
# Claude Code status line, styled after zap-prompt.
input=$(cat)
j() { echo "$input" | jq -r "$1 // empty" 2>/dev/null; }

dir=$(j '.workspace.current_dir'); [ -z "$dir" ] && dir=$(j '.cwd')
model=$(j '.model.display_name')
used=$(j '.context_window.used_percentage')
five=$(j '.rate_limits.five_hour.used_percentage')
week=$(j '.rate_limits.seven_day.used_percentage')

Y=$'\033[1;33m'; G=$'\033[1;32m'; C=$'\033[36m'; B=$'\033[34m'
R=$'\033[31m'; M=$'\033[35m'; D=$'\033[2m'; Z=$'\033[0m'

out="${Y}⚡${G}➜ ${C}$(basename "${dir:-$PWD}")${Z}"

if [ -n "$dir" ] && git -C "$dir" --no-optional-locks rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  branch=$(git -C "$dir" --no-optional-locks symbolic-ref --short HEAD 2>/dev/null || git -C "$dir" --no-optional-locks rev-parse --short HEAD 2>/dev/null)
  mark=""
  st=$(git -C "$dir" --no-optional-locks status --porcelain 2>/dev/null)
  [ -n "$st" ] && mark="${R}*"
  out="$out ${B}(${mark}${M} ${branch}${B})${Z}"
fi

[ -n "$model" ] && out="$out ${D}|${Z} ${model}"
[ -n "$used" ] && out="$out ${D}|${Z} ctx $(printf '%.0f' "$used")%"
lim=""
[ -n "$five" ] && lim="5h:$(printf '%.0f' "$five")%"
[ -n "$week" ] && lim="$lim 7d:$(printf '%.0f' "$week")%"
[ -n "$lim" ] && out="$out ${D}|${Z} ${lim# }"

printf '%s' "$out"
