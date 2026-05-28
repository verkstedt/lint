declare module '@bhollis/eslint-plugin-css-modules' {
  import type { Linter } from 'eslint';

  const plugin: {
    configs: {
      recommended: Linter.Config;
    };
  };
  export default plugin;
}
