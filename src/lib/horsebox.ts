import { execFileSync, ExecFileSyncOptions } from 'child_process';

interface HorseboxHit {
  path?: string;
  file?: string;
  source?: string;
  name?: string;
}

interface SearchOptions {
  encoding?: BufferEncoding;
  stdio?: ExecFileSyncOptions['stdio'];
}

function ensureHorsebox(): void {
  try {
    execFileSync('hb', ['--help'], { stdio: 'ignore' });
  } catch {
    throw new Error('Horsebox not found. Install it and ensure `hb` is in PATH.');
  }
}

function runHb(args: string[], options: SearchOptions = {}): string {
  const { encoding, stdio } = options;
  return execFileSync('hb', args, {
    encoding: encoding ?? 'utf8',
    stdio: stdio ?? ['ignore', 'pipe', 'pipe'],
  });
}

function buildFileContentIndex(fromDir: string, indexDir: string): void {
  runHb([
    'build',
    '--from', fromDir,
    '--index', indexDir,
    '--using', 'filecontent',
  ]);
}

function buildFileLineIndex(fromDir: string, indexDir: string): void {
  runHb([
    'build',
    '--from', fromDir,
    '--index', indexDir,
    '--using', 'fileline',
  ]);
}

const searchCache: Map<string, HorseboxHit[]> = new Map();

function searchIndex(indexDir: string, query: string | null, limit: number = 30): HorseboxHit[] {
  if (!query || !query.trim()) {
    return [];
  }

  const cacheKey = `${indexDir}:${query}:${limit}`;

  if (searchCache.has(cacheKey)) {
    return searchCache.get(cacheKey)!;
  }

  const stdout = runHb([
    'search',
    '--index', indexDir,
    '--query', query,
    '--json',
    '--limit', String(limit),
  ]);

  const parsed: unknown = JSON.parse(stdout);

  let results: HorseboxHit[] = [];

  if (Array.isArray(parsed)) {
    results = parsed;
  } else if (Array.isArray((parsed as Record<string, unknown>).hits)) {
    results = (parsed as Record<string, unknown>).hits as HorseboxHit[];
  }

  searchCache.set(cacheKey, results);

  return results;
}

function clearSearchCache(): void {
  searchCache.clear();
}

export {
  ensureHorsebox,
  buildFileContentIndex,
  buildFileLineIndex,
  searchIndex,
  clearSearchCache,
};

export type { HorseboxHit, SearchOptions };
