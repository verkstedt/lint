# 11.1.0

## Minor

- Dependencies update, minimum Node.js version upped to 24.22.0: #98, #116, #120
- Compatibility with both TypeScript 7 (keeping compat with TS6): #109, #110
- `@e18e/eslint-plugin` may ask you to migrate from some npm packages to better maintained and/or more performant alternatives. See <https://e18e.dev>: #107

## Patch

- `allowDefaultProject` globs now resolve relative to config file path, not root repo: #121
- Security updates: #91, #92, #93, #94, #95, #98, #101, #102, #103, #104, #105, #106, #117, #118
- More tolerant CSS parsing: #100
- Recognise `wrangler.jsonc` as JSONC: #99
- Prettier–ignore BMAD skills: #97; and common git worktree locations

# 11.0.0

- Complete rewrite using EsLint 10 and new config format.
- Drop airbnb base config.
- Detect config parts to use automatically.
