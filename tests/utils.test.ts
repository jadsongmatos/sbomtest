import { describe, it, expect, beforeEach, mock } from 'bun:test';

const actualFs = await import('fs');
const actualOs = await import('os');

const mockReadFileSync = mock();
const mockWriteFileSync = mock();
const mockExistsSync = mock();
const mockMkdirSync = mock();
const mockReaddirSync = mock();
const mockCopyFileSync = mock();
const mockRmSync = mock();
const mockUnlinkSync = mock();
const mockStatSync = mock();

const fsMock = {
  ...actualFs,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  readdirSync: mockReaddirSync,
  copyFileSync: mockCopyFileSync,
  rmSync: mockRmSync,
  unlinkSync: mockUnlinkSync,
  statSync: mockStatSync,
};
mock.module('fs', () => ({ ...fsMock, 'default': fsMock }));

const mockHomedir = mock();
const osMock = { ...actualOs, homedir: mockHomedir };
mock.module('os', () => ({ ...osMock, 'default': osMock }));

const {
  uniq,
  normalizeLibraryNames,
  isTestFile,
  safeReadFile,
  getCacheDir,
} = await import('../src/lib/utils');

describe('Utils Module', () => {
  beforeEach(() => {
    mockReadFileSync.mockClear();
    mockWriteFileSync.mockClear();
    mockExistsSync.mockClear();
    mockMkdirSync.mockClear();
    mockHomedir.mockClear();
  });

  describe('uniq', () => {
    it('should remove duplicates from array', () => {
      const result = uniq([1, 2, 2, 3, 3, 3]);
      expect(result).toEqual([1, 2, 3]);
    });

    it('should preserve order', () => {
      const result = uniq([3, 1, 2, 1, 3]);
      expect(result).toEqual([3, 1, 2]);
    });

    it('should filter out null and undefined', () => {
      const result = uniq([1, null, 2, undefined, 3, null]);
      expect(result).toEqual([1, 2, 3]);
    });

    it('should filter out empty strings', () => {
      const result = uniq(['a', '', 'b', '', 'c']);
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should handle empty array', () => {
      const result = uniq([]);
      expect(result).toEqual([]);
    });

    it('should handle array with all duplicates', () => {
      const result = uniq([5, 5, 5, 5]);
      expect(result).toEqual([5]);
    });
  });

  describe('normalizeLibraryNames', () => {
    it('should return original name', () => {
      const result = normalizeLibraryNames('express');
      expect(result).toContain('express');
    });

    it('should handle scoped packages', () => {
      const result = normalizeLibraryNames('@scope/package');
      expect(result).toContain('@scope/package');
      expect(result).toContain('scope/package');
      expect(result).toContain('package');
    });

    it('should handle packages with slashes', () => {
      const result = normalizeLibraryNames('lodash/fp');
      expect(result).toContain('lodash/fp');
      expect(result).toContain('fp');
    });

    it('should handle scoped packages with slashes', () => {
      const result = normalizeLibraryNames('@babel/core');
      expect(result).toContain('@babel/core');
      expect(result).toContain('babel/core');
      expect(result).toContain('core');
    });

    it('should filter out empty strings', () => {
      const result = normalizeLibraryNames('');
      expect(result).not.toContain('');
    });

    it('should return array', () => {
      const result = normalizeLibraryNames('express');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('isTestFile', () => {
    it('should identify test files by extension pattern', () => {
      expect(isTestFile('app.test.js')).toBe(true);
      expect(isTestFile('app.spec.js')).toBe(true);
      expect(isTestFile('app.test.ts')).toBe(true);
      expect(isTestFile('app.spec.ts')).toBe(true);
      expect(isTestFile('app.test.jsx')).toBe(true);
      expect(isTestFile('app.test.tsx')).toBe(true);
      expect(isTestFile('app.test.mjs')).toBe(true);
      expect(isTestFile('app.test.cjs')).toBe(true);
    });

    it('should identify test files by name pattern', () => {
      expect(isTestFile('app.test.js')).toBe(true);
      expect(isTestFile('app.spec.js')).toBe(true);
      expect(isTestFile('app.test.ts')).toBe(true);
      expect(isTestFile('app.spec.ts')).toBe(true);
    });

    it('should identify files in test directories', () => {
      expect(isTestFile('tests/test.js')).toBe(true);
      expect(isTestFile('test/test.js')).toBe(true);
      expect(isTestFile('__tests__/test.js')).toBe(true);
      expect(isTestFile('specs/test.js')).toBe(true);
      expect(isTestFile('spec/test.js')).toBe(true);
    });

    it('should handle Windows paths', () => {
      expect(isTestFile('tests\\test.js')).toBe(true);
      expect(isTestFile('__tests__\\test.js')).toBe(true);
    });

    it('should reject non-test files', () => {
      expect(isTestFile('app.js')).toBe(false);
      expect(isTestFile('utils.ts')).toBe(false);
      expect(isTestFile('index.jsx')).toBe(false);
    });

    it('should reject files in non-test directories', () => {
      expect(isTestFile('src/app.js')).toBe(false);
      expect(isTestFile('lib/utils.js')).toBe(false);
    });

    it('should be case insensitive for extensions', () => {
      expect(isTestFile('app.TEST.js')).toBe(true);
      expect(isTestFile('app.SPEC.ts')).toBe(true);
    });
  });

  describe('safeReadFile', () => {
    it('should read file content', () => {
      mockReadFileSync.mockReturnValue('file content');

      const result = safeReadFile('/test/file.js');

      expect(result).toBe('file content');
      expect(mockReadFileSync).toHaveBeenCalledWith('/test/file.js', 'utf8');
    });

    it('should return null if file does not exist', () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = safeReadFile('/test/nonexistent.js');

      expect(result).toBeNull();
    });

    it('should return null on read error', () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = safeReadFile('/test/protected.js');

      expect(result).toBeNull();
    });

    it('should handle empty file', () => {
      mockReadFileSync.mockReturnValue('');

      const result = safeReadFile('/test/empty.js');

      expect(result).toBe('');
    });
  });

  describe('getCacheDir', () => {
    it('should return cache directory path', () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockReturnValue(true);

      const result = getCacheDir();

      expect(result).toBe('/home/user/.sbomtest/repos');
    });

    it('should create cache directory if it does not exist', () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockReturnValue(false);

      getCacheDir();

      expect(mockMkdirSync).toHaveBeenCalledWith('/home/user/.sbomtest/repos', { recursive: true, mode: 0o700 });
    });

    it('should use correct default cache path', () => {
      mockHomedir.mockReturnValue('/Users/testuser');
      mockExistsSync.mockReturnValue(true);

      const result = getCacheDir();

      expect(result).toBe('/Users/testuser/.sbomtest/repos');
    });

    it('should handle Windows home directory', () => {
      mockHomedir.mockReturnValue('C:\\Users\\testuser');
      mockExistsSync.mockReturnValue(true);

      const result = getCacheDir();

      expect(result).toContain('.sbomtest');
      expect(result).toContain('repos');
    });
  });
});
