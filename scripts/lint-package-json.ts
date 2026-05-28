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

interface PackageJson {
  peerDependencies?: Record<PackageName, PackageVersionSpec>;
  peerDependenciesMeta?: Record<
    PackageName,
    { optional: boolean; note?: string }
  >;
  devDependencies?: Record<PackageName, PackageVersionSpec>;
  dependencies?: Record<PackageName, PackageVersionSpec>;
}

const options: ParseArgsOptionsWithDescription = {};

async function readPackageJson() {
  const packageJsonPath = new URL(
    'package.json',
    pathToFileURL(import.meta.dirname),
  ).pathname;
  const packageJsonContent = await readFile(packageJsonPath, 'utf-8');
  return JSON.parse(packageJsonContent) as PackageJson;
}

function checkInstalledMatchesPeer(
  dep: string,
  depType: string,
  version: string,
  peerVersion: string,
  isBoundedPeer: boolean,
): Array<string> {
  if (isBoundedPeer) {
    if (version !== peerVersion) {
      return [
        `Version mismatch for "${dep}": peer "${peerVersion}", ${depType} "${version}". Bounded peers must match exactly.`,
      ];
    }
    return [];
  }
  if (!version.startsWith('^')) {
    return [
      `${depType} dependency "${dep}" should use '^' version specifier, found "${version}".`,
    ];
  }
  if (version.replace('^', '') !== peerVersion.replace('>=', '')) {
    return [
      `Version mismatch for "${dep}": peer "${peerVersion}", ${depType} "${version}".`,
    ];
  }
  return [];
}

function checkPeerSpec(
  dep: string,
  peerVersion: string,
  devDeps: Record<string, string>,
  prodDeps: Record<string, string>,
): Array<string> {
  const errors: Array<string> = [];
  const isBoundedPeer = /^\^.+ <.+/.test(peerVersion);
  if (!peerVersion.startsWith('>=') && !isBoundedPeer) {
    errors.push(
      `Peer dependency "${dep}" should use '>=' or '^X <Y' version specifier, found "${peerVersion}".`,
    );
  }

  const versionsEntries = [
    ['dev', devDeps[dep]],
    ['production', prodDeps[dep]],
  ].filter(([, version]) => version);
  if (versionsEntries.length === 0) {
    errors.push(
      `Peer dependency "${dep}" expected to be also listed in devDependencies or dependencies, but was not found.`,
    );
    return errors;
  }
  for (const [depType, version] of versionsEntries) {
    errors.push(
      ...checkInstalledMatchesPeer(
        dep,
        depType,
        version,
        peerVersion,
        isBoundedPeer,
      ),
    );
  }
  return errors;
}

function lintPeerDependencies(packageJson: PackageJson) {
  // Check if all peerDependencies are listed in devDependencies with
  // the same version
  const peerDeps = packageJson.peerDependencies ?? {};
  const peerDepsMeta = packageJson.peerDependenciesMeta ?? {};
  const devDeps = packageJson.devDependencies ?? {};
  const prodDeps = packageJson.dependencies ?? {};
  const errors: Array<string> = [];

  for (const [dep, peerVersion] of Object.entries(peerDeps)) {
    errors.push(...checkPeerSpec(dep, peerVersion, devDeps, prodDeps));

    if (!(dep in peerDepsMeta)) {
      errors.push(
        `Peer dependency "${dep}" is missing in peerDependenciesMeta.`,
      );
    }
  }

  for (const [metaDep, meta] of Object.entries(peerDepsMeta)) {
    if (!(metaDep in peerDeps)) {
      errors.push(
        `peerDependenciesMeta entry "${metaDep}" is not listed in peerDependencies.`,
      );
    }

    if (meta.optional && !meta.note) {
      errors.push(
        `peerDependenciesMeta entry "${metaDep}" is marked as optional but is missing a note explaining when it should be included.`,
      );
    }
  }

  if (errors.length) {
    for (const error of errors) {
      process.stderr.write(`- ${error}\n`);
    }
  }

  return errors.length === 0;
}

async function main() {
  parseArgs({
    description: 'Check if things in package.json are in sync.',
    invocation: 'npm run lint:pkg',
    options,
    allowPositionals: false,
  });

  let hasErrors = false;

  const packageJson = await readPackageJson();
  hasErrors ||= !lintPeerDependencies(packageJson);

  if (hasErrors) {
    process.exit(1);
  } else {
    process.stdout.write(`${ansi.bold}package.json looks fine${ansi.reset}\n`);
    process.exit(0);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${inspect(error)}\n`);
  process.exit(1);
});
