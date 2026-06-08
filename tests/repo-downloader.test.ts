import fs from 'fs';
import path from 'path';

const actualChildProcess = await import('child_process');
const actualUtils = await import('../src/lib/utils');

const mockSpawn = mock();
const childProcessMock = { ...actualChildProcess, spawn: mockSpawn };
mock.module('child_process', () => ({ ...childProcessMock, default: childProcessMock }));

const mockGetCacheDir = mock();
mock.module('../src/lib/utils', () => ({
  ...actualUtils,
  getCacheDir: mockGetCacheDir,
}));

const { downloadRepos, parseRepoUrl } = await import('../src/lib/repo-downloader');

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';

describe('Repo Downloader Module', () => {
  const testDir = path.join(__dirname, 'fixtures', 'test-repos');

  beforeEach(() => {
    mockSpawn.mockClear();
    mockGetCacheDir.mockClear();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
    mockGetCacheDir.mockReturnValue(testDir);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('parseRepoUrl', () => {
    it('should parse GitHub HTTPS URL', () => {
      const result = parseRepoUrl('https://github.com/user/repo');
      expect(result).toEqual({
        gitUrl: 'https://github.com/user/repo.git',
        ref: null
      });
    });

    it('should parse GitHub SSH URL', () => {
      const result = parseRepoUrl('git@github.com:user/repo.git');
      expect(result).toEqual({
        gitUrl: 'https://github.com/user/repo.git',
        ref: null
      });
    });

    it('should parse GitHub URL with version', () => {
      const result = parseRepoUrl('https://github.com/user/repo', '1.0.0');
      expect(result).toEqual({
        gitUrl: 'https://github.com/user/repo.git',
        ref: 'v1.0.0'
      });
    });

    it('should handle URL with hash ref', () => {
      const result = parseRepoUrl('https://github.com/user/repo#main');
      expect(result).toEqual({
        gitUrl: 'https://github.com/user/repo.git',
        ref: null
      });
    });

    it('should handle GitHub URL without .git extension', () => {
      const result = parseRepoUrl('github.com/user/repo');
      expect(result).toEqual({
        gitUrl: 'https://github.com/user/repo.git',
        ref: null
      });
    });

    it('should handle empty URL', () => {
      const result = parseRepoUrl('');
      expect(result).toBeNull();
    });

    it('should handle undefined URL', () => {
      const result = parseRepoUrl(undefined as unknown as string);
      expect(result).toBeNull();
    });
  });

  describe('downloadRepos', () => {
    beforeEach(() => {
      mockSpawn.mockImplementation(() => {
        const mockOn = mock((event: string, cb: (code: number) => void) => {
          if (event === 'close') { process.nextTick(() => cb(0)); }
        });
        const mockChild = {
          stdout: { on: mock() },
          stderr: { on: mock() },
          on: mockOn
        };
        return mockChild;
      });
    });

    it('should handle component without repo_url', async () => {
      const components = [
        { name: 'package1', version: '1.0.0', repo_url: null as unknown as string }
      ];

      const { results } = await downloadRepos(components, { baseDir: testDir });

      expect(results.package1).toEqual({
        success: false,
        path: null,
        reason: 'no_repo_url'
      });
    });

    it('should handle invalid repo URL', async () => {
      const components = [
        { name: 'package1', version: '1.0.0', repo_url: '' }
      ];

      const { results } = await downloadRepos(components, { baseDir: testDir });

      expect(results.package1).toEqual({
        success: false,
        path: null,
        reason: 'no_repo_url'
      });
    });

    it('should use cached directory if exists', async () => {
      const cachePath = path.join(testDir, '582681c2ea-package');
      fs.mkdirSync(cachePath, { recursive: true });

      const components = [
        { name: 'package', version: '1.0.0', repo_url: 'https://github.com/user/repo' }
      ];

      const { results } = await downloadRepos(components, { baseDir: testDir });

      expect(results.package.success).toBe(true);
      expect(results.package.path).toBe(cachePath);
      expect(results.package.repo).toBe('https://github.com/user/repo.git');
      expect(results.package.identifier).toBe('user/repo');
      expect(results.package.cached).toBe(true);
    });

    it('should clone repository if not cached', async () => {
      const components = [
        { name: 'package', version: '1.0.0', repo_url: 'https://github.com/user/repo' }
      ];

      const { results } = await downloadRepos(components, { baseDir: testDir });

      expect(results.package.success).toBe(true);
      expect(results.package.path).toBeTruthy();
      expect(results.package.cached).toBeFalsy();
    });

    it('should handle clone failure', async () => {
      mockSpawn.mockImplementation(() => {
        const mockOn = mock((event: string, cb: (code: number) => void) => {
          if (event === 'close') { process.nextTick(() => cb(1)); }
        });
        const mockChild = {
          stdout: { on: mock() },
          stderr: { on: mock() },
          on: mockOn
        };
        return mockChild;
      });

      const components = [
        { name: 'package', version: '1.0.0', repo_url: 'https://github.com/user/repo' }
      ];

      const { results } = await downloadRepos(components, { baseDir: testDir });

      expect(results.package.success).toBe(false);
      expect(results.package.path).toBeNull();
    });

    it('should handle clone error', async () => {
      mockSpawn.mockImplementation(() => {
        const mockOn = mock((event: string, cb: (err: Error) => void) => {
          if (event === 'error') { process.nextTick(() => cb(new Error('Clone failed'))); }
        });
        const mockChild = {
          stdout: { on: mock() },
          stderr: { on: mock() },
          on: mockOn
        };
        return mockChild;
      });

      const components = [
        { name: 'package', version: '1.0.0', repo_url: 'https://github.com/user/repo' }
      ];

      const { results } = await downloadRepos(components, { baseDir: testDir });

      expect(results.package.success).toBe(false);
    });

    it('should retry clone without ref on failure', async () => {
      let callCount = 0;
      mockSpawn.mockImplementation(() => {
        const mockOn = mock((event: string, cb: (code: number) => void) => {
          if (event === 'close') {
            callCount++;
            process.nextTick(() => cb(callCount === 1 ? 1 : 0));
          }
        });
        const mockChild = {
          stdout: { on: mock() },
          stderr: { on: mock() },
          on: mockOn
        };
        return mockChild;
      });

      const components = [
        { name: 'package', version: '1.0.0', repo_url: 'https://github.com/user/repo' }
      ];

      const { results } = await downloadRepos(components, { baseDir: testDir });

      expect(mockSpawn).toHaveBeenCalledTimes(2);
      expect(results.package.success).toBe(true);
    });

    it('should process multiple components', async () => {
      const components = [
        { name: 'pkg1', version: '1.0.0', repo_url: 'https://github.com/user/repo1' },
        { name: 'pkg2', version: '2.0.0', repo_url: 'https://github.com/user/repo2' },
        { name: 'pkg3', version: '3.0.0', repo_url: null as unknown as string }
      ];

      const { results } = await downloadRepos(components, { baseDir: testDir });

      expect(Object.keys(results).length).toBe(3);
      expect(results.pkg1.success).toBe(true);
      expect(results.pkg2.success).toBe(true);
      expect(results.pkg3.success).toBe(false);
    });

    it('should log summary', async () => {
      const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});

      const components = [
        { name: 'pkg1', version: '1.0.0', repo_url: 'https://github.com/user/repo1' }
      ];

      await downloadRepos(components, { baseDir: testDir });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Summary:'));
      consoleSpy.mockRestore();
    });

    it('should handle special characters in package name', async () => {
      const components = [
        { name: '@scope/package-name', version: '1.0.0', repo_url: 'https://github.com/user/repo' }
      ];

      const { results } = await downloadRepos(components, { baseDir: testDir });

      expect(results['@scope/package-name'].success).toBe(true);
    });
  });
});
