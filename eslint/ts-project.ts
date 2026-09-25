import { dirname, matchesGlob, relative, sep } from 'node:path';

import { parseTsconfig } from 'get-tsconfig';

/**
 * Directories that TypeScript never picks up through `include` globs.
 */
const IMPLICIT_EXCLUDES = ['node_modules', 'bower_components', 'jspm_packages'];

const WILDCARD_REGEX = /[*?]/;
const TRAILING_SLASHES_REGEX = /[\\/]+$/;
const PATH_SEPARATOR_REGEX = /[\\/]/;
const HAS_EXTENSION_REGEX = /^[^.].*\./;
const LEADING_DOT_SLASH_REGEX = /^\.\//;
const JS_EXTENSION_REGEX = /\.(?:[cm]?js|jsx)$/;

/**
 * What TypeScript would make of a tsconfig: which files belong to the
 * project.
 */
export interface TsProject {
  /** Whether the project includes JavaScript files (`allowJs` or `checkJs`) */
  includesJs: boolean;
  /**
   * Tells whether TypeScript would include the given file in the
   * project, based on `files`, `include` and `exclude` of the tsconfig.
   *
   * This only looks at the tsconfig, not at files pulled in through
   * imports.
   */
  isFileIncluded(absolutePath: string): boolean;
}

/**
 * Turns a tsconfig `include` entry into a glob. A bare directory name
 * (no wildcards, no extension) means everything under that directory.
 */
function includePatternToGlob(pattern: string): string {
  const trimmed = pattern.replace(TRAILING_SLASHES_REGEX, '');
  const lastSegment = trimmed.split(PATH_SEPARATOR_REGEX).at(-1) ?? '';
  const hasExtension = HAS_EXTENSION_REGEX.test(lastSegment);
  if (!WILDCARD_REGEX.test(lastSegment) && !hasExtension) {
    return `${trimmed}/**/*`;
  }
  return trimmed;
}

/**
 * Tells whether the given tsconfig `exclude` entry matches the file or
 * any of its parent directories.
 */
function isExcludedBy(pattern: string, relativePath: string): boolean {
  const trimmed = pattern.replace(TRAILING_SLASHES_REGEX, '');
  if (matchesGlob(relativePath, trimmed)) {
    return true;
  }
  const segments = relativePath.split(sep);
  for (let i = 1; i < segments.length; i++) {
    if (matchesGlob(segments.slice(0, i).join(sep), trimmed)) {
      return true;
    }
  }
  return false;
}

export default function readTsProject(tsconfigPath: string | null): TsProject {
  if (!tsconfigPath) {
    throw new Error('Failed to find tsconfig.json');
  }

  const config = parseTsconfig(tsconfigPath);
  const configDir = dirname(tsconfigPath);
  const options = config.compilerOptions ?? {};
  const includesJs = !!(options.allowJs ?? options.checkJs);

  const files = (config.files ?? []).map((file) =>
    file.replace(LEADING_DOT_SLASH_REGEX, ''),
  );
  const includes = (
    config.include ??
    // With explicit `files` and no `include`, nothing else is included
    (config.files ? [] : ['**/*'])
  ).map(includePatternToGlob);
  const excludes = [
    ...(config.exclude ?? IMPLICIT_EXCLUDES),
    ...(options.outDir ? [options.outDir] : []),
  ];

  function isFileIncluded(absolutePath: string): boolean {
    const relativePath = relative(configDir, absolutePath);
    if (relativePath.startsWith('..')) {
      return false;
    }
    if (files.includes(relativePath)) {
      return true;
    }
    if (!includesJs && JS_EXTENSION_REGEX.test(relativePath)) {
      return false;
    }
    if (
      relativePath
        .split(sep)
        .some((segment) => IMPLICIT_EXCLUDES.includes(segment))
    ) {
      return false;
    }
    if (excludes.some((pattern) => isExcludedBy(pattern, relativePath))) {
      return false;
    }
    return includes.some((pattern) => matchesGlob(relativePath, pattern));
  }

  return { includesJs, isFileIncluded };
}
