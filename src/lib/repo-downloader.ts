import fs from 'fs';
import path from 'path';

import crypto from 'crypto';
import { spawn } from 'child_process';
import { getCacheDir } from './utils';

interface DownloadOptions {
  baseDir?: string;
}

interface DownloadResult {
  success: boolean;
  path: string | null;
  repo?: string;
  identifier?: string;
  cached?: boolean;
  reason?: string;
}

interface ShResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export function hash(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
}

export function getRepoIdentifier(gitUrl: string): string {
  const match = gitUrl.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?(?:\/|$)/);
  return match ? match[1] : gitUrl;
}

interface ParsedRepo {
  gitUrl: string;
  ref: string | null;
}

export function parseRepoUrl(repoUrl: string, version?: string): ParsedRepo | null {
  if (!repoUrl) {
    return null;
  }
  let gitUrl = repoUrl;
  const ref = version ? `v${version}` : null;
  const hashMatch = repoUrl.match(/^(.+?)(?:#(.+))?$/);
  if (hashMatch) {
    gitUrl = hashMatch[1];
  }
  if (gitUrl.includes('github.com')) {
    const match = gitUrl.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?(?:\/|$)/);
    if (match) {
      gitUrl = `https://github.com/${match[1]}.git`;
    }
  }
  return { gitUrl, ref };
}

export function shWithTimeout(cmd: string, args: string[], timeout: number = 120000): Promise<ShResult> {
  return new Promise((resolve) => {
    let completed = false;
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    child.on('close', (code: number) => {
      if (completed) {
        return;
      }
      completed = true;
      resolve({ success: code === 0, stdout, stderr });
    });
    child.on('error', (err: Error) => {
      if (completed) {
        return;
      }
      completed = true;
      resolve({ success: false, error: err.message });
    });
    setTimeout(() => {
      if (!completed) {
        child.kill('SIGKILL');
        completed = true;
        resolve({ success: false, error: `Timeout after ${timeout}ms` });
      }
    }, timeout);
  });
}

export async function cloneRepo(gitUrl: string, ref: string | null, destDir: string): Promise<boolean> {
  const cloneArgs = ['clone', '--depth', '1'];
  if (ref) {
    cloneArgs.push('--branch', ref);
  }
  cloneArgs.push(gitUrl, destDir);
  let result = await shWithTimeout('git', cloneArgs, 120000);
  if (result.success) {
    return true;
  }
  result = await shWithTimeout('git', ['clone', '--depth', '1', gitUrl, destDir], 120000);
  return result.success;
}

interface Component {
  name: string;
  version?: string;
  repo_url: string | null;
}

interface DownloadReposReturn {
  results: Record<string, DownloadResult>;
  downloadRoot: string;
}

export async function downloadRepos(components: Component[], options: DownloadOptions = {}): Promise<DownloadReposReturn> {
  const results: Record<string, DownloadResult> = {};
  const downloadRoot = options.baseDir || getCacheDir();
  let successCount = 0;
  let skippedCount = 0;
  let failCount = 0;
  for (const component of components) {
    const { name, version, repo_url } = component;
    if (!repo_url) {
      results[name] = { success: false, path: null, reason: 'no_repo_url' };
      failCount++;
      continue;
    }
    const parsed = parseRepoUrl(repo_url, version);
    if (!parsed) {
      results[name] = { success: false, path: null, reason: 'invalid_repo_url' };
      failCount++;
      continue;
    }
    const { gitUrl, ref } = parsed;
    const destDir = path.join(downloadRoot, `${hash(name)}-${name.replace(/[\\/]/g, '_')}`);
    if (fs.existsSync(destDir)) {
      skippedCount++;
      results[name] = { success: true, path: destDir, repo: gitUrl, identifier: getRepoIdentifier(gitUrl), cached: true };
      continue;
    }
    const success = await cloneRepo(gitUrl, ref, destDir);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
    results[name] = { success, path: success ? destDir : null, repo: gitUrl, identifier: getRepoIdentifier(gitUrl) };
  }
  console.log(`Summary: ${successCount} new, ${skippedCount} cached, ${failCount} failed.`);
  return { results, downloadRoot };
}
