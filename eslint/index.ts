import fs from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { WriteStream } from 'node:tty';
import { fileURLToPath } from 'node:url';
import { debuglog, inspect } from 'node:util';

import cssModulesPlugin from '@bhollis/eslint-plugin-css-modules';
import { includeIgnoreFile as includeIgnoreFileOriginal } from '@eslint/config-helpers';
import type { Plugin } from '@eslint/core';
import css from '@eslint/css';
import js from '@eslint/js';
import json from '@eslint/json';
import markdown from '@eslint/markdown';
import { recommended as eslintCommentsRecommended } from '@eslint-community/eslint-plugin-eslint-comments/configs';
import type reactPlugin from '@eslint-react/eslint-plugin';
import type { Linter } from 'eslint';
import { globalIgnores } from 'eslint/config';
import {
  createNodeResolver,
  flatConfigs as importFlatConfigs,
} from 'eslint-plugin-import-x';
import nodePlugin from 'eslint-plugin-n';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import {
  parseJsonConfigFileContent,
  readConfigFile,
  sys as tsSys,
} from 'typescript';

import configPackageJson from '../package.json' with { type: 'json' };

import getVerkstedtConfig from './custom.ts';
import {
  ALL_FILES,
  ALL_JS_FILES,
  ALL_JS_FILES_EXTS,
  CSS_FILES,
  JSON_FILES,
  JSONC_FILES,
  MARKDOWN_FILES,
  MS_JSONC_FILES,
  VANILLA_JS_EXTS,
} from './file-globs.ts';
import type { NoRestrictedImportsConfig } from './types.ts';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

type PromiseOrValue<Type> = Type | Promise<Type>;

type ArrayOrItem<Type> = Type | Array<Type>;

// Not all plugins are typed as {import('@eslint/core').Plugin}
type AnyPlugin =
  | Plugin
  | typeof json
  | typeof css
  | typeof markdown
  | typeof reactPlugin;
type Config = ArrayOrItem<
  Omit<Linter.Config, 'plugins'> & {
    plugins?: Record<string, AnyPlugin>;
  }
>;

interface ModuleConfig {
  /** Name for humans only */
  name: string;
  /** Return EsLint config entry, or null to skip */
  get: (this: ModuleConfig, config: Config) => PromiseOrValue<null | Config>;
}

const includeIgnoreFile = includeIgnoreFileOriginal;

function getColours(stream: WriteStream) {
  if (stream.isTTY || process.env.FORCE_COLOR === '1') {
    return {
      supported: true,
      reset: '\x1B[0m',
      dim: '\x1B[2m',
      error: '\x1B[31m',
    };
  } else {
    return {
      supported: false,
      reset: '',
      dim: '',
      error: '',
    };
  }
}

