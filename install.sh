#!/usr/bin/env sh
set -eu

if node -e 'process.exit(1-require("node:util").debuglog("@verkstedt/lint").enabled)'
then
    set -x
fi

print_help ()
{
    printf "${ansi_bold}Set up linting.${ansi_reset}\n\n"
    printf "${ansi_bold}Usage:${ansi_reset} npx @verkstedt/lint ${ansi_italic}TARGET_DIR${ansi_reset}\n"
}

###
# Determine if colour output should be used
# $1: file descriptor to check (1 for stdout, 2 for stderr)
should_use_color ()
{
    fd="$1"

    if [ "${FORCE_COLOR-}" = "1" ]
    then
        return 0
    elif [ "${NO_COLOR-}" = "1" ]
    then
        return 1
    else
        [ -t "$fd" ] && [ -n "${TERM-}" ] && [ "$TERM" != "dumb" ] && [ "${CI-}" != "true" ]
    fi
}

###
# Print error message to stderr
ERROR ()
{
    printf "${ansi_error}ERROR: %s${ansi_reset}\n" "$1" >&2
}

pkg_ls ()
{
    if [ -e yarn.lock ]
    then
        yarn ls "$@"
    else
        npm ls "$@"
    fi
}

pkg_uninstall ()
{
    if [ -e yarn.lock ]
    then
        (
            set -x
            yarn uninstall "$@"
        )
    else
        (
            set -x
            npm uninstall "$@"
        )
    fi
}

pkg_install_dev ()
{
    if [ -e yarn.lock ]
    then
        (
            set -x
            yarn add -D "$@"
        )
    else
        (
            set -x
            npm install --save-dev "$@"
        )
    fi
}

###
# Cross–platform dirname + readlink -f
# $1: path to canonicalize
dirname_readlink ()
{
    path="$1"
    cd "$( dirname "$path" )"
    while [ -L "$path" ]
    do
        path=$( readlink "$path" )
        cd "$( dirname "$path" )"
    done
    pwd -P
}

###
# Read a code block from a markdown file
# $1: marker that’s placed before the code block
# $2: path to markdown file
read_file_from_markdown ()
{
    marker="$1"
    file_path="$2"

    contents=$(
        # Find a line matching the marker,
        # then print everything from first ``` until the next ```.
        awk \
            -v marker="$marker" \
            '
                p2 && /^\s*```$/ { exit }
                p1 && /^\s*```[a-z]*$/ { p2=1; next }
                $0 ~ marker { p1=1 }
                p2
            ' \
            "$file_path"
    )

    if [ -z "$contents" ]
    then
        ERROR "Failed to extract $marker from $file_path"
        exit 70 # EX_SOFTWARE
    fi

    printf '%s\n' "$contents" | sed 's/^   //'
}

###
# Compare two strings, ignoring all spaces
compare_no_spaces ()
{
    str1_no_spaces=$( printf '%s' "$1" | tr -d '[:space:]' )
    str2_no_spaces=$( printf '%s' "$2" | tr -d '[:space:]' )

    [ "$str1_no_spaces" = "$str2_no_spaces" ]
}

###
# Check for required dependencies
check_deps ()
{
    if ! command -v jq >/dev/null 2>&1
    then
        ERROR "jq is required but not installed. <https://jqlang.org/download/>"
        exit 69 # EX_UNAVAILABLE
    fi
}

###
# Install TypeScript
typescript_setup ()
{
    tsconfig_path="tsconfig.json"
    if ! [ -f "$tsconfig_path" ]
    then
        ERROR "$tsconfig_path not found."
        exit 78 # EX_CONFIG
    fi

    old_tsconfig_content=$( cat "$tsconfig_path" 2>/dev/null || echo "" )
    if [ -z "$old_tsconfig_content" ]
    then
        ERROR "$tsconfig_path is empty."
        exit 78 # EX_CONFIG
    fi

    expected_extends='@verkstedt/lint/tsconfig'
    actual_extends=$(
        echo "$old_tsconfig_content" \
            | grep -oE '"extends"\s*:\s*"[^\"]+"' 2>/dev/null \
            | sed 's/.*: *"\(.*\)".*/\1/'
    )

    if [ "$actual_extends" != "$expected_extends" ]
    then
        if [ -z "$actual_extends" ]
        then
            new_tsconfig_content=$(
              echo "$old_tsconfig_content" \
                  | sed "1s|{|{\n  \"extends\": \"@verkstedt/lint/tsconfig\",|"
            )
        else
            new_tsconfig_content=$(
              echo "$old_tsconfig_content" \
                  | sed "s|\"extends\"\s*:\s*\"[^\"]*\"|\"extends\": \"@verkstedt/lint/tsconfig\"|"
            )
        fi

        # Note: This does not check if we didn’t break the JSONC
        if [ -z "$new_tsconfig_content" ] || [ "$new_tsconfig_content" = "$old_tsconfig_content" ]
        then
            ERROR "Failed to update 'extends' in $tsconfig_path."
            exit 1 # EX_SOFTWARE
        fi

        printf '%s\n' "$new_tsconfig_content" > tsconfig.json
    fi
}

