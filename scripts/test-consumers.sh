#!/usr/bin/env sh
# Runs the ESLint config from this working copy against every repository
# in the verkstedt GitHub organisation that depends on @verkstedt/lint.
#
# Requires `gh` to be authenticated. Clones live in
# $TMPDIR/verkstedt-lint-consumers/ and are reused on subsequent runs.
# ESLint output is kept in logs/ next to them.
set -eu
# Otherwise `cd` echoes the directory when CDPATH is set
unset CDPATH

org="verkstedt"
root="$(cd "$(dirname "$0")/.." && pwd)"
work_dir="${TMPDIR:-/tmp}/verkstedt-lint-consumers"

if [ -t 1 ] && [ "${NO_COLOR-}" != "1" ]
then
  bold="$(printf '\033[1m')"
  dim="$(printf '\033[2m')"
  red="$(printf '\033[31m')"
  green="$(printf '\033[32m')"
  reset="$(printf '\033[0m')"
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

mkdir -p "$work_dir"

printf 'Looking up repositories in %s that use @verkstedt/lint... ' "$org"
repos="$(
  gh search code "\"@verkstedt/lint\"" \
    --owner "$org" --filename package.json --limit 100 \
    --json repository,path \
    --jq '.[] | select(.path == "package.json") | .repository.nameWithOwner' |
    grep -v "^$org/lint$" | sort -u
)"
if [ -z "$repos" ]
then
  printf 'found none\n' >&2
  exit 69 # EX_UNAVAILABLE
fi
total="$(printf '%s\n' "$repos" | wc -l)"
if [ -n "$repo_regexp" ]
then
  printf 'found %s, filtering... ' "$total"
  repos="$( printf "%s" "$repos" | grep "$repo_regexp" )"
  total="$(printf '%s\n' "$repos" | wc -l)"
fi
printf 'found %s\n' "$total"

tarball=""
if [ "$baseline" -eq 0 ]
then
  printf 'Packing @verkstedt/lint from %s... ' "$root"
  # `npm pack` runs the build first, so only the last line is the file name
  tarball="$work_dir/$(
    cd "$root" >/dev/null &&
      npm pack --pack-destination "$work_dir" 2>/dev/null | tail -n 1
  )"
  printf 'wrote %s\n' "$tarball"
fi

failed=""
i=0
for repo in $repos
do
  name="${repo#*/}"
  dir="$work_dir/$name"
  log="$work_dir/$name.log"
  : > "$log"

  i=$((i + 1))
  printf '\n%s=== %s/%s: %s%s\n' "$bold" "$i" "$total" "$repo" "$reset"

  if [ -d "$dir/.git" ]
  then
    printf 'Updating <%s>... ' "$dir"
    # Discard whatever previous run left behind (e.g. lockfile changes)
    (
      set -ex
      git -C "$dir" fetch --quiet --depth 1
      git -C "$dir" reset --quiet --hard FETCH_HEAD
      git -C "$dir" submodule update --init --recursive --depth 1
    ) >> "$log" 2>&1
  else
    printf 'Cloning to <%s>... ' "$dir"
    (
      set -ex
      gh repo clone "$repo" "$dir" -- --quiet --depth 1
      git -C "$dir" submodule update --init --recursive --depth 1
    ) >> "$log" 2>&1
  fi || {
    printf '%s%s FAILED%s, see %s\n' "$red" "$fail_icon" "$reset" "$log"
    failed="$failed $name"
    continue
  }
  printf 'done\n'

  printf 'Detecting package manager... '
  if [ -f "$dir/pnpm-lock.yaml" ]
  then
    pkg_mgr=pnpm
  elif [ -f "$dir/package-lock.json" ]
  then
    pkg_mgr=npm
  elif [ -f "$dir/yarn.lock" ] && ! yarn dlx --help >/dev/null 2>&1
  then
    pkg_mgr=yarn-classic
    # We do not support yarn-berry currently. Ideally we’d drop support for yarn completely
  else
    printf '%s%s FAILED%s\n' "$red" "$fail_icon" "$reset"
    failed="$failed $name"
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
      set -- yarn install --immutable --mode=skip-builds
      ;;
  esac
  (
    set -x
    cd "$dir"
    "$@"
  ) >> "$log" 2>&1 || {
    printf '%s%s FAILED%s, see %s\n' "$red" "$fail_icon" "$reset" "$log"
    failed="$failed $name"
    continue
  }
  printf 'done\n'

  if [ -n "$tarball" ]
  then
    printf 'Installing @verkstedt/lint from this working copy... '
      # Modifies package.json and the lockfile, which is discarded above
      case "$pkg_mgr" in
        npm)
          set -- npm install --no-save --ignore-scripts --no-audit --no-fund
          ;;
        pnpm)
          set -- pnpm add --save-dev --ignore-scripts
          ;;
        yarn-classic)
          set -- yarn add --dev --ignore-scripts
          ;;
      esac
    (
      set -x
      cd "$dir"
      "$@" "$tarball"
    ) >> "$log" 2>&1 || {
      printf '%s%s FAILED%s, see %s\n' "$red" "$fail_icon" "$reset" "$log"
      failed="$failed $name"
      continue
    }
    printf 'done\n'
  fi

  printf 'Running EsLint... '
  if (
    set -e
    if [ "$autofix" -eq 0 ]
    then
      set --
    else
      set -- --fix
    fi
    cd "$dir"
    set -x
    npx eslint "$@" .
  ) >> "$log" 2>&1
  then
    printf '%s OK\n' "$ok_icon"
    if [ "$keep_wins" -eq 0 ]
    then
      rm -rf "$dir"
    fi
  else
    printf '\n%s' "$red"
    # ESLint summary line, or whatever is there if ESLint crashed
    grep -A1 '^✖' "$log" | grep -E "^✖|potentially fixable with the \`--fix\`" || tail -n3 "$log"
    printf '%s' "$reset"
    printf '%s%s FAILED%s, see %s\n' "$red" "$fail_icon" "$reset" "$log"
    failed="$failed $name"
  fi
done

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
