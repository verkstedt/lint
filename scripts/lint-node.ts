#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { inspect } from 'node:util';

import { ansi } from './utils/ansi.ts';
import parseArgs, {
  type ParseArgsOptionsWithDescription,
} from './utils/parseArgs.ts';

type PackageName = string;
type PackageVersionSpec = string;
type NodeVersionSpec = string;

interface PackageJson {
  engines?: {
    node?: NodeVersionSpec;
  };
  devDependencies?: Record<PackageName, PackageVersionSpec>;
}

const options: ParseArgsOptionsWithDescription = {};

async function readFileRel(filePathRel: string): Promise<string> {
  const filePath = new URL(filePathRel, pathToFileURL(import.meta.dirname))
    .pathname;
  return readFile(filePath, 'utf-8');
}

async function readPackageJson() {
  const packageJsonContent = await readFileRel('package.json');
  return JSON.parse(packageJsonContent) as PackageJson;
}

function lintNodeVersions(nvmrc: string, packageJson: PackageJson): boolean {
  const pkgVersion = packageJson.engines?.node?.trim();
  const nvmrcVersion = nvmrc.trim();
  const pkgTypesVersion = packageJson.devDependencies?.['@types/node']?.trim();
  const errors: Array<string> = [];

  if (!nvmrcVersion) {
    errors.push('Missing .nvmrc file');
  } else if (!/^[0-9]+(?:\.[0-9]+){2}$/.test(nvmrcVersion)) {
    errors.push(
      `.nvmrc file must contain a specific version (e.g. "16.14.0"), got "${nvmrcVersion}"`,
    );
  }

  if (!pkgVersion) {
    errors.push('Missing "engines.node" field in package.json');
  } else if (nvmrcVersion && pkgVersion !== `>=${nvmrcVersion}`) {
    errors.push(
      `"engines.node" field in package.json must match .nvmrc version. Expected ">=${nvmrcVersion}", got "${pkgVersion}"`,
    );
  }

  if (!pkgTypesVersion) {
    errors.push('Missing "@types/node" devDependency in package.json');
  } else if (pkgVersion) {
    const pkgVersionMatch = /^>=([0-9]+)((?:\.[0-9]+){2})$/.exec(pkgVersion);
    if (!pkgVersionMatch) {
      errors.push(
        `Cannot parse major version from "engines.node" field: "${pkgVersion}"`,
      );
    } else {
      const [, pkgVersionMajor, pkgVersionRest] = pkgVersionMatch;
      // @types/node should match the version of Node.js being used, but
      // not all releases change API and for these versions new version of
      // @types/node is not released. Therefore we cannot use exact match.
      const expectedTypesVersion = `^${pkgVersionMajor} <=${pkgVersionMajor}${pkgVersionRest}`;
      if (pkgTypesVersion !== expectedTypesVersion) {
        errors.push(
          `@types/node version mismatch: for Node.js version "${pkgVersion}", expected "@types/node" version "${expectedTypesVersion}", but got "${pkgTypesVersion}"`,
        );
      }
    }
  }

  if (errors.length > 0) {
    process.stderr.write(
      `${ansi.bold}Found issues with Node.js version specifications:${ansi.reset}\n`,
    );
    for (const error of errors) {
      process.stderr.write(`- ${error}\n`);
    }
  }

  return errors.length === 0;
}

async function main() {
  parseArgs({
    description: 'Check if Node.js versions specs are in sync.',
    invocation: 'npm run lint:node',
    options,
    allowPositionals: false,
  });

  let hasErrors = false;

  const packageJson = await readPackageJson();
  const nvmrc = await readFileRel('.nvmrc');
  hasErrors ||= !lintNodeVersions(nvmrc, packageJson);

  if (hasErrors) {
    process.exit(1);
  } else {
    process.stdout.write(
      `${ansi.bold}Node.js version set up correctly${ansi.reset}\n`,
    );
    process.exit(0);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${inspect(error)}\n`);
  process.exit(1);
});