###
# Setup Prettier
prettier_setup ()
{
    config_file_extension="$1"
    config_contents="$2"
    ignore_contents="$3"

    expected_config_file="prettier.config.${config_file_extension}"
    expected_config_match="from '@verkstedt/lint/prettier'"
    existing_config_files=$(
        find . -maxdepth 1 -type f \( -name '.prettierrc' -or -name '.prettierrc.*' -or -name 'prettier.config.*' \)
    )
    accepted_legacy_config_file_content='"@verkstedt/eslint-config-verkstedt/prettier-config"'

    if [ -n "$( jq '.prettier // empty' package.json 2>/dev/null )" ]
    then
        ERROR "Prettier configuration found in package.json. Migrate to $expected_config_file"
        exit 78 # EX_CONFIG
    elif [ -z "$existing_config_files" ]
    then
        printf "%s\n" "$config_contents" > "$expected_config_file"
    elif [ "$(echo "$existing_config_files" | wc -l)" -gt 1 ]
    then
        ERROR "Multiple Prettier configuration files found:\n$existing_config_files"
        exit 78 # EX_CONFIG
    elif compare_no_spaces "$( cat "$existing_config_files" )" "$accepted_legacy_config_file_content"
    then
        printf "Removing legacy prettier configuration file: %s\n" "$existing_config_files"
        rm -v "$existing_config_files"
        printf "%s\n" "$config_contents" > "$expected_config_file"
    elif ! grep -q "$expected_config_match" "$existing_config_files"
    then
        ERROR "Prettier configuration found in '${existing_config_files}', but does not use vanilla verkstedt linting setup."
        exit 78 # EX_CONFIG
    fi

    if ! [ -f ".prettierignore" ]
    then
        echo "$ignore_contents" > .prettierignore
    fi
}

