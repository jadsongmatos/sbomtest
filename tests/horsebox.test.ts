import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

let horseboxAvailable = false;
try {
  execSync('hb --help', { stdio: 'ignore' });
  horseboxAvailable = true;
} catch {
  // Horsebox not available
}

const actualChildProcess = await import('child_process');
const realExecFileSync = actualChildProcess.execFileSync;
const execFileSyncMock = mock(() => '');

const childProcessMock = {
  ...actualChildProcess,
  execFileSync: execFileSyncMock,
};
mock.module('child_process', () => ({ ...childProcessMock, default: childProcessMock }));

const { clearSearchCache } = await import('../src/lib/horsebox');

describe('Horsebox Module', () => {
  const testIndexDir = path.join(__dirname, 'fixtures', 'test-index');
  const testSourceDir = path.join(__dirname, 'fixtures', 'test-source');

  beforeEach(() => {
    clearSearchCache();
    if (fs.existsSync(testIndexDir)) {
      fs.rmSync(testIndexDir, { recursive: true, force: true });
    }
    if (fs.existsSync(testSourceDir)) {
      fs.rmSync(testSourceDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testSourceDir, { recursive: true });
    execFileSyncMock.mockClear();
    execFileSyncMock.mockReturnValue('');
  });

  afterEach(() => {
    if (fs.existsSync(testIndexDir)) {
      fs.rmSync(testIndexDir, { recursive: true, force: true });
    }
    if (fs.existsSync(testSourceDir)) {
      fs.rmSync(testSourceDir, { recursive: true, force: true });
    }
  });

  describe('ensureHorsebox', () => {
    it('should throw error if horsebox is not installed', async () => {
      execFileSyncMock.mockImplementation(() => {
        throw new Error('Command not found');
      });

      const { ensureHorsebox } = await import('../src/lib/horsebox');
      expect(() => ensureHorsebox()).toThrow('Horsebox not found');
      execFileSyncMock.mockReturnValue('');
    });

    it('should not throw if horsebox is available', async () => {
      execFileSyncMock.mockReturnValue('');

      const { ensureHorsebox } = await import('../src/lib/horsebox');
      expect(() => ensureHorsebox()).not.toThrow();
    });
  });

  describe('buildFileContentIndex', () => {
    it('should call hb with correct arguments for filecontent index', async () => {
      execFileSyncMock.mockReturnValue('');

      const { buildFileContentIndex } = await import('../src/lib/horsebox');
      const fromDir = '/test/from';
      const indexDir = '/test/index';

      buildFileContentIndex(fromDir, indexDir);

      expect(execFileSyncMock).toHaveBeenCalledWith('hb', [
        'build',
        '--from', fromDir,
        '--index', indexDir,
        '--using', 'filecontent'
      ], expect.objectContaining({
        encoding: 'utf8',
      }));
    });
  });

  describe('buildFileLineIndex', () => {
    it('should call hb with correct arguments for fileline index', async () => {
      execFileSyncMock.mockReturnValue('');

      const { buildFileLineIndex } = await import('../src/lib/horsebox');
      const fromDir = '/test/from';
      const indexDir = '/test/index';

      buildFileLineIndex(fromDir, indexDir);

      expect(execFileSyncMock).toHaveBeenCalledWith('hb', [
        'build',
        '--from', fromDir,
        '--index', indexDir,
        '--using', 'fileline'
      ], expect.objectContaining({
        encoding: 'utf8',
      }));
    });
  });

  describe('searchIndex', () => {
    it('should return empty array for empty query', async () => {
      const { searchIndex } = await import('../src/lib/horsebox');
      const results = searchIndex(testIndexDir, '', 10);
      expect(results).toEqual([]);
    });

    it('should return empty array for whitespace-only query', async () => {
      const { searchIndex } = await import('../src/lib/horsebox');
      const results = searchIndex(testIndexDir, ' ', 10);
      expect(results).toEqual([]);
    });

    it('should return empty array for null query', async () => {
      const { searchIndex } = await import('../src/lib/horsebox');
      const results = searchIndex(testIndexDir, null, 10);
      expect(results).toEqual([]);
    });

    it('should parse results when hb returns array format', async () => {
      const mockResults = [{ file: 'test.js', line: 1, content: 'test code' }];
      execFileSyncMock.mockReturnValue(JSON.stringify(mockResults));

      const { searchIndex } = await import('../src/lib/horsebox');
      const results = searchIndex(testIndexDir, 'query', 10);

      expect(results).toEqual(mockResults);
    });

    it('should parse results when hb returns hits format', async () => {
      const mockHits = [{ file: 'test.js', line: 1, content: 'test code' }];
      execFileSyncMock.mockReturnValue(JSON.stringify({ hits: mockHits }));

      const { searchIndex } = await import('../src/lib/horsebox');
      const results = searchIndex(testIndexDir, 'query', 10);

      expect(results).toEqual(mockHits);
    });

    it('should call hb with correct arguments', async () => {
      execFileSyncMock.mockReturnValue('[]');

      const { searchIndex } = await import('../src/lib/horsebox');
      searchIndex(testIndexDir, 'myQuery', 25);

      expect(execFileSyncMock).toHaveBeenCalledWith('hb', [
        'search',
        '--index', testIndexDir,
        '--query', 'myQuery',
        '--json',
        '--limit', '25'
      ], expect.objectContaining({
        encoding: 'utf8',
      }));
    });

    it('should use default limit of 30 when not specified', async () => {
      execFileSyncMock.mockReturnValue('[]');

      const { searchIndex } = await import('../src/lib/horsebox');
      searchIndex(testIndexDir, 'query');

      expect(execFileSyncMock).toHaveBeenCalledWith('hb', [
        'search',
        '--index', testIndexDir,
        '--query', 'query',
        '--json',
        '--limit', '30'
      ], expect.any(Object));
    });

    describe('caching', () => {
      it('should cache search results', async () => {
        const mockResults = [{ file: 'test.js', line: 1 }];
        execFileSyncMock.mockReturnValue(JSON.stringify(mockResults));

        const { searchIndex } = await import('../src/lib/horsebox');
        const results1 = searchIndex(testIndexDir, 'cachedQuery', 10);
        const results2 = searchIndex(testIndexDir, 'cachedQuery', 10);

        expect(execFileSyncMock).toHaveBeenCalledTimes(1);
        expect(results1).toEqual(results2);
      });

      it('should not cache different queries', async () => {
        execFileSyncMock.mockReturnValue('[]');

        const { searchIndex } = await import('../src/lib/horsebox');
        searchIndex(testIndexDir, 'query1', 10);
        searchIndex(testIndexDir, 'query2', 10);

        expect(execFileSyncMock).toHaveBeenCalledTimes(2);
      });

      it('should not cache different limits', async () => {
        execFileSyncMock.mockReturnValue('[]');

        const { searchIndex } = await import('../src/lib/horsebox');
        searchIndex(testIndexDir, 'query', 10);
        searchIndex(testIndexDir, 'query', 20);

        expect(execFileSyncMock).toHaveBeenCalledTimes(2);
      });

      it('should not cache different index directories', async () => {
        execFileSyncMock.mockReturnValue('[]');

        const { searchIndex } = await import('../src/lib/horsebox');
        searchIndex('/index1', 'query', 10);
        searchIndex('/index2', 'query', 10);

        expect(execFileSyncMock).toHaveBeenCalledTimes(2);
      });
    });

    it('should throw when hb returns invalid JSON', async () => {
      execFileSyncMock.mockReturnValue('not valid json {{{');

      const { searchIndex } = await import('../src/lib/horsebox');

      expect(() => {
        searchIndex('/test/index', 'query', 10);
      }).toThrow();
    });
  });

  describe('real Horsebox integration', () => {
    it('should build and search filecontent index', async () => {
      if (!horseboxAvailable) {
        console.log('Skipping test - Horsebox not installed');
        return;
      }

      const sourceDir = path.join(__dirname, 'fixtures');
      if (!fs.existsSync(sourceDir)) {
        console.log('Skipping test - fixtures directory not found');
        return;
      }

      execFileSyncMock.mockImplementation(realExecFileSync as unknown as () => string);

      const { buildFileContentIndex, searchIndex } = await import('../src/lib/horsebox');

      try {
        buildFileContentIndex(sourceDir, testIndexDir);
        expect(fs.existsSync(testIndexDir)).toBe(true);
        const results = searchIndex(testIndexDir, 'test', 10);
        expect(Array.isArray(results)).toBe(true);
      } catch (error) {
        if ((error as Error).message.includes('No such file') || (error as Error).message.includes('PermissionError')) {
          console.log('Skipping test - Horsebox index creation failed due to environment limitations');
          return;
        }
        throw error;
      }
    });

    it('should build fileline index', async () => {
      if (!horseboxAvailable) {
        console.log('Skipping test - Horsebox not installed');
        return;
      }

      const sourceDir = path.join(__dirname, 'fixtures');
      if (!fs.existsSync(sourceDir)) {
        console.log('Skipping test - fixtures directory not found');
        return;
      }

      execFileSyncMock.mockImplementation(realExecFileSync as unknown as () => string);

      const { buildFileLineIndex } = await import('../src/lib/horsebox');
      try {
        buildFileLineIndex(sourceDir, testIndexDir);
        expect(fs.existsSync(testIndexDir)).toBe(true);
      } catch (error) {
        if ((error as Error).message.includes('No such file') || (error as Error).message.includes('PermissionError')) {
          console.log('Skipping test - Horsebox index creation failed due to environment limitations');
          return;
        }
        throw error;
      }
    });
  });
});
