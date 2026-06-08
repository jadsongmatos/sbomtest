import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';

const actualFs = await import('fs');
const actualParser = await import('@babel/parser');
const realParse = actualParser.parse;

const mockExistsSync = mock();
const mockReadFileSync = mock();
const mockReaddirSync = mock();

const fsMock = {
  ...actualFs,
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  readdirSync: mockReaddirSync,
};
mock.module('fs', () => ({ ...fsMock, default: fsMock }));

const mockParse = mock();
const parserMock = { ...actualParser, parse: mockParse };
mock.module('@babel/parser', () => ({ ...parserMock, default: parserMock }));

const {
  analyzeSourceFile,
  scanSourceFiles,
  parseGitIgnore,
  patternToRegex,
  shouldIgnore
} = await import('../src/lib/source-analyzer');

describe('Source Analyzer Module', () => {
  const testFile = '/test/project/src/app.js';

  beforeEach(() => {
    mockExistsSync.mockClear();
    mockReadFileSync.mockClear();
    mockReaddirSync.mockClear();
    mockParse.mockClear();
  });

  describe('parseGitIgnore', () => {
    it('should parse gitignore patterns', () => {
      const gitIgnoreContent = `
# Comment
node_modules
*.log
dist/
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(gitIgnoreContent);

      const patterns = parseGitIgnore('/test/project');

      expect(patterns).toEqual(['node_modules', '*.log', 'dist/']);
    });

    it('should skip empty lines and comments', () => {
      const gitIgnoreContent = `
# This is a comment
node_modules

# Another comment
*.log
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(gitIgnoreContent);

      const patterns = parseGitIgnore('/test/project');

      expect(patterns).toEqual(['node_modules', '*.log']);
    });

    it('should return empty array if gitignore does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const patterns = parseGitIgnore('/test/project');

      expect(patterns).toEqual([]);
    });

    it('should handle read errors gracefully', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('Read error');
      });

      const patterns = parseGitIgnore('/test/project');

      expect(patterns).toEqual([]);
    });
  });

  describe('patternToRegex', () => {
    it('should convert simple pattern to regex', () => {
      const regex = patternToRegex('node_modules');
      expect(regex.test('node_modules')).toBe(true);
      expect(regex.test('src/node_modules')).toBe(true);
    });

    it('should handle wildcard patterns', () => {
      const regex = patternToRegex('*.log');
      expect(regex.test('error.log')).toBe(true);
      expect(regex.test('debug.log')).toBe(true);
    });

    it('should handle anchored patterns', () => {
      const regex = patternToRegex('/dist');
      expect(regex.test('dist')).toBe(true);
    });

    it('should handle directory patterns', () => {
      const regex = patternToRegex('dist/');
      expect(regex.test('dist/file.js')).toBe(true);
    });

    it('should handle patterns with slash', () => {
      const regex = patternToRegex('src/utils');
      expect(regex.test('src/utils')).toBe(true);
    });

    it('should escape special regex characters', () => {
      const regex = patternToRegex('file.txt');
      expect(regex.test('filetxt')).toBe(false);
      expect(regex.test('file.txt')).toBe(true);
    });
  });

  describe('shouldIgnore', () => {
    it('should match patterns', () => {
      const patterns = ['node_modules'];
      const result = shouldIgnore('/project/node_modules/pkg/index.js', patterns, '/project');
      expect(result).toBe(true);
    });

    it('should not match non-matching patterns', () => {
      const patterns = ['dist'];
      const result = shouldIgnore('/project/src/index.js', patterns, '/project');
      expect(result).toBe(false);
    });

    it('should handle empty patterns', () => {
      const patterns: string[] = [];
      const result = shouldIgnore('/project/src/index.js', patterns, '/project');
      expect(result).toBe(false);
    });
  });

  describe('analyzeSourceFile', () => {
    it('should return empty object if file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const result = analyzeSourceFile(testFile);

      expect(result).toEqual({});
    });

    it('should handle parse errors gracefully', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('invalid code {{{');
      mockParse.mockImplementation(() => {
        throw new Error('Parse error');
      });

      const consoleSpy = spyOn(console, 'warn').mockImplementation(() => {});
      const result = analyzeSourceFile(testFile);

      expect(result).toEqual({});
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    describe('with real code analysis', () => {
      beforeEach(() => {
        mockParse.mockImplementation((...args: unknown[]) => realParse(...(args as [string, object])));
        mockExistsSync.mockReturnValue(true);
      });

      it('should detect CommonJS require with destructuring', () => {
        mockReadFileSync.mockReturnValue('const { readFileSync, writeFileSync } = require(\'fs\');');

        const result = analyzeSourceFile(testFile);

        expect(result.fs).toBeDefined();
        expect(result.fs!.functions).toContain('readFileSync');
        expect(result.fs!.functions).toContain('writeFileSync');
      });

      it('should detect member expressions from default require', () => {
        mockReadFileSync.mockReturnValue('const path = require(\'path\');\npath.join(\'/a\', \'b\');');

        const result = analyzeSourceFile(testFile);

        expect(result.path).toBeDefined();
        expect(result.path!.members.path).toContain('join');
      });

      it('should detect ES6 named imports', () => {
        mockReadFileSync.mockReturnValue('import { join, resolve } from \'path\';');

        const result = analyzeSourceFile(testFile);

        expect(result.path).toBeDefined();
        expect(result.path!.functions).toContain('join');
        expect(result.path!.functions).toContain('resolve');
      });

      it('should detect member expression chains', () => {
        mockReadFileSync.mockReturnValue('const db = require(\'prisma\');\ndb.user.findMany();');

        const result = analyzeSourceFile(testFile);

        expect(result.prisma).toBeDefined();
        expect(result.prisma!.chains).toContain('user.findMany');
      });

      it('should track class instances from destructured import', () => {
        const code = `
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.user.findUnique();
`;
        mockReadFileSync.mockReturnValue(code);

        const result = analyzeSourceFile(testFile);

        expect(result['@prisma/client']).toBeDefined();
        expect(result['@prisma/client']!.chains).toContain('user.findUnique');
      });

      it('should detect multiple libraries in one file', () => {
        const code = `
const { readFileSync } = require('fs');
const path = require('path');
readFileSync('/test');
path.join('/a', 'b');
`;
        mockReadFileSync.mockReturnValue(code);

        const result = analyzeSourceFile(testFile);

        expect(result.fs).toBeDefined();
        expect(result.path).toBeDefined();
      });

      it('should return empty object for file with no imports', () => {
        mockReadFileSync.mockReturnValue('function hello() { return 42; }');

        const result = analyzeSourceFile(testFile);

        expect(result).toEqual({});
      });
    });
  });

  describe('scanSourceFiles', () => {
    it('should scan directory for source files', () => {
      const rootEntries = [
        { name: 'src', isDirectory: () => true, isFile: () => false },
        { name: 'index.js', isDirectory: () => false, isFile: () => true }
      ];
      const srcEntries = [
        { name: 'app.ts', isDirectory: () => false, isFile: () => true }
      ];

      mockReaddirSync
        .mockReturnValueOnce(rootEntries as any)
        .mockReturnValueOnce(srcEntries as any);
      mockExistsSync.mockReturnValue(false);

      const files = scanSourceFiles('/test/project');

      expect(files).toContain('/test/project/index.js');
      expect(files).toContain('/test/project/src/app.ts');
    });

    it('should ignore node_modules', () => {
      const mockEntries = [
        { name: 'node_modules', isDirectory: () => true, isFile: () => false },
        { name: 'index.js', isDirectory: () => false, isFile: () => true }
      ];

      mockReaddirSync.mockReturnValue(mockEntries as any);
      mockExistsSync.mockReturnValue(false);

      const files = scanSourceFiles('/test/project');

      expect(files).not.toContain('/test/project/node_modules');
    });

    it('should respect gitignore patterns', () => {
      const mockEntries = [
        { name: 'dist', isDirectory: () => true, isFile: () => false },
        { name: 'index.js', isDirectory: () => false, isFile: () => true }
      ];

      mockReaddirSync.mockReturnValue(mockEntries as any);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('dist/');

      const files = scanSourceFiles('/test/project');

      expect(files).toContain('/test/project/index.js');
    });

    it('should handle excludeDirs option', () => {
      const mockEntries = [
        { name: 'custom-ignore', isDirectory: () => true, isFile: () => false },
        { name: 'index.js', isDirectory: () => false, isFile: () => true }
      ];

      mockReaddirSync.mockReturnValue(mockEntries as any);
      mockExistsSync.mockReturnValue(false);

      const files = scanSourceFiles('/test/project', { excludeDirs: ['custom-ignore'] });

      expect(files).toContain('/test/project/index.js');
    });

    it('should disable gitignore when respectGitIgnore is false', () => {
      const mockEntries = [
        { name: 'dist', isDirectory: () => true, isFile: () => false },
        { name: 'index.js', isDirectory: () => false, isFile: () => true }
      ];

      mockReaddirSync.mockReturnValue(mockEntries as any);
      mockExistsSync.mockReturnValue(true);

      const _files = scanSourceFiles('/test/project', { respectGitIgnore: false });

      expect(mockExistsSync).not.toHaveBeenCalled();
    });

    it('should handle various source file extensions', () => {
      const mockEntries = [
        { name: 'file.js', isDirectory: () => false, isFile: () => true },
        { name: 'file.jsx', isDirectory: () => false, isFile: () => true },
        { name: 'file.mjs', isDirectory: () => false, isFile: () => true },
        { name: 'file.cjs', isDirectory: () => false, isFile: () => true },
        { name: 'file.ts', isDirectory: () => false, isFile: () => true },
        { name: 'file.tsx', isDirectory: () => false, isFile: () => true },
        { name: 'file.txt', isDirectory: () => false, isFile: () => true }
      ];

      mockReaddirSync.mockReturnValue(mockEntries as any);
      mockExistsSync.mockReturnValue(false);

      const files = scanSourceFiles('/test/project');

      expect(files).toHaveLength(6);
      expect(files).not.toContain('/test/project/file.txt');
    });

    it('should support includePatterns to filter files', () => {
      const rootEntries = [
        { name: 'src', isDirectory: () => true, isFile: () => false },
        { name: 'index.js', isDirectory: () => false, isFile: () => true },
        { name: 'app.js', isDirectory: () => false, isFile: () => true }
      ];
      const srcEntries = [
        { name: 'utils.ts', isDirectory: () => false, isFile: () => true },
        { name: 'helper.js', isDirectory: () => false, isFile: () => true }
      ];

      mockReaddirSync
        .mockReturnValueOnce(rootEntries as any)
        .mockReturnValueOnce(srcEntries as any);
      mockExistsSync.mockReturnValue(false);

      const files = scanSourceFiles('/test/project', { includePatterns: ['src/**'] });

      expect(files).toContain('/test/project/src/utils.ts');
      expect(files).toContain('/test/project/src/helper.js');
      expect(files).not.toContain('/test/project/index.js');
      expect(files).not.toContain('/test/project/app.js');
    });

    it('should support excludePatterns to filter files', () => {
      const rootEntries = [
        { name: 'src', isDirectory: () => true, isFile: () => false },
        { name: 'index.js', isDirectory: () => false, isFile: () => true },
        { name: 'test.spec.js', isDirectory: () => false, isFile: () => true }
      ];
      const srcEntries = [
        { name: 'utils.ts', isDirectory: () => false, isFile: () => true },
        { name: 'helper.test.js', isDirectory: () => false, isFile: () => true }
      ];

      mockReaddirSync
        .mockReturnValueOnce(rootEntries as any)
        .mockReturnValueOnce(srcEntries as any);
      mockExistsSync.mockReturnValue(false);

      const files = scanSourceFiles('/test/project', { excludePatterns: ['**/*.test.js', '**/*.spec.js'] });

      expect(files).toContain('/test/project/index.js');
      expect(files).toContain('/test/project/src/utils.ts');
      expect(files).not.toContain('/test/project/test.spec.js');
      expect(files).not.toContain('/test/project/src/helper.test.js');
    });

    it('should apply excludePatterns before includePatterns', () => {
      const rootEntries = [
        { name: 'src', isDirectory: () => true, isFile: () => false },
        { name: 'index.js', isDirectory: () => false, isFile: () => true },
        { name: 'vendor.js', isDirectory: () => false, isFile: () => true }
      ];
      const srcEntries = [
        { name: 'utils.ts', isDirectory: () => false, isFile: () => true },
        { name: 'vendor.ts', isDirectory: () => false, isFile: () => true }
      ];

      mockReaddirSync
        .mockReturnValueOnce(rootEntries as any)
        .mockReturnValueOnce(srcEntries as any);
      mockExistsSync.mockReturnValue(false);

      const files = scanSourceFiles('/test/project', {
        includePatterns: ['src/**', '*.js'],
        excludePatterns: ['**/vendor.*']
      });

      expect(files).toContain('/test/project/index.js');
      expect(files).toContain('/test/project/src/utils.ts');
      expect(files).not.toContain('/test/project/vendor.js');
      expect(files).not.toContain('/test/project/src/vendor.ts');
    });

    it('should handle comma-separated include patterns', () => {
      const rootEntries = [
        { name: 'src', isDirectory: () => true, isFile: () => false },
        { name: 'lib', isDirectory: () => true, isFile: () => false },
        { name: 'index.js', isDirectory: () => false, isFile: () => true }
      ];
      const srcEntries = [
        { name: 'app.ts', isDirectory: () => false, isFile: () => true }
      ];
      const libEntries = [
        { name: 'utils.js', isDirectory: () => false, isFile: () => true }
      ];

      mockReaddirSync
        .mockReturnValueOnce(rootEntries as any)
        .mockReturnValueOnce(srcEntries as any)
        .mockReturnValueOnce(libEntries as any);
      mockExistsSync.mockReturnValue(false);

      const files = scanSourceFiles('/test/project', { includePatterns: ['src/**', 'lib/**'] });

      expect(files).toContain('/test/project/src/app.ts');
      expect(files).toContain('/test/project/lib/utils.js');
      expect(files).not.toContain('/test/project/index.js');
    });
  });
});
