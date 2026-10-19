#!/usr/bin/env bash
# agent-config installer (formerly model-ladder).
#
# Humans:     curl -fsSL https://raw.githubusercontent.com/elvisgastelum/agent-config/main/install.sh | bash
# Agents:     curl -fsSL https://raw.githubusercontent.com/elvisgastelum/agent-config/main/install.sh \
#               | bash -s -- install --runtime claude --yes --json
# Uninstall:  curl -fsSL https://raw.githubusercontent.com/elvisgastelum/agent-config/main/install.sh \
#               | bash -s -- --uninstall
#
# `--uninstall` removes everything agent-config wrote to your agents (restoring what it
# replaced), then the checkout, the `agent-config` and `model-ladder` commands and the saved
# configuration. Add `--force` to also remove agent files you edited after installing.
#
# Environment (each also read under its pre-rename MODEL_LADDER_* name):
#   AGENT_CONFIG_HOME     checkout location   (default: $HOME/.local/share/agent-config)
#   AGENT_CONFIG_REPO     git URL to clone    (default: https://github.com/elvisgastelum/agent-config.git)
#   AGENT_CONFIG_REF      branch or tag       (default: main)
#   AGENT_CONFIG_BIN_DIR  wrapper location    (default: $HOME/.local/bin)
#   AGENT_CONFIG_NO_RUN   set to 1 to install/update without running agent-config afterwards
#
# An install from before the rename (~/.local/share/model-ladder) is moved to the new location.
#
# All installer output goes to stderr so `--json` output on stdout stays machine-readable.

set -euo pipefail