###
# Setup ESLint
eslint_setup ()
{
    config_file_extension="$1"
    config_contents="$2"

    expected_config_file="eslint.config.${config_file_extension}"
    expected_config_match="from '@verkstedt/lint/eslint'"
    existing_config_files=$(
        find . -maxdepth 1 -type f \( -name '.eslintrc' -or -name '.eslintrc.*' -or -name 'eslint.config.*' \)
    )
    recognised_legacy_config_match="@verkstedt/verkstedt|@verkstedt/eslint-config-verkstedt"
    vanilla_legacy_config_match=$(
        echo "
          ^module.exports = {
              extends: \[[\"']@verkstedt/verkstedt[^'\"]*[\"'],?\],?
          };?$
          " | tr -d '[:space:]'
    )

    if [ -n "$( jq '.eslintConfig // empty' package.json 2>/dev/null )" ]
    then
        ERROR "ESLint configuration found in package.json. Migrate to $expected_config_file"
        exit 78 # EX_CONFIG
    elif [ -z "$existing_config_files" ]
    then
        printf "%s\n" "$config_contents" > "$expected_config_file"
    elif [ "$(echo "$existing_config_files" | wc -l)" -gt 1 ]
    then
        ERROR "Multiple ESLint configuration files found:\n$existing_config_files"
        exit 78 # EX_CONFIG
    elif
        cat "$existing_config_files" | tr -d '[:space:]' \
            | grep -qE "$vanilla_legacy_config_match"
    then
        rm -v "$existing_config_files"
        printf "%s\n" "$config_contents" > "$expected_config_file"
    elif grep -qE "$recognised_legacy_config_match" "$existing_config_files"
    then
        ERROR "Legacy ESLint configuration found in '${existing_config_files}'. See <https://github.com/verkstedt/lint#user-content-install-migrate-from-eslint-config-verkstedt> for instructions."
        exit 78 # EX_CONFIG
    elif ! grep -qF "$expected_config_match" "$existing_config_files"
    then
        ERROR "ESLint configuration found in '${existing_config_files}', but does not use verkstedt linting setup."
        exit 78 # EX_CONFIG
    fi

    if [ -f ".eslintignore" ]
    then
        ERROR ".eslintignore file found. This configuration uses .gitignore from the root of the repository and entries from .prettierignore. Use one of them instead."
        exit 78 # EX_CONFIG
    fi
}

###
# Get dependency specifier for @verkstedt/lint itself
get_verkstedt_lint_pkg ()
{
    lint_dir="$1"
    (
        cd "$lint_dir"
        name="@verkstedt/lint"
        version=$( npm pkg get version | sed -E 's/^"|"$//g' )
        printf '%s@%s' "$name" "$version"
    )
}

###
# Get dependency specifier for a dev dependency
get_dev_dep_pkg ()
{
    lint_dir="$1"
    pkg="$2"
    (
        cd "$lint_dir"
        version="$( npm pkg get "devDependencies.$pkg" | sed -E 's/^"|"$//g' )"
        if [ "$version" = "{}" ] || [ -z "$version" ] || [ "$version" = "null" ]
        then
            ERROR "Package '$pkg' not found in devDependencies of $lint_dir/package.json."
            exit 70 # EX_SOFTWARE
        fi
        printf '%s@%s' "$pkg" "$version"
    )
}


main ()
{
    lint_dir=$( dirname_readlink "$0" )
    target_dir="$1"

    check_deps

    cd "$target_dir"

    uses_typescript=$(
        jq -r \
            '(.dependencies + .devDependencies).typescript | if . == null then "" else "1" end' \
            "$target_dir/package.json"
    )

    is_local_install=$(
        npm_cache_dir=$( npm config get cache 2>/dev/null )
        # if this script is called from a npm cache, it means it was
        # called as `npx @verkstedt/lint`. Otherwise it was probably called
        # from local checkout, e.g. `npx ~/src/@verkstedt/lint`.
        if ! echo "$lint_dir" | grep -qF "$npm_cache_dir"
        then
            echo 1
        fi
    )

    printf "\n${ansi_bold}REMOVE CONFLICTING NPM PACKAGES${ansi_reset}\n"
    pkg_uninstall \
        eslint-plugin-jsx-a11y \
        stylelint \
        eslint-plugin-react \
        eslint-plugin-react-hooks \
        eslint-plugin-import \
        eslint-config-next

    printf "\n${ansi_bold}INSTALL NPM PACKAGES${ansi_reset}\n"

    set --
    if [ -n "$is_local_install" ]
    then
        set -- "$@" "$lint_dir"
    else
        set -- "$@" "$( get_verkstedt_lint_pkg "$lint_dir" )"
    fi

    set -- \
        "$@" \
        "$( get_dev_dep_pkg "$lint_dir" eslint )" \
        "$( get_dev_dep_pkg "$lint_dir" prettier )"
    if [ -n "$uses_typescript" ]
    then
        # jiti is needed to load TypeScript ESLint config files
        set -- \
            "$@" \
            "$( get_dev_dep_pkg "$lint_dir" jiti )" \
            "$( get_dev_dep_pkg "$lint_dir" typescript-eslint )"
    fi
    pkg_install_dev "$@"

    if [ -n "$uses_typescript" ]
    then
        config_file_extension="ts"

        printf "\n${ansi_bold}SETUP TYPESCRIPT${ansi_reset}\n"
        typescript_setup
    else
        config_file_extension="mjs"
    fi

    printf "\n${ansi_bold}SETUP PRETTIER${ansi_reset}\n"
    prettier_config="$( read_file_from_markdown PRETTIER_CONFIG "$lint_dir/README.md" )"
    if [ -z "$prettier_config" ]
    then
        ERROR "Failed to determine prettier config conents"
        exit 70
    fi
    prettier_ignore="$(
      for path in \
          "$lint_dir/prettier/.prettierignore" \
          "$lint_dir/esm/prettier/.prettierignore"
      do
          if [ -f "$path" ]
          then
              cat "$path"
              break
          fi
      done
    )"
    if [ -z "$prettier_ignore" ]
    then
        ERROR "Failed to determine prettier ignore contents"
        exit 70
    fi
    prettier_setup "$config_file_extension" "$prettier_config" "$prettier_ignore"

    printf "\n${ansi_bold}SETUP ESLINT${ansi_reset}\n"
    eslint_config="$( read_file_from_markdown ESLINT_CONFIG "$lint_dir/README.md" )"
    eslint_setup "$config_file_extension" "$eslint_config"

    if [ -n "$is_local_install" ]
    then
        source="'$lint_dir'"
    else
        source="npm"
    fi
    printf \
        "\n${ansi_success}✅ Installed %s from %s${ansi_reset}\n" \
        "$( jq -r '.name + "@" + .version' "$lint_dir/package.json" )" \
        "$source"
    printf "Installation script modified your config files, but it is not infallible. ${ansi_bold}You should review the changes yourself.${ansi_reset}\n"
    printf 'You probably want to commit current changes and then run `eslint --fix .` and commit that separately.\n'
}

# Set up global variables

if should_use_color 1 && should_use_color 2
then
    ansi_error="\033[0;31m"
    ansi_success="\033[0;32m"
    ansi_bold="\033[1m"
    ansi_italic="\033[3m"
    ansi_reset="\033[0m"
else
    ansi_error=""
    ansi_success=""
    ansi_bold=""
    ansi_italic=""
    ansi_reset=""
fi

########

# Parse command line arguments

if [ "${1-}" = "--help" ] || [ "${1-}" = "-h" ]
then
    print_help
    exit 0
elif [ -z "${1-}" ]
then
    ERROR "Target directory not specified."
    print_help
    exit 64 # EX_USAGE
else
    target_dir="$1"
fi

# Do the thing

main "$target_dir"
