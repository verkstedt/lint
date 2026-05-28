function isTruthyEnvVar(value: string | undefined): boolean {
  return ['1', 'true', 'yes'].includes((value ?? '').toLowerCase());
}

function shouldUseColours(): boolean {
  if (isTruthyEnvVar(process.env.FORCE_COLOR)) {
    return true;
  } else if (isTruthyEnvVar(process.env.NO_COLOR)) {
    return false;
  } else {
    return process.stdout.isTTY && process.stderr.isTTY;
  }
}

export const ansi = shouldUseColours()
  ? {
      reset: '\u001b[0m',
      bold: '\u001b[1m',
      dim: '\u001b[2m',
    }
  : {
      reset: '',
      bold: '',
      dim: '',
    };