# Everything lives in main() so bash has read the whole script before any command runs;
# this matters under `curl | bash`, where the script itself arrives on stdin.
main() {
  local default_home="$HOME/.local/share/agent-config"
  local legacy_home="$HOME/.local/share/model-ladder"
  local repo="${AGENT_CONFIG_REPO:-${MODEL_LADDER_REPO:-https://github.com/elvisgastelum/agent-config.git}}"
  local ref="${AGENT_CONFIG_REF:-${MODEL_LADDER_REF:-main}}"
  local home_dir="${AGENT_CONFIG_HOME:-${MODEL_LADDER_HOME:-$default_home}}"
  local bin_dir="${AGENT_CONFIG_BIN_DIR:-${MODEL_LADDER_BIN_DIR:-$HOME/.local/bin}}"
  local no_run="${AGENT_CONFIG_NO_RUN:-${MODEL_LADDER_NO_RUN:-0}}"
  local config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/agent-config"
  local state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/agent-config"
  local legacy_config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/model-ladder"
  local legacy_state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/model-ladder"
  # An uninstall of a copy that was never moved out of the pre-rename location.
  if [ ! -e "$home_dir" ] && [ "$home_dir" = "$default_home" ] && [ -d "$legacy_home/.git" ]; then
    case " $* " in *" --uninstall "*) home_dir="$legacy_home" ;; esac
  fi
  local entry="$home_dir/dist/cli.mjs"

  local c_info="" c_warn="" c_err="" c_off=""
  if [ -t 2 ] && [ -z "${NO_COLOR:-}" ]; then
    c_info=$'\033[1;36m' c_warn=$'\033[1;33m' c_err=$'\033[1;31m' c_off=$'\033[0m'
  fi
  say() { printf '%s==>%s %s\n' "$c_info" "$c_off" "$*" >&2; }
  warn() { printf '%swarning:%s %s\n' "$c_warn" "$c_off" "$*" >&2; }
  die() {
    printf '%serror:%s %s\n' "$c_err" "$c_off" "$1" >&2
    [ -n "${2:-}" ] && printf '  fix: %s\n' "$2" >&2
    exit 1
  }

  # `--uninstall` may appear anywhere; the remaining arguments go to `agent-config uninstall`.
  local uninstall=0 arg
  local -a rest=()
  for arg in "$@"; do
    if [ "$arg" = "--uninstall" ]; then uninstall=1; else rest+=("$arg"); fi
  done
  if [ "$uninstall" = 1 ]; then
    set -- ${rest[@]+"${rest[@]}"}
    if [ -f "$entry" ] && command -v node >/dev/null 2>&1; then
      say "Removing agent-config configuration from your agents"
      # stdout stays the command's own (for --json); exit 3 means edited files were kept.
      local rc=0
      node "$entry" uninstall --yes "$@" </dev/null || rc=$?
      [ "$rc" = 0 ] || [ "$rc" = 3 ] ||
        die "uninstall failed; nothing else was removed." "fix the error above, then re-run with --uninstall."
    elif [ -f "$state_dir/manifest.json" ] || [ -f "$legacy_state_dir/manifest.json" ]; then
      die "the agent-config checkout is missing, so its changes cannot be undone automatically." \
        "re-run the installer without --uninstall, then run it again with --uninstall."
    fi
    # Files you edited after installing are kept and stay recorded. Keep the tool too, so
    # `--uninstall --force` can still remove them. A pre-rename CLI records them in the old folder.
    local kept=0 manifest
    for manifest in "$state_dir/manifest.json" "$legacy_state_dir/manifest.json"; do
      if [ -f "$manifest" ] && ! grep -q '"records": \[\]' "$manifest"; then kept=1; fi
    done
    if [ "$kept" = 1 ]; then
      warn "kept files you edited after installing (listed above), and agent-config itself so they can still be removed."
      warn "to remove them too: re-run with --uninstall --force (or keep them and delete $home_dir by hand)."
      return 0
    fi
    rm -f "$bin_dir/agent-config" "$bin_dir/model-ladder"
    rm -rf "$home_dir" "$config_dir" "$state_dir" "$legacy_config_dir" "$legacy_state_dir"
    [ ! -d "$legacy_home/.git" ] || rm -rf "$legacy_home"
    say "agent-config uninstalled. Restart running agent sessions."
    return 0
  fi

  # Requirements: git and Node.js. dist/cli.mjs is prebuilt and self-contained, so there is
  # nothing to install or build; Vite+ is only the repository's development stack.
  command -v git >/dev/null 2>&1 ||
    die "git is required but was not found." "install git: https://git-scm.com/downloads"
  command -v node >/dev/null 2>&1 ||
    die "Node.js is required but was not found." \
      "install Node.js 24 LTS (https://nodejs.org or your package manager), then re-run."

  # The minimum Node.js version lives in one place: the checkout's package.json `engines.node`.
  check_checkout() {
    local min
    min="$(cd "$home_dir" && node -p '(/[0-9]+\.[0-9]+\.[0-9]+/.exec(require("./package.json").engines.node) || ["0.0.0"])[0]')" ||
      return 1
    if ! node -e '
      const parse = (v) => v.split(".").map(Number);
      const [a, b] = [parse(process.versions.node), parse(process.argv[1])];
      const cmp = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
      process.exit(cmp >= 0 ? 0 : 1);
    ' "$min"; then
      printf '%serror:%s Node.js >= %s is required (found %s).\n  fix: %s\n' "$c_err" "$c_off" \
        "$min" "$(node --version)" "upgrade Node.js (for example to 24 LTS), then re-run." >&2
      return 1
    fi
    node "$entry" --version </dev/null >/dev/null || {
      printf '%serror:%s %s does not run.\n' "$c_err" "$c_off" "$entry" >&2
      return 1
    }
  }

  # A pre-rename install is updated where it is and moved to the new location only once the
  # update works, so a failed update leaves the old command and checkout working.
  local move_to=""
  if [ "$home_dir" = "$default_home" ] && [ ! -e "$home_dir" ] && [ -d "$legacy_home/.git" ]; then
    move_to="$home_dir"
    home_dir="$legacy_home"
    entry="$home_dir/dist/cli.mjs"
    # Point the official pre-rename remote at the renamed repo; a fork or custom remote is kept.
    case "$(git -C "$home_dir" remote get-url origin 2>/dev/null || true)" in
      *elvisgastelum/model-ladder*) git -C "$home_dir" remote set-url origin "$repo" </dev/null >&2 || true ;;
    esac
  fi

  local prev=""
  if [ -d "$home_dir/.git" ]; then
    prev="$(git -C "$home_dir" rev-parse HEAD)"
    say "Updating $home_dir ($ref)"
    git -C "$home_dir" pull --ff-only --quiet origin "$ref" </dev/null >&2 ||
      die "could not update $home_dir; the installed version is unchanged." \
        "check your network and that $home_dir has no local commits, then re-run."
  else
    [ ! -e "$home_dir" ] ||
      die "$home_dir exists but is not a git checkout." "move it away or set AGENT_CONFIG_HOME, then re-run."
    say "Cloning $repo ($ref) into $home_dir"
    mkdir -p "$(dirname "$home_dir")"
    git clone --quiet --depth 1 --branch "$ref" "$repo" "$home_dir" </dev/null >&2 || {
      rm -rf "$home_dir"
      die "could not clone $repo ($ref)." "check the URL, the ref and your network, then re-run."
    }
  fi

  if ! check_checkout; then
    if [ -z "$prev" ]; then
      rm -rf "$home_dir"
      die "installation failed; removed the checkout at $home_dir." \
        "fix the error above, then re-run the installer."
    fi
    warn "update failed; restoring the previous version ($prev)"
    if git -C "$home_dir" reset --hard --quiet "$prev" </dev/null >&2 && check_checkout; then
      die "update to $ref failed; the previous version is still installed and working." \
        "fix the error above, then re-run the installer to update."
    fi
    die "update failed and the previous version does not run either." \
      "remove $home_dir and re-run the installer."
  fi

  if [ -n "$move_to" ]; then
    say "Moving $home_dir to $move_to (model-ladder is now agent-config)"
    mkdir -p "$(dirname "$move_to")"
    mv "$home_dir" "$move_to" ||
      die "could not move $home_dir to $move_to; the updated copy still works where it is." \
        "move it by hand, then re-run the installer."
    home_dir="$move_to"
    entry="$home_dir/dist/cli.mjs"
  fi

  mkdir -p "$bin_dir"
  # Single-quote paths so quotes, `$` or backticks in them cannot break the wrapper.
  # AGENT_CONFIG_HOME/BIN_DIR tell `agent-config self-update` which install to update.
  # `model-ladder` stays as an alias so agents and scripts using the old name keep working.
  sq() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
  local name
  for name in agent-config model-ladder; do
    printf '#!/bin/sh\nexport AGENT_CONFIG_HOME=%s\nexport AGENT_CONFIG_BIN_DIR=%s\nexec node %s "$@"\n' \
      "$(sq "$home_dir")" "$(sq "$bin_dir")" "$(sq "$entry")" >"$bin_dir/$name"
    chmod +x "$bin_dir/$name"
  done
  say "Installed $bin_dir/agent-config (alias: model-ladder)"
  case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *) warn "$bin_dir is not on your PATH; add: export PATH=\"$bin_dir:\$PATH\"" ;;
  esac

  if [ "$no_run" = "1" ]; then
    return 0
  fi
  # With no arguments, start the TUI. Under `curl | bash` stdin is the pipe, so
  # reattach it to the terminal when one is available.
  if [ "$#" -eq 0 ] && [ ! -t 0 ] && (: </dev/tty) 2>/dev/null; then
    exec node "$entry" </dev/tty
  fi
  exec node "$entry" "$@"
}

main "$@"
