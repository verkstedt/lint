export interface NoRestrictedImportsConfig {
  paths?: Array<{
    name: string;
    allowImportNames?: Array<string>;
    importNames?: Array<string>;
    message: string;
  }>;
  patterns?: Array<{ group: Array<string>; message: string }>;
}
