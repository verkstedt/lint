#!/bin/sh
set -eu

exit_code=0

ASSERT_EQ () {
  name="$1"
  actual="$2"
  expected="$3"

  if [ "$actual" = "$expected" ]
  then
    echo "PASS $name"
  else
    echo "FAIL $name"
    exit_code=1
    actual_file="$( mktemp )"
    expected_file="$( mktemp )"
    trap 'rm -f "$actual_file" "$expected_file"' EXIT
    printf "%s" "$actual" > "$actual_file"
    printf "%s" "$expected" > "$expected_file"
    diff --color=always -u \
      --label "expected" \
      --label "actual" \
      "$expected_file" \
      "$actual_file"
  fi
}

prepare () {
  rm -rf "./testarea"
  mkdir "./testarea"
  cd "./testarea"
  git init --quiet
  echo '{}' > package.json
  ../../../install.sh . >/dev/null
}

prepare

ASSERT_EQ ".prettierignore" \
  "$( cat ./.prettierignore )" \
  "$( cat ../../../prettier/.prettierignore )"

ASSERT_EQ "prettier.config.mjs" \
  "$( cat ./prettier.config.mjs )" \
  "export { default as default } from '@verkstedt/lint/prettier';"

ASSERT_EQ "eslint.config.mjs" \
  "$( cat ./eslint.config.mjs )" \
  "$( cat << EOL
import { createVerkstedtConfig } from '@verkstedt/lint/eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  await createVerkstedtConfig({
    dir: import.meta.dirname,
    // If you have TypeScript files that are NOT included in your tsconfig (e.g.
    // config files or scripts), you specify them here.
    // https://typescript-eslint.io/packages/parser/#allowdefaultproject
    allowDefaultProject: ['*.config.*'],
    // Custom config for no-restricted-imports rule
    // https://eslint.org/docs/latest/rules/no-restricted-imports
    noRestrictedImportsConfig: {},
  }),
]);
EOL
)"

exit "$exit_code"
