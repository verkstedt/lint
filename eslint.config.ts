import { fileURLToPath } from 'node:url';

import { defineConfig } from 'eslint/config';

import { createVerkstedtConfig, includeIgnoreFile } from './eslint/index.ts';

export default defineConfig([
  // If you want to ignore files, specify them in `.prettierignore`,
  // so that they are also ignored by Prettier.
  // Verkstedt config automatically ignores files specified in
  // `.gitignore` in the same directory as this config file in
  // addition to some other commonly ignored files.
  includeIgnoreFile(
    fileURLToPath(new URL('./.prettierignore', import.meta.url)),
  ),
  await createVerkstedtConfig({
    dir: fileURLToPath(new URL('.', import.meta.url)),
    // If you have TypeScript files that are NOT included in your tsconfig (e.g.
    // config files or scripts), you specify them here.
    // https://typescript-eslint.io/packages/parser/#allowdefaultproject
    allowDefaultProject: ['*.config.*', 'scripts/*.ts', 'scripts/utils/*.ts'],
  }),
]);
