#!/usr/bin/env bash
# model-ladder installer.
#
# Humans:     curl -fsSL https://raw.githubusercontent.com/elvisgastelum/model-ladder/main/install.sh | bash
# Agents:     curl -fsSL https://raw.githubusercontent.com/elvisgastelum/model-ladder/main/install.sh \
#               | bash -s -- install --runtime claude --yes --json
# Uninstall:  curl -fsSL https://raw.githubusercontent.com/elvisgastelum/model-ladder/main/install.sh \
#               | bash -s -- --uninstall
#
# `--uninstall` removes everything model-ladder wrote to your agents (restoring what it
# replaced), then the checkout, the `model-ladder` command and the saved configuration.
# Add `--force` to also remove agent files you edited after installing.
#
# Environment:
#   MODEL_LADDER_HOME     checkout location   (default: $HOME/.local/share/model-ladder)
#   MODEL_LADDER_REPO     git URL to clone    (default: https://github.com/elvisgastelum/model-ladder.git)
#   MODEL_LADDER_REF      branch or tag       (default: main)
#   MODEL_LADDER_BIN_DIR  wrapper location    (default: $HOME/.local/bin)
#   MODEL_LADDER_NO_RUN   set to 1 to install/update without running model-ladder afterwards
#
# All installer output goes to stderr so `--json` output on stdout stays machine-readable.

set -euo pipefail

# Everything lives in main() so bash has read the whole script before any command runs;
# this matters under `curl | bash`, where the script itself arrives on stdin.
main() {
  local repo="${MODEL_LADDER_REPO:-https://github.com/elvisgastelum/model-ladder.git}"
  local ref="${MODEL_LADDER_REF:-main}"
  local home_dir="${MODEL_LADDER_HOME:-$HOME/.local/share/model-ladder}"
  local bin_dir="${MODEL_LADDER_BIN_DIR:-$HOME/.local/bin}"
  local entry="$home_dir/dist/cli.mjs"
  local config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/model-ladder"
  local state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/model-ladder"

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

  # `--uninstall` may appear anywhere; the remaining arguments go to `model-ladder uninstall`.
  local uninstall=0 arg
  local -a rest=()
  for arg in "$@"; do
    if [ "$arg" = "--uninstall" ]; then uninstall=1; else rest+=("$arg"); fi
  done
  if [ "$uninstall" = 1 ]; then
    set -- ${rest[@]+"${rest[@]}"}
    if [ -f "$entry" ] && command -v node >/dev/null 2>&1; then
      say "Removing model-ladder configuration from your agents"
      node "$entry" uninstall --yes "$@" </dev/null >&2 ||
        die "uninstall failed; nothing else was removed." "fix the error above, then re-run with --uninstall."
    elif [ -f "$state_dir/manifest.json" ]; then
      die "the model-ladder checkout is missing, so its changes cannot be undone automatically." \
        "re-run the installer without --uninstall, then run it again with --uninstall."
    fi
    # Files you edited after installing are kept and stay recorded. Keep the tool too, so
    # `--uninstall --force` can still remove them.
    if [ -f "$state_dir/manifest.json" ] && ! grep -q '"records": \[\]' "$state_dir/manifest.json"; then
      warn "kept files you edited after installing (listed above), and model-ladder itself so they can still be removed."
      warn "to remove them too: re-run with --uninstall --force (or keep them and delete $home_dir by hand)."
      return 0
    fi
    rm -f "$bin_dir/model-ladder"
    rm -rf "$home_dir" "$config_dir" "$state_dir"
    say "model-ladder uninstalled. Restart running agent sessions."
    return 0
  fi

  command -v git >/dev/null 2>&1 ||
    die "git is required but was not found." "install git: https://git-scm.com/downloads"
  command -v node >/dev/null 2>&1 ||
    die "Node.js is required but was not found." \
      "install Node.js 24 LTS (https://nodejs.org, vp env, nvm, fnm or your package manager), then re-run."

  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  local -a pnpm_cmd
  if command -v pnpm >/dev/null 2>&1; then
    pnpm_cmd=(pnpm)
  elif command -v corepack >/dev/null 2>&1 && corepack enable >/dev/null 2>&1 &&
    command -v pnpm >/dev/null 2>&1; then
    pnpm_cmd=(pnpm)
  elif command -v corepack >/dev/null 2>&1; then
    # `corepack enable` can fail without write access to node's bin dir; corepack still works.
    pnpm_cmd=(corepack pnpm)
  else
    die "pnpm is required and corepack is unavailable." \
      "run 'npm install -g pnpm' (or 'npm install -g corepack && corepack enable'), then re-run."
  fi

  # The minimum Node.js version lives in one place: the checkout's package.json `engines.node`.
  check_node() {
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
        "$min" "$(node --version)" "upgrade Node.js (e.g. 'vp env install 24' or 'nvm install 24'), then re-run." >&2
      return 1
    fi
  }
  build_checkout() {
    check_node || return 1
    say "Installing dependencies"
    (cd "$home_dir" && "${pnpm_cmd[@]}" install --frozen-lockfile </dev/null >&2) || return 1
    say "Building"
    (cd "$home_dir" && "${pnpm_cmd[@]}" run build </dev/null >&2) || return 1
    [ -f "$entry" ] || {
      printf '%serror:%s build did not produce %s\n' "$c_err" "$c_off" "$entry" >&2
      return 1
    }
  }

  local prev=""
  if [ -d "$home_dir/.git" ]; then
    prev="$(git -C "$home_dir" rev-parse HEAD)"
    say "Updating $home_dir ($ref)"
    git -C "$home_dir" pull --ff-only --quiet origin "$ref" </dev/null >&2 ||
      die "could not update $home_dir; the installed version is unchanged." \
        "check your network and that $home_dir has no local commits, then re-run."
  else
    [ ! -e "$home_dir" ] ||
      die "$home_dir exists but is not a git checkout." "move it away or set MODEL_LADDER_HOME, then re-run."
    say "Cloning $repo ($ref) into $home_dir"
    mkdir -p "$(dirname "$home_dir")"
    git clone --quiet --depth 1 --branch "$ref" "$repo" "$home_dir" </dev/null >&2 || {
      rm -rf "$home_dir"
      die "could not clone $repo ($ref)." "check the URL, the ref and your network, then re-run."
    }
  fi

  if ! build_checkout; then
    if [ -z "$prev" ]; then
      rm -rf "$home_dir"
      die "installation failed; removed the partial checkout at $home_dir." \
        "fix the error above, then re-run the installer."
    fi
    warn "update failed; restoring the previous version ($prev)"
    if git -C "$home_dir" reset --hard --quiet "$prev" </dev/null >&2 && build_checkout; then
      die "update to $ref failed; the previous version is still installed and working." \
        "fix the error above, then re-run the installer to update."
    fi
    die "update failed and the previous version could not be rebuilt." \
      "remove $home_dir and re-run the installer."
  fi

  mkdir -p "$bin_dir"
  printf '#!/bin/sh\nexec node "%s" "$@"\n' "$entry" >"$bin_dir/model-ladder"
  chmod +x "$bin_dir/model-ladder"
  say "Installed $bin_dir/model-ladder"
  case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *) warn "$bin_dir is not on your PATH; add: export PATH=\"$bin_dir:\$PATH\"" ;;
  esac

  if [ "${MODEL_LADDER_NO_RUN:-0}" = "1" ]; then
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
