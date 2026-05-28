# `@verkstedt/lint`

Linting configuration for verkstedt projects

## Links

- [🔍 Packages using this](https://github.com/search?q=path:**/package.json+%22@verkstedt/lint%22+NOT+is:archived)

<details>
<summary>verkstedt internal</summary>

- [🗪 Chat](https://app.slack.com/client/T6HMM3NG2/C8U48QUBA)
- [🗒 Tasks](https://verkstedt.atlassian.net/jira/software/projects/VIP/boards/12?jql=labels%20%3D%20lint)

</details>

## Technical design

See [DESIGN.md](./DESIGN.md).

## Installation

<a id=user-content-install-automatic></a>

### Automatic

```sh
npx @verkstedt/lint@latest .
```

<a id=user-content-install-manual></a>

### Manual

<details>

1. Install:

   ```sh
   npm install --save-dev eslint prettier @verkstedt/lint
   ```

   If you are using TypeScript, also:

   ```sh
   npm install --save-dev jiti
   ```

2. Make your `tsconfig.json` extend ours:

   ```json
   {
     "$schema": "https://json.schemastore.org/tsconfig",
     "extends": "@verkstedt/lint/tsconfig",
   ```

3. Create `prettier.config.ts` (or `prettier.config.mjs`)

   <!-- PRETTIER_CONFIG -- Marker used for extracting code by install.sh -->

   ```mjs
   export { default as default } from '@verkstedt/lint/prettier';
   ```

   …and an empty `.prettierignore`:

   ```sh
   touch .prettierignore
   ```

   > [!NOTE]
   > EsLint is set up to also use Prettier, so you don’t have to run it
   > separately, but you can, if you e.g. want to do just the
   > formatting in your editor.

4. Create `eslint.config.ts` (or `eslint.config.mjs`)

   <!-- ESLINT_CONFIG -- Marker used for extracting code by install.sh -->

   ```mjs
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
   ```

</details>

<a id=user-content-install-migrate-from-eslint-config-verkstedt></a>

#### Migration from `@verkstedt/eslint-config-verkstedt`

<details>

1. Remove all `*eslint*`, `*prettier*` and `*stylelint*` packages you
   have installed and remove old Prettier and EsLint config files.

2. Commit as something like “chore: Remove old linting config”.

3. Run the script from [Automatic](#user-content-install-automatic)
   installation above.

4. Commit.

5. Run `eslint --fix`

6. Commit.

7. Fix any remaining linting errors and commit.

8. Check if you need to restore any of customisation you had in your old
   config files (they may be included in new config files!). Consider
   not adding things back to keep config consistent across projects.

> [!NOTE]
> In some codebases, you may get a lot of errors from
> `@typescript-eslint/no-explicit-any` and
> `@typescript-eslint/no-unsafe-*` rules. Best approach is to
> temporarily disable them and merge new config like that, but plan to
> refactor the codebase to enable them back.

</details>

### First run

```sh
npx eslint .
```

Running this for the first time might ask you to install some additional
packages.

## Tests

Tests are organised as separate packages. They are set up as [npm workspaces].
Running `npm test` will run `eslint` in all workspace test
packages.

[npm workspaces]: https://docs.npmjs.com/cli/v8/using-npm/workspaces

## Debugging

Run with `NODE_DEBUG=@verkstedt/lint` to see some debug logs.

## Known caveats

- No accessibility (`jsx-a11y`) rules for now. `eslint-plugin-jsx-a11y`
  has not yet shipped ESLint 10 support; the upstream PR is open at
  <https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/pull/1081>.
  Once that lands we will apply its `recommended` config whenever
  `isFrontend` is true. Also remove uninstalling the plugin in
  `install.sh`.

- Installation script overwrites `extends` in `tsconfig.json`.
  If your project already extends something you should copy options from
  [`./typescript/tsconfig.base.json`](./typescript/tsconfig.base.json)
  to your `tsconfig` and keep your `extends` as it is.

- TypeScript is pinned to `^6.0.3 <6.1.0` (in both `peerDependencies`
  and `devDependencies`). This may look surprising, but `typescript-eslint`
  caps its `typescript` peer at `<6.1.0`, so we mirror that range here to
  keep `npm install` resolving cleanly. Once a `typescript-eslint` release
  widens the cap, we can match it.

## License

[ISC](./LICENSE)
