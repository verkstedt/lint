import type { Config } from 'prettier';

const config: Config = {
  // Use single quotes (') instead of double ones (") by default
  // To avoid having to reach for Shift
  singleQuote: true,
  // Add trailing commas
  // To make diffing easier when lines are added or removed
  trailingComma: 'all',
  // If one prop needs quotes, quote all
  // To make things easier to scan, especially since quoted and unquoted
  // props can be highlighted differently in some editors
  quoteProps: 'consistent',
};

export default config;
