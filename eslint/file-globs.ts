const TS_EXTS = ['ts', 'mts'];
export const VANILLA_JS_EXTS = ['js', 'mjs', 'cjs'];
const JS_EXTS = [...VANILLA_JS_EXTS, ...TS_EXTS];

const REACT_TS_EXTS = ['tsx'];
const REACT_JS_EXTS = ['jsx', ...REACT_TS_EXTS];

export const ALL_JS_FILES_EXTS = [...JS_EXTS, ...REACT_JS_EXTS];
export const ALL_JS_FILES = [`**/*.{${ALL_JS_FILES_EXTS.join(',')}}`];

const CSS_EXTS = ['css'];
export const CSS_FILES = [`**/*.css`];

const JSON_EXTS = ['json', 'jsonc'];
export const JSON_FILES = [`**/*.{${JSON_EXTS.join(',')}}`];

export const MS_JSONC_FILES = ['tsconfig.json', '.vscode/**/*.json'];
export const JSONC_FILES = ['**/*.jsonc', ...MS_JSONC_FILES];

const MARKDOWN_EXTS = ['md', 'markdown'];
export const MARKDOWN_FILES = [`**/*.{${MARKDOWN_EXTS.join(',')}}`];

const ALL_FILES_EXTS = [
  ...ALL_JS_FILES_EXTS,
  ...CSS_EXTS,
  ...JSON_EXTS,
  ...MARKDOWN_EXTS,
];
export const ALL_FILES = [`**/*.{${ALL_FILES_EXTS.join(',')}}`];
