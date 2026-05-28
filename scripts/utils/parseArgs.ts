import { parseArgs } from 'node:util';
import type { ParseArgsConfig, ParseArgsOptionsConfig } from 'node:util';

import { ansi } from './ansi.ts';

export type ParseArgsOptionsWithDescription = Record<
  string,
  ParseArgsOptionsConfig[string] & {
    description: string;
  }
>;

interface ParseCliArgsConfig extends ParseArgsConfig {
  description: string;
  invocation: string;
  options: ParseArgsOptionsWithDescription;
}

function printHelp({ description, invocation, options }: ParseCliArgsConfig) {
  interface Opt {
    flags: string;
    description: string;
  }
  const opts: Array<Opt> = Object.entries(options).map(([name, opt]) => {
    const flags = [`--${name}`, opt.short ? `-${opt.short}` : null]
      .filter(Boolean)
      .join(', ');
    return { flags, description: opt.description };
  });
  const maxFlagLength = Math.max(0, ...opts.map((opt) => opt.flags.length));

  process.stdout.write(
    [
      `${ansi.bold}${description}${ansi.reset}`,
      '',
      `${ansi.bold}Usage:${ansi.reset} ${invocation} ${ansi.dim}[OPTIONS]${ansi.reset}`,
      '',
      `${ansi.bold}Options:${ansi.reset}`,
      ...opts.map(
        (opt) => `  ${opt.flags.padEnd(maxFlagLength)}  ${opt.description}`,
      ),
      '',
    ].join('\n'),
  );
}

function parseCliArgs(config: ParseCliArgsConfig) {
  const { description: _d, invocation: _i, ...parseArgsConfig } = config;
  const options = structuredClone(parseArgsConfig.options);

  if (!('help' in options)) {
    options.help = {
      type: 'boolean',
      short: 'h',
      description: 'Show help',
    };
  }

  const result = parseArgs({
    ...parseArgsConfig,
    options,
  });

  if (result.values.help) {
    printHelp(config);
    process.exit(0);
  }

  return result;
}

export default parseCliArgs;
