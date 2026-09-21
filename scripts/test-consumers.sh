#!/usr/bin/env sh
# Runs the ESLint config from this working copy against every repository
# in the verkstedt GitHub organisation that depends on @verkstedt/lint.
set -eu
# Otherwise `cd` echoes the directory when CDPATH is set
unset CDPATH

org="verkstedt"
root="$( cd "$(dirname "$0")/.." && pwd )"
work_dir="${TMPDIR:-/tmp}/verkstedt-lint-consumers"
op_plugin_sh="${XDG_CONFIG_HOME:-$HOME/.config}/op/plugins.sh"

if [ -t 1 ] && [ "${NO_COLOR-}" != "1" ]
then
  bold="$( printf '\033[1m' )"
  dim="$( printf '\033[2m' )"
  red="$( printf '\033[31m' )"
  green="$( printf '\033[32m' )"
  reset="$( printf '\033[0m' )"
else
  bold=""
  dim=""
  red=""
  green=""
  reset=""
fi

ok_icon="✅"
fail_icon="❌"

print_help ()
{
  cat <<EOF
Test the ESLint config from this working copy in all repositories of the $org GitHub organisation that depend on @verkstedt/lint.

Usage: $0 [OPTIONS]

Each repository is cloned (or updated), the packed working copy is installed into it and \`eslint .\` is run. Clones of repositories with problems and all ESLint logs are kept for inspection.

Options:
  -r REGEXP,
  --repo=REGEXP     When specified, will only process repos matching this regular expression (\`grep -E\`)
  -b, --baseline    Do not install this working copy, lint with the @verkstedt/lint version each repository already uses, to see pre-existing problems
  --fix             Run EsLint with \`--fix\`
  -k, --keep-wins   Also keep clones of repositories without problems
  -h, --help        Show this help
EOF
}

baseline=0
keep_wins=0
repo_regexp=''
autofix=0
# `-:` makes getopts treat `--foo` as option `-` with argument `foo`
while getopts "r:bhk-:" opt
do
  case "$opt${OPTARG-}" in
    r*)
      repo_regexp="$OPTARG"
      ;;
    -repo=*)
      # OPTARG includes "epo" and the value
      repo_regexp="$( printf "%s" "$OPTARG" | sed 's/^repo=//' )"
      ;;
    # To keep complexity low, we don’t support `--repo REGEXP`.
    -repo*)
      printf "Use: --repo=REGEXP\n"
      exit 64 # EX_USAGE
      ;;
    b | -baseline)
      baseline=1
      ;;
    -fix)
      autofix=1
      ;;
    k | -keep-wins)
      keep_wins=1
      ;;
    h | -help)
      print_help
      exit 0 # EX_OK
      ;;
    *)
      print_help >&2
      exit 64 # EX_USAGE
      ;;
  esac
done
shift $((OPTIND - 1))
if [ $# -gt 0 ]
then
  print_help >&2
  exit 64 # EX_USAGE
fi

if ! command -v gh >/dev/null
then
  printf 'This script requires GitHub CLI (gh) to be installed: https://cli.github.com/\n' >&2
  exit 69 # EX_UNAVAILABLE
fi

# grep exits with 2 on an invalid regular expression, 1 just means no match
if [ -n "$repo_regexp" ] &&
  ! { printf '' | grep -E -- "$repo_regexp" >/dev/null 2>&1 || [ $? -eq 1 ]; }
then
  printf 'Invalid --repo regular expression: %s\n' "$repo_regexp" >&2
  exit 64 # EX_USAGE
fi

mkdir -p "$work_dir"
# TMPDIR may be relative, but the path is used after `cd`
work_dir="$( cd "$work_dir" && pwd )"

if [ -r "$op_plugin_sh" ]
then
  printf 'Sourcing 1Password shell plugins... '
  # shellcheck source=/dev/null
  . "$op_plugin_sh" >/dev/null >/dev/null 2>&1
  if type gh | grep -Eq 'gh is a (shell )?function'
  then
    printf 'gh plugin seems to be set up\n'
  else
    printf 'gh plugin not set up\n'
  fi
fi

printf 'Looking up repositories in %s that use @verkstedt/lint... ' "$org"
# Maximum `gh search code` allows
search_limit=1000
# lines: `org/name path_to_package_json`
search_results="$(
  gh search code "\"@verkstedt/lint\"" \
    --owner "$org" --filename package.json --limit "$search_limit" \
    --json repository,path \
    --jq '.[] | "\(.repository.nameWithOwner) \(.path)"'
)" || {
  printf '%s%s FAILED%s\n' "$red" "$fail_icon" "$reset"
  exit 69 # EX_UNAVAILABLE
}
if [ "$( printf '%s\n' "$search_results" | wc -l )" -ge "$search_limit" ]
then
  printf 'found %s or more, some may have been omitted\n' "$search_limit" >&2
  exit 70 # EX_SOFTWARE
fi
packages="$(
  printf '%s\n' "$search_results" |
    grep -v "^verkstedt/lint " |
    sort -u
)"
if [ -z "$packages" ]
then
  printf 'found none\n' >&2
  exit 69 # EX_UNAVAILABLE
fi
total="$( printf '%s\n' "$packages" | wc -l )"
if [ -n "$repo_regexp" ]
then
  printf 'found %s, filtering... ' "$total"
  packages="$(
    printf '%s\n' "$packages" |
      while read -r repo pkg_json
      do
        if printf '%s\n' "$repo" | grep -E -- "$repo_regexp" >/dev/null
        then
          printf '%s %s\n' "$repo" "$pkg_json"
        fi
      done
  )"
  if [ -z "$packages" ]
  then
    printf 'none matched\n' >&2
    exit 1
  fi
  total="$( printf '%s\n' "$packages" | wc -l )"
fi
printf 'found %s\n' "$total"

tarball=""
yarn_cache=""
if [ "$baseline" -eq 0 ]
then
  printf 'Packing @verkstedt/lint from %s... ' "$root"
  pack_log="$work_dir/pack.log"
  pack_output="$(
    cd "$root" >/dev/null &&
      npm pack --pack-destination "$work_dir" 2> "$pack_log"
  )" || {
    printf '%s\n' "$pack_output" >> "$pack_log"
    printf '%s%s FAILED%s, see %s\n' "$red" "$fail_icon" "$reset" "$pack_log"
    exit 70 # EX_SOFTWARE
  }
  tarball="$work_dir/$( printf '%s\n' "$pack_output" | tail -n 1 )"
  printf 'wrote %s\n' "$tarball"
  # The tarball path is the same on every run, so Yarn’s cache must not
  # outlive the run
  yarn_cache="$work_dir/yarn-cache"
  rm -rf "$yarn_cache"
fi

failed=""
i=0
prev_repo=""
while read -r repo pkg_json
do
  name="${repo#*/}"
  dir="$work_dir/$name"
  # Track if we are processing last entry for a repo to know if we can
  # remove temporary clone
  if [ "$repo" != "$prev_repo" ]
  then
    repo_packages_count="$( printf '%s\n' "$packages" | grep -c "^$repo " )"
    repo_done_count=0
  fi
  repo_done_count=$((repo_done_count + 1))
  prev_repo="$repo"
  pkg_dir="$( dirname "$pkg_json" )"
  pkg_root="$dir/$pkg_dir"
  slug="$name/$pkg_json"
  log="$work_dir/$( printf '%s' "$slug" | tr / _ ).log"
  : > "$log"

  i=$((i + 1))
  printf '\n%s=== %s/%s: %s/%s%s\n' "$bold" "$i" "$total" "$repo" "$pkg_json" "$reset"

  if [ "$repo_done_count" -gt 1 ]
  then
    printf 'Reusing <%s>... ' "$dir"
    (
      set -x
      git -C "$dir" reset --quiet --hard
    ) >> "$log" 2>&1
  elif [ -d "$dir/.git" ]
  then
    printf 'Updating <%s>... ' "$dir"
    (
      set -x
      git -C "$dir" fetch --quiet --depth 1 &&
        git -C "$dir" reset --quiet --hard FETCH_HEAD &&
        git -C "$dir" submodule update --init --recursive --depth 1
    ) >> "$log" 2>&1
  else
    printf 'Cloning to <%s>... ' "$dir"
    (
      set -x
      gh repo clone "$repo" "$dir" -- --quiet --depth 1 &&
        git -C "$dir" submodule update --init --recursive --depth 1
    ) >> "$log" 2>&1
  fi || {
    printf '%s%s FAILED%s, see %s\n' "$red" "$fail_icon" "$reset" "$log"
    failed="$failed $slug"
    continue
  }
  printf 'done\n'

  printf 'Detecting package manager... '
  pkg_mgr=""
  # In a monorepo the lockfile lives in the repository root, so packages are
  # installed there while @verkstedt/lint and ESLint run in the package
  install_root=""
  for candidate in "$pkg_root" "$dir"
  do
    if [ -f "$candidate/pnpm-lock.yaml" ]
    then
      pkg_mgr=pnpm
    elif [ -f "$candidate/package-lock.json" ]
    then
      pkg_mgr=npm
    elif [ -f "$candidate/yarn.lock" ]
    then
      # Yarn switches to the version a repository pins, so ask inside of it
      case "$( cd "$candidate" && yarn --version 2>/dev/null )" in
        1.*)
          pkg_mgr=yarn-classic
          ;;
        # We do not support yarn-berry currently. Ideally we’d drop support for yarn completely
      esac
    fi
    if [ -n "$pkg_mgr" ]
    then
      install_root="$candidate"
      break
    fi
  done
  if [ -z "$pkg_mgr" ]
  then
    printf '%s%s FAILED%s\n' "$red" "$fail_icon" "$reset"
    failed="$failed $slug"
    continue
  fi
  printf '%s\n' "$pkg_mgr"

  printf 'Installing packages... '
  case "$pkg_mgr" in
    npm)
      set -- npm ci --ignore-scripts --no-audit --no-fund
      ;;
    pnpm)
      set -- pnpm install --frozen-lockfile --ignore-scripts
      ;;
    yarn-classic)
      set -- yarn install --frozen-lockfile --ignore-scripts
      ;;
  esac
  (
    set -x
    cd "$install_root" && "$@"
  ) >> "$log" 2>&1 || {
    printf '%s%s FAILED%s, see %s\n' "$red" "$fail_icon" "$reset" "$log"
    failed="$failed $slug"
    continue
  }
  printf 'done\n'

  if [ -n "$tarball" ]
  then
    printf 'Installing @verkstedt/lint from this working copy... '
      case "$pkg_mgr" in
        npm)
          set -- npm install --no-save --ignore-scripts --no-audit --no-fund
          ;;
        pnpm)
          set -- pnpm add --save-dev --ignore-scripts --ignore-workspace-root-check
          ;;
        yarn-classic)
          # Yarn caches local tarballs by path, so keep the cache per run
          set -- yarn add --dev --ignore-scripts --cache-folder "$yarn_cache"
          ;;
      esac
    (
      set -x
      cd "$pkg_root" && "$@" "$tarball"
    ) >> "$log" 2>&1 || {
      printf '%s%s FAILED%s, see %s\n' "$red" "$fail_icon" "$reset" "$log"
      failed="$failed $slug"
      continue
    }
    printf 'done\n'
  fi

  printf 'Running EsLint... '
  if (
    case "$pkg_mgr" in
      npm)
        set -- npm exec -- eslint
        ;;
      pnpm)
        set -- pnpm exec eslint
        ;;
      yarn-classic)
        set -- yarn run eslint
        ;;
    esac
    if [ "$autofix" -eq 1 ]
    then
      set -- "$@" --fix
    fi
    cd "$pkg_root"
    set -x
    "$@" .
  ) >> "$log" 2>&1
  then
    printf '%s OK\n' "$ok_icon"
    if [ "$keep_wins" -eq 0 ] && [ "$repo_done_count" -eq "$repo_packages_count" ]
    then
      # Keep the clone when another package of this repository had problems
      case "$failed" in
        *" $name/"*)
          ;;
        *)
          rm -rf "$dir"
          ;;
      esac
    fi
  else
    printf '\n%s' "$red"
    # ESLint summary line, or whatever is there if ESLint crashed
    grep -A1 '^✖' "$log" | grep -E "^✖|potentially fixable with the \`--fix\`" || tail -n3 "$log"
    printf '%s' "$reset"
    printf '%s%s FAILED%s, see %s\n' "$red" "$fail_icon" "$reset" "$log"
    failed="$failed $slug"
  fi
# A here-document instead of a pipe, so that `failed` survives the loop
done <<EOF
$packages
EOF

printf '\n'
if [ -n "$failed" ]
then
  printf '%s%sProblems in:%s%s\n' "$bold" "$red" "$failed" "$reset"
  exit 1 # generic failure, some repositories have problems
else
  printf '%s%s%sAll repositories lint clean%s\n' "$bold" "$green" "$ok_icon" "$reset"
fi

if [ -z "$failed" ] && [ "$keep_wins" -eq "0" ]
then
  rm -rf "$work_dir"
  printf "%sRemoved temporary files.%s\n" "$dim" "$reset"
else
  printf "%sTemporary files left in <%s>.%s\n" "$dim" "$work_dir" "$reset"
fi