const NAME = configPackageJson.name;
const DEBUG_ENABLED = debuglog(NAME).enabled;
function debugLog(...args: Parameters<typeof console.debug>) {
  if (DEBUG_ENABLED) {
    const stream = process.stderr;
    const colours = getColours(stream);
    const message = args
      .map((arg) =>
        typeof arg === 'string'
          ? arg
          : inspect(arg, { colors: colours.supported }),
      )
      .join(' ');
    stream.write(
      [colours.dim, 'DEBUG ', NAME, ' ', message, colours.reset, '\n'].join(''),
    );
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function getTsConfigPath(dir: string): Promise<string | null> {
  const tsconfigPath = resolve(dir, 'tsconfig.json');
  if (await fileExists(tsconfigPath)) {
    return tsconfigPath;
  } else {
    return null;
  }
}

function readTsConfig(tsconfigPath: string | null) {
  if (!tsconfigPath) {
    throw new Error('Failed to find tsconfig.json');
  }

  const tsconfigResult = readConfigFile(
    tsconfigPath,
    // eslint-disable-next-line @typescript-eslint/unbound-method -- this is fine
    tsSys.readFile,
  );
  if (tsconfigResult.error) {
    const cause = tsconfigResult.error;
    const errorMessage =
      typeof cause.messageText !== 'string' &&
      'messageText' in cause.messageText
        ? cause.messageText.messageText
        : cause.messageText;
    throw new Error(`Failed to read ${tsconfigPath}: ${errorMessage}`, {
      cause,
    });
  }
  const tsconfig = parseJsonConfigFileContent(
    tsconfigResult.config,
    tsSys,
    dirname(tsconfigPath),
  );

  return tsconfig;
}

function getMissingDepNameFromError(error: unknown) {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    ['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes(error.code)
  ) {
    const match =
      /^Cannot find (?:module|package) '(@[^/']+\/[^/']+|[^/']+)(?:|\/[^']+)'/.exec(
        error.message,
      );
    if (match) {
      return match[1];
    } else {
      throw error;
    }
  } else {
    throw error;
  }
}

interface ProjectFlags {
  usesTypeScript: boolean;
  usesReact: boolean;
  usesNextJs: boolean;
  usesStoryBook: boolean;
  isFrontend: boolean;
}

async function detectProjectFlags(
  deps: Array<string>,
  tsconfigPath: string | null,
): Promise<ProjectFlags> {
  const depsSet = new Set(deps);

  const usesTypeScript =
    depsSet.intersection(new Set(['typescript', 'ts-node', 'jiti'])).size > 0 ||
    deps.some((dep) => /^@types\/.*$/.test(dep)) ||
    (tsconfigPath != null && (await fileExists(tsconfigPath)));
  const usesNextJs = depsSet.has('next');
  const usesReact =
    usesNextJs ||
    depsSet.intersection(new Set(['react', 'react-dom'])).size > 0;
  const usesStoryBook = depsSet.has('storybook');
  const isFrontend =
    usesReact ||
    usesStoryBook ||
    new Set(deps).intersection(new Set(['@11ty/eleventy', 'vite'])).size > 0;

  return { usesTypeScript, usesReact, usesNextJs, usesStoryBook, isFrontend };
}

async function createConfigFromModules(allModuleConfigs: Array<ModuleConfig>) {
  const config: Config = [];

  const missingDeps = new Set<string>();
  for (const moduleConfig of allModuleConfigs) {
    try {
      debugLog('Getting:', moduleConfig.name);
      // eslint-disable-next-line no-await-in-loop -- getters may depend on things added by previous getters
      const configEntry = await moduleConfig.get(config);
      if (configEntry == null) {
        debugLog('Skip:', moduleConfig.name);
      } else if (Array.isArray(configEntry)) {
        config.push(...configEntry);
      } else {
        config.push(configEntry);
      }
    } catch (error: unknown) {
      missingDeps.add(getMissingDepNameFromError(error));
    }
  }

  if (missingDeps.size > 0) {
    const stream = process.stderr;
    const colours = getColours(stream);
    stream.write(
      [
        '',
        `${colours.error}ERROR: Failed to create verkstedt EsLint config, because some dependencies are missing${colours.reset}. Run:`,
        `    npm install --save-dev ${missingDeps
          .values()
          .toArray()
          .join(' ')}`,
        '',
      ].join('\n'),
    );
    process.exit(78); // EX_CONFIG
  }

  return config;
}

interface CreateVerkstedtConfigOptions {
  dir: string;
  allowDefaultProject?: Array<string>;
  noRestrictedImportsConfig?: NoRestrictedImportsConfig;
}

async function createVerkstedtConfig({
  dir,
  allowDefaultProject = [],
  noRestrictedImportsConfig = {},
}: CreateVerkstedtConfigOptions): Promise<Array<Linter.Config>> {
  const startMs = performance.now();

  const packageJsonPath = resolve(dir, 'package.json');
  const gitignorePath = resolve(dir, '.gitignore');

  const config: Array<Config> = [];

  if (gitignorePath && (await fileExists(gitignorePath))) {
    config.push(includeIgnoreFile(gitignorePath, '.gitignore'));
  }

  const packageJson = JSON.parse(
    await fs.readFile(packageJsonPath, 'utf-8'),
  ) as PackageJson;
  const deps = Array.from(
    new Set([
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ]),
  );

  const tsconfigPath = await getTsConfigPath(dir);
  const { usesTypeScript, usesReact, usesNextJs, usesStoryBook, isFrontend } =
    await detectProjectFlags(deps, tsconfigPath);

  debugLog('Uses TypeScript:', usesTypeScript, '; tsconfig at', tsconfigPath);
  debugLog('Uses React:', usesReact);
  debugLog('Uses Next.js:', usesNextJs);
  debugLog('Uses StoryBook:', usesStoryBook);
  debugLog('Is frontend:', isFrontend);

  const allModuleConfigs: Array<ModuleConfig> = [
    {
      name: 'built–in prettier ignore',
      get() {
        return includeIgnoreFile(
          fileURLToPath(
            new URL('../prettier/.prettierignore', import.meta.url),
          ),
          this.name,
        );
      },
    },
    {
      name: 'app prettier ignore',
      async get() {
        const prettierIgnorePath = resolve(dir, '.prettierignore');
        if (await fileExists(prettierIgnorePath)) {
          return includeIgnoreFile(prettierIgnorePath, this.name);
        } else {
          return null;
        }
      },
    },
    {
      name: 'globals',
      get() {
        return {
          files: ALL_JS_FILES,
          languageOptions: {
            ecmaVersion: 'latest',
            globals: {
              ...globals.browser,
              ...globals.node,
            },
          },
        };
      },
    },
    {
      name: 'js',
      get() {
        return {
          ...js.configs.recommended,
          files: ALL_JS_FILES,
        };
      },
    },
    {
      name: 'import',
      async get() {
        const resolver = usesTypeScript
          ? (
              await import('eslint-import-resolver-typescript')
            ).createTypeScriptImportResolver()
          : createNodeResolver();

        return [
          importFlatConfigs.recommended,
          usesTypeScript && importFlatConfigs.typescript,
          usesReact && importFlatConfigs.react,
          {
            settings: {
              'import-x/resolver-next': [resolver],
            },
          },
        ]
          .filter((item) => item !== false)
          .map(({ languageOptions: _languageOptions, ...cfgItem }) => cfgItem);
      },
    },
    {
      name: 'node',
      get() {
        return {
          files: ALL_JS_FILES,
          plugins: { n: nodePlugin },
          rules: {
            // Always use `node:…` for Node.js built-ins
            'n/prefer-node-protocol': 'error',
          },
        };
      },
    },
    {
      name: 'typescript',
      async get() {
        if (!usesTypeScript) {
          return null;
        } else {
          const tsconfig = readTsConfig(tsconfigPath);
          const allowJs = !!(
            tsconfig.options.allowJs ?? tsconfig.options.checkJs
          );

          /*
           * tsconfig usually doesn’t include config files, scripts and
           * such, but we do want them to be checked by EsLint using TS
           * parser. For that we need to add them to
           * allowDefaultProject, _but_ adding files there that are also
           * included in tsconfig causes error, so we need to filter
           * them out.
           */
          const additionalAllowDefaultProject = (
            await Array.fromAsync(
              fs.glob(
                [
                  // List of common file names we’d like to add
                  '*.config',
                  '.storybook/{main,preview}',
                  'scripts/**/*',
                ]
                  // Add all JS/TS file extensions
                  .flatMap((patternStart) =>
                    ALL_JS_FILES_EXTS.map((ext) => `${patternStart}.${ext}`),
                  ),
              ),
            )
          )
            // Note: tsconfig.fileNames are absolute paths
            .filter((filename) => {
              // Skip files included explicitly in tsconfig
              if (tsconfig.fileNames.includes(resolve(dir, filename))) {
                return false;
              }
              // Include vanilla JS files, only if allowJS is falsy
              // (otherwise they can be pulled in to the project if they
              // are imported in included files)
              // Note: We could check if a file is included in the
              // project or not, but for doing so, we’d have to create
              // whole TS project, which is costly.
              if (VANILLA_JS_EXTS.some((ext) => filename.endsWith(`.${ext}`))) {
                return !allowJs;
              }
              // Fall back to not including to be on the safe side
              return false;
            });
          debugLog(
            'Detected files to add to allowDefaultProject:',
            additionalAllowDefaultProject,
          );

          // source: https://typescript-eslint.io/getting-started

          const configs = (await import('typescript-eslint')).default.configs;
          const selectedConfigs = [
            ...configs.strictTypeChecked, // extends recommended
            ...configs.stylisticTypeChecked,
          ].map((cfg) => ({
            ...cfg,
            files: ALL_JS_FILES,
          }));

          return [
            ...selectedConfigs,
            {
              files: ALL_JS_FILES,
              languageOptions: {
                parserOptions: {
                  tsconfigRootDir: dir,
                  projectService: {
                    allowDefaultProject: [
                      ...additionalAllowDefaultProject,
                      ...allowDefaultProject,
                    ],
                  },
                },
              },
            },
          ];
        }
      },
    },
    {
      name: 'react',
      async get() {
        // source: https://eslint-react.xyz/docs/getting-started

        if (!usesReact) {
          return null;
        } else {
          const { default: react } =
            await import('@eslint-react/eslint-plugin');
          const configName = usesTypeScript
            ? 'recommended-type-checked'
            : 'recommended';
          // @eslint-react ships rules that overlap with eslint-plugin-react-hooks
          // (which we still use). Turn off the @eslint-react versions so that
          // existing `react-hooks/...` disable directives keep working.
          const reactHooksConflictRules: Linter.RulesRecord =
            Object.fromEntries(
              Object.keys(
                react.configs['disable-conflict-eslint-plugin-react-hooks']
                  .rules ?? {},
              ).map((rule) => [
                rule.replace(/^react-hooks\//, '@eslint-react/'),
                'off',
              ]),
            );
          return [
            {
              files: ALL_JS_FILES,
              languageOptions: {
                parserOptions: {
                  ecmaFeatures: {
                    jsx: true,
                  },
                },
              },
              settings: {
                react: { version: 'detect' },
              },
            },
            {
              ...react.configs[configName],
              files: ALL_JS_FILES,
            },
            {
              files: ALL_JS_FILES,
              rules: reactHooksConflictRules,
            },
          ];
        }
      },
    },
    {
      name: 'react hooks',
      async get() {
        if (!usesReact) {
          return null;
        } else {
          // source: https://react.dev/reference/eslint-plugin-react-hooks

          return [
            {
              ...(await import('eslint-plugin-react-hooks')).default.configs
                .flat.recommended,
              files: ALL_JS_FILES,
            },
          ];
        }
      },
    },
    {
      name: 'next.js',
      async get() {
        if (!usesNextJs) {
          return null;
        } else {
          // source: https://nextjs.org/docs/app/api-reference/config/eslint#setup-eslint

          const { default: nextPlugin } =
            await import('@next/eslint-plugin-next');
          return [
            {
              ...nextPlugin.configs['core-web-vitals'],
              files: ALL_JS_FILES,
            },
            globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
            // https://github.com/vercel/next.js/blob/canary/packages/eslint-config-next/src/index.ts
            {
              rules: {
                'react/jsx-no-target-blank': 'off',
                'react/no-unknown-property': 'off',
              },
              files: ALL_JS_FILES,
            },
          ];
        }
      },
    },
    {
      name: 'storybook',
      async get() {
        if (!usesStoryBook) {
          return null;
        } else {
          // source: https://storybook.js.org/docs/configure/integration/eslint-plugin#configuration-flat-config-format

          const { default: storybook } =
            await import('eslint-plugin-storybook');

          return [
            // FIXME Casting with `as` should not be necessary
            ...(storybook.configs['flat/recommended'] as Array<Linter.Config>),
          ];
        }
      },
    },
    {
      name: 'lingui',
      async get() {
        if (!deps.some((dep) => dep.startsWith('@lingui/'))) {
          return null;
        } else {
          // source: https://lingui.dev/ref/eslint-plugin

          const { default: lingui } = await import('eslint-plugin-lingui');
          return [lingui.configs['flat/recommended']];
        }
      },
    },
    {
      name: 'json',
      get() {
        return {
          files: JSON_FILES,
          plugins: { json },
          language: 'json/json',
          extends: ['json/recommended'],
        };
      },
    },
    {
      name: 'jsonc',
      get() {
        return {
          files: JSONC_FILES,
          plugins: { json },
          language: 'json/jsonc',
          extends: ['json/recommended'],
        };
      },
    },
    {
      name: 'jsonc with Microsoft extensions',
      get() {
        return {
          files: MS_JSONC_FILES,
          plugins: { json },
          language: 'json/jsonc',
          languageOptions: {
            allowTrailingCommas: true,
          },
          extends: ['json/recommended'],
        };
      },
    },
    {
      name: 'markdown',
      get() {
        return {
          files: MARKDOWN_FILES,
          plugins: { markdown },
          language: 'markdown/gfm',
          extends: ['markdown/recommended'],
        };
      },
    },
    {
      name: 'css',
      get() {
        return {
          files: CSS_FILES,
          plugins: { css },
          language: 'css/css',
          extends: ['css/recommended'],
        };
      },
    },
    {
      name: 'css-modules',
      get() {
        return cssModulesPlugin.configs.recommended;
      },
    },
    {
      name: 'prettier',
      get() {
        return [
          {
            ...prettierRecommended,
            files: ALL_FILES,
          },
          // (Only in some projects) prettier plugin tries to parse
          // markdown files as JavaScript
          {
            files: MARKDOWN_FILES,
            rules: {
              'prettier/prettier': ['error', { parser: 'markdown' }],
            },
          },
        ];
      },
    },
    {
      name: 'eslint-comments',
      get() {
        return {
          ...eslintCommentsRecommended,
          files: ALL_JS_FILES,
        };
      },
    },
    {
      name: 'custom',
      get(configSoFar) {
        // To be able to overwrite @typescript-eslint rules, we need to
        // include @typescript-eslint plugin in this section of the
        // config. We can use its existence as a signal whether project
        // is using TypeScript or not.
        const typescriptEsLintPlugin = !usesTypeScript
          ? undefined
          : (
              configSoFar as unknown as Array<{
                plugins?: Record<string, Plugin>;
              }>
            ).find((cfgItem) => cfgItem.plugins?.['@typescript-eslint'])
              ?.plugins?.['@typescript-eslint'];

        return getVerkstedtConfig({
          typescriptEsLintPlugin,
          noRestrictedImportsConfig,
        });
      },
    },
  ];

  config.push(...(await createConfigFromModules(allModuleConfigs)));

  const durationMs = performance.now() - startMs;
  debugLog('Created ESLint config in', durationMs.toFixed(2), 'ms');

  return config as Array<Linter.Config>;
}

export { createVerkstedtConfig, includeIgnoreFile };
