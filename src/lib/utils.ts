import path from 'path';
import fs from 'fs';
import os from 'os';

export function uniq (items: (string | number | boolean | null | undefined)[]): string[] {
  return [...new Set(items.filter(Boolean) as (string | number | boolean)[])] as string[];
}

export function normalizeLibraryNames (libName: string): string[] {
  const names = new Set<string>();
  names.add(libName);
  names.add(libName.replace(/^@/, ''));
  names.add(libName.split('/').pop()!);
  names.add(libName.replace(/^@/, '').split('/').pop()!);
  return [...names].filter(Boolean);
}

export function isTestFile (filePath: string): boolean {
  return (
    /(^|[/\\])(__tests__|tests?|specs?)([/\\])/.test(filePath) ||
    /\.(test|spec)\.(js|jsx|ts|tsx|mjs|cjs)$/i.test(filePath)
  );
}

export function safeReadFile (filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

export function getCacheDir (): string {
  const homeDir = os.homedir();
  const cacheDir = path.join(homeDir, '.sbomtest', 'repos');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  }
  return cacheDir;
}
