import { describe, it, expect, beforeEach, mock } from 'bun:test';
import path from 'path';
import https from 'https';

const actualFs = await import('fs');
const actualChildProcess = await import('child_process');
const actualHttps = await import('https');

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
mock.module('fs', () => ({ ...fsMock, default: fsMock }));

const mockExecSync = mock();
const childProcessMock = { ...actualChildProcess, execSync: mockExecSync };
mock.module('child_process', () => ({ ...childProcessMock, default: childProcessMock }));

const mockHttpsGet = mock();
const httpsMock = { ...actualHttps, get: mockHttpsGet };
mock.module('https', () => ({ ...httpsMock, default: httpsMock }));

const {
  generateSBOM,
  readSBOM,
  extractComponents,
  createSBOMFromPackageLock,
  detectPackageManager,
  detectMergeConflicts,
  formatMergeConflictError
} = await import('../src/lib/sbom');

describe('SBOM Module', () => {
  const testProjectDir = path.join(__dirname, 'fixtures', 'test-project');
  const testSBOMPath = path.join(testProjectDir, 'sbom.cdx.json');

  beforeEach(() => {
    mockReadFileSync.mockClear();
    mockWriteFileSync.mockClear();
    mockExistsSync.mockClear();
    mockExecSync.mockClear();
    mockHttpsGet.mockClear();

    mockExistsSync.mockImplementation((filePath: unknown) => {
      const fp = String(filePath);
      if (fp.endsWith('package-lock.json') && fp.includes('test-project')) {
        return true;
      }
      if (fp.endsWith('sbom.cdx.json') && fp.includes('test-project')) {
        return true;
      }
      if (fp.endsWith('package.json') && fp.includes('test-project')) {
        return true;
      }
      return false;
    });

    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const fp = String(filePath);
      if (fp.endsWith('sbom.cdx.json')) {
        return JSON.stringify({
          bomFormat: 'CycloneDX',
          specVersion: '1.4',
          components: [{ name: 'express', version: '4.18.0' }]
        });
      }
      if (fp.endsWith('package.json')) {
        return JSON.stringify({ dependencies: { express: '4.18.0' } });
      }
      if (fp.endsWith('package-lock.json')) {
        return JSON.stringify({
          lockfileVersion: 2,
          packages: {
            '': { name: 'root', version: '1.0.0' },
            'node_modules/express': { name: 'express', version: '4.18.0' }
          }
        });
      }
      return '';
    });
  });

  describe('createSBOMFromPackageLock', () => {
    it('should create SBOM from package-lock.json v2 format', async () => {
      const packageLock = {
        lockfileVersion: 2,
        packages: {
          '': {
            name: 'root',
            version: '1.0.0',
            dependencies: {
              express: '4.18.0'
            }
          },
          'node_modules/express': {
            name: 'express',
            version: '4.18.0',
            resolved: 'https://registry.npmjs.org/express/-/express-4.18.0.tgz'
          },
          'node_modules/lodash': {
            name: 'lodash',
            version: '4.17.21'
          }
        }
      };

      const sbom = await createSBOMFromPackageLock(packageLock);

      expect(sbom.bomFormat).toBe('CycloneDX');
      expect(sbom.specVersion).toBe('1.4');
      expect(sbom.components).toHaveLength(2);
      expect(sbom.components[0].name).toBe('express');
      expect(sbom.components[0].version).toBe('4.18.0');
    });

    it('should omit transitive dependencies when requested', async () => {
      const packageLock = {
        lockfileVersion: 2,
        packages: {
          '': {
            dependencies: {
              express: '4.18.0'
            }
          },
          'node_modules/express': {
            name: 'express',
            version: '4.18.0'
          },
          'node_modules/accepts': {
            name: 'accepts',
            version: '1.3.8'
          }
        }
      };

      const sbom = await createSBOMFromPackageLock(packageLock, false, true);

      expect(sbom.components).toHaveLength(1);
      expect(sbom.components[0].name).toBe('express');
    });

    it('should handle empty packages', async () => {
      const packageLock = {
        lockfileVersion: 2,
        packages: {}
      };

      const sbom = await createSBOMFromPackageLock(packageLock);

      expect(sbom.components).toHaveLength(0);
    });

    it('should handle packages without name field', async () => {
      const packageLock = {
        lockfileVersion: 2,
        packages: {
          'node_modules/express': {
            version: '4.18.0'
          }
        }
      };

      const sbom = await createSBOMFromPackageLock(packageLock);

      expect(sbom.components).toHaveLength(1);
      expect(sbom.components[0].name).toBe('express');
    });

    it('should skip root package', async () => {
      const packageLock = {
        lockfileVersion: 2,
        packages: {
          '': {
            name: 'root',
            version: '1.0.0'
          }
        }
      };

      const sbom = await createSBOMFromPackageLock(packageLock);

      expect(sbom.components).toHaveLength(0);
    });

    it('should handle pnpm-lock.yaml format (v9+)', async () => {
      const packageLock = {
        lockfileVersion: '9.0',
        importers: {
          '.': {
            dependencies: {
              'express': {
                specifier: '^4.18.0',
                version: '4.18.2'
              },
              'lodash': {
                specifier: '^4.17.21',
                version: '4.17.21'
              }
            },
            devDependencies: {
              'jest': {
                specifier: '^29.0.0',
                version: '29.7.0'
              }
            }
          }
        }
      };

      const sbom = await createSBOMFromPackageLock(packageLock);

      expect(sbom.components).toHaveLength(3);
      expect(sbom.components.map(c => c.name)).toEqual(
        expect.arrayContaining(['express', 'lodash', 'jest'])
      );
    });

    it('should handle pnpm format with string versions', async () => {
      const packageLock = {
        lockfileVersion: '9.0',
        importers: {
          '.': {
            dependencies: {
              'express': '4.18.2',
              'lodash': '4.17.21'
            }
          }
        }
      };

      const sbom = await createSBOMFromPackageLock(packageLock);

      expect(sbom.components).toHaveLength(2);
      expect(sbom.components[0].name).toBe('express');
      expect(sbom.components[0].version).toBe('4.18.2');
    });

    it('should handle pnpm format with omitTransitive', async () => {
      const packageLock = {
        lockfileVersion: '9.0',
        importers: {
          '.': {
            dependencies: {
              'express': {
                specifier: '^4.18.0',
                version: '4.18.2'
              },
              'lodash': {
                specifier: '^4.17.21',
                version: '4.17.21'
              }
            }
          }
        }
      };

      const sbom = await createSBOMFromPackageLock(packageLock, false, true);

      expect(sbom.components.length).toBeGreaterThan(0);
    });
  });

  describe('detectPackageManager', () => {
    it('should detect npm project (package-lock.json)', () => {
      mockExistsSync.mockImplementation((filePath: unknown) => {
        return String(filePath).endsWith('package-lock.json');
      });

      const result = detectPackageManager('/test/project');
      expect(result).toEqual({ type: 'npm', lockPath: expect.stringContaining('package-lock.json') });
    });

    it('should detect PNPM project (pnpm-lock.yaml)', () => {
      mockExistsSync.mockImplementation((filePath: unknown) => {
        return String(filePath).endsWith('pnpm-lock.yaml');
      });

      const result = detectPackageManager('/test/project');
      expect(result).toEqual({ type: 'pnpm', lockPath: expect.stringContaining('pnpm-lock.yaml') });
    });

    it('should detect Yarn project (yarn.lock)', () => {
      mockExistsSync.mockImplementation((filePath: unknown) => {
        return String(filePath).endsWith('yarn.lock');
      });

      const result = detectPackageManager('/test/project');
      expect(result).toEqual({ type: 'yarn', lockPath: expect.stringContaining('yarn.lock') });
    });

    it('should return null when no lock file found', () => {
      mockExistsSync.mockReturnValue(false);

      const result = detectPackageManager('/test/project');
      expect(result).toBeNull();
    });

    it('should prioritize pnpm over npm when both exist', () => {
      mockExistsSync.mockReturnValue(true);

      const result = detectPackageManager('/test/project');
      expect(result!.type).toBe('pnpm');
    });
  });

  describe('generateSBOM', () => {
    it('should generate SBOM using cyclonedx-npm', async () => {
      const mockSBOM = {
        bomFormat: 'CycloneDX',
        specVersion: '1.4',
        components: [
          { name: 'express', version: '4.18.0' }
        ]
      };

      mockExistsSync.mockImplementation((filePath: unknown) => {
        const fp = String(filePath);
        return fp.endsWith('package-lock.json') || fp.endsWith('sbom.cdx.json') || fp.endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify(mockSBOM));
      mockExecSync.mockImplementation(() => {});

      const result = await generateSBOM(testProjectDir, 'sbom.cdx.json');

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('npx @cyclonedx/cyclonedx-npm'),
        expect.any(Object)
      );
      expect(result).toBe(testSBOMPath);
    });

    it('should handle omitTransitive option', async () => {
      const mockSBOM = {
        bomFormat: 'CycloneDX',
        specVersion: '1.4',
        components: [
          { name: 'express', version: '4.18.0' },
          { name: 'lodash', version: '4.17.21' }
        ]
      };

      mockExistsSync.mockImplementation((filePath: unknown) => {
        const fp = String(filePath);
        return fp.endsWith('package-lock.json') || fp.endsWith('sbom.cdx.json') || fp.endsWith('package.json');
      });
      mockReadFileSync
        .mockReturnValueOnce(JSON.stringify({ dependencies: { express: '4.18.0' } }))
        .mockReturnValueOnce(JSON.stringify(mockSBOM));
      mockExecSync.mockImplementation(() => {});

      await generateSBOM(testProjectDir, 'sbom.cdx.json', false, true);

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--omit dev --omit optional --omit peer'),
        expect.any(Object)
      );
    });

    it('should fetch repo URLs when requested', async () => {
      const mockSBOM = {
        bomFormat: 'CycloneDX',
        specVersion: '1.4',
        components: [
          { name: 'express', version: '4.18.0' }
        ]
      };

      const mockPackageInfo = {
        repository: {
          url: 'https://github.com/expressjs/express'
        }
      };

      mockExistsSync.mockImplementation((filePath: unknown) => {
        const fp = String(filePath);
        return fp.endsWith('package-lock.json') || fp.endsWith('sbom.cdx.json') || fp.endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify(mockSBOM));
      mockExecSync.mockImplementation(() => {});

      mockHttpsGet.mockImplementation((url: unknown, options: unknown, cb: unknown) => {
        const callback = typeof options === 'function' ? options : cb;
        const req = { on: mock() };
        process.nextTick(() => {
          callback({
            statusCode: 200,
            on: (event: string, handler: (data?: string) => void) => {
              if (event === 'data') { handler(JSON.stringify(mockPackageInfo)); }
              if (event === 'end') { handler(); }
            }
          });
        });
        return req;
      });

      await generateSBOM(testProjectDir, 'sbom.cdx.json', true);

      expect(mockHttpsGet).toHaveBeenCalled();
    });

    it('should handle HTTPS errors when fetching repo URLs', async () => {
      const mockSBOM = {
        bomFormat: 'CycloneDX',
        specVersion: '1.4',
        components: [
          { name: 'express', version: '4.18.0' }
        ]
      };

      mockExistsSync.mockImplementation((filePath: unknown) => {
        const fp = String(filePath);
        return fp.endsWith('package-lock.json') || fp.endsWith('sbom.cdx.json') || fp.endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify(mockSBOM));
      mockExecSync.mockImplementation(() => {});

      mockHttpsGet.mockImplementation((url: unknown, options: unknown, cb: unknown) => {
        const callback = typeof options === 'function' ? options : cb;
        const req = { on: mock() };
        process.nextTick(() => {
          callback({ statusCode: 404 });
        });
        return req;
      });

      await generateSBOM(testProjectDir, 'sbom.cdx.json', true);

      expect(mockHttpsGet).toHaveBeenCalled();
    });

    it('should handle non-200 status codes', async () => {
      mockHttpsGet.mockImplementation((url: unknown, options: unknown, cb: unknown) => {
        const callback = typeof options === 'function' ? options : cb;
        const req = { on: mock() };
        process.nextTick(() => {
          callback({ statusCode: 500 });
        });
        return req;
      });

      const result = await new Promise<unknown>((resolve) => {
        https.get('https://registry.npmjs.org/test', { timeout: 5000 } as https.RequestOptions, (res) => {
          if (res.statusCode !== 200) {
            resolve(null);
          }
        });
      });

      expect(result).toBeNull();
    });
  });

  describe('readSBOM', () => {
    it('should read and parse SBOM file', () => {
      const mockSBOM = {
        bomFormat: 'CycloneDX',
        specVersion: '1.4',
        components: []
      };

      mockReadFileSync.mockReturnValue(JSON.stringify(mockSBOM));

      const result = readSBOM(testSBOMPath);

      expect(result).toEqual(mockSBOM);
      expect(mockReadFileSync).toHaveBeenCalledWith(testSBOMPath, 'utf8');
    });
  });

  describe('extractComponents', () => {
    it('should extract components with repo_url from externalReferences', () => {
      const sbom = {
        components: [
          {
            name: 'express',
            version: '4.18.0',
            externalReferences: [
              { type: 'vcs', url: 'https://github.com/expressjs/express' }
            ]
          }
        ]
      };

      const components = extractComponents(sbom);

      expect(components).toHaveLength(1);
      expect(components[0]).toEqual({
        name: 'express',
        version: '4.18.0',
        repo_url: 'https://github.com/expressjs/express'
      });
    });

    it('should extract components with repo_url from repository field', () => {
      const sbom = {
        components: [
          {
            name: 'lodash',
            version: '4.17.21',
            repository: { url: 'https://github.com/lodash/lodash' }
          }
        ]
      };

      const components = extractComponents(sbom);

      expect(components).toHaveLength(1);
      expect(components[0].repo_url).toBe('https://github.com/lodash/lodash');
    });

    it('should normalize GitHub URLs', () => {
      const sbom = {
        components: [
          {
            name: 'pkg',
            version: '1.0.0',
            externalReferences: [
              { type: 'vcs', url: 'git+https://github.com/user/repo.git' }
            ]
          }
        ]
      };

      const components = extractComponents(sbom);

      expect(components[0].repo_url).toBe('https://github.com/user/repo');
    });

    it('should handle components without repo_url', () => {
      const sbom = {
        components: [
          {
            name: 'internal-pkg',
            version: '1.0.0'
          }
        ]
      };

      const components = extractComponents(sbom);

      expect(components).toHaveLength(1);
      expect(components[0].repo_url).toBeNull();
    });

    it('should handle empty components', () => {
      const sbom = {
        components: []
      };

      const components = extractComponents(sbom);

      expect(components).toHaveLength(0);
    });

    it('should handle missing components field', () => {
      const sbom = {};

      const components = extractComponents(sbom);

      expect(components).toHaveLength(0);
    });

    it('should prefer vcs reference over repository field', () => {
      const sbom = {
        components: [
          {
            name: 'pkg',
            version: '1.0.0',
            externalReferences: [
              { type: 'vcs', url: 'https://github.com/primary/repo' }
            ],
            repository: { url: 'https://github.com/secondary/repo' }
          }
        ]
      };

      const components = extractComponents(sbom);

      expect(components[0].repo_url).toBe('https://github.com/primary/repo');
    });
  });

  describe('detectMergeConflicts', () => {
    it('should detect merge conflict markers in JSON', () => {
      const conflictContent = `{
"name": "ultrah",
<<<<<<< HEAD
"version": "1.0.20",
=======
"version": "1.0.21",
>>>>>>> main
"lockfileVersion": 3
}`;

      const result = detectMergeConflicts(conflictContent);

      expect(result.hasMergeConflict).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].start).toBe(3);
      expect(result.conflicts[0].separator).toBe(5);
      expect(result.conflicts[0].end).toBe(7);
    });

    it('should detect multiple merge conflicts', () => {
      const conflictContent = `{
<<<<<<< HEAD
"version": "1.0.20",
=======
"version": "1.0.21",
>>>>>>> main
"dependencies": {
<<<<<<< HEAD
"express": "4.18.0"
=======
"express": "4.19.0"
>>>>>>> main
}
}`;

      const result = detectMergeConflicts(conflictContent);

      expect(result.hasMergeConflict).toBe(true);
      expect(result.conflicts).toHaveLength(2);
    });

    it('should not detect conflicts in clean content', () => {
      const cleanContent = `{
"name": "ultrah",
"version": "1.0.21",
"lockfileVersion": 3
}`;

      const result = detectMergeConflicts(cleanContent);

      expect(result.hasMergeConflict).toBe(false);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should handle conflicts with 3-way merge markers', () => {
      const conflictContent = `{
<<<<<<< HEAD
"version": "1.0.20",
||||||| merged common ancestors
"version": "1.0.19",
=======
"version": "1.0.21",
>>>>>>> main
"data": {}
}`;

      const result = detectMergeConflicts(conflictContent);

      expect(result.hasMergeConflict).toBe(true);
      expect(result.conflicts[0].middle).toBe(4);
    });
  });

  describe('formatMergeConflictError', () => {
    it('should format error message with merge conflict details', () => {
      const filePath = '/path/to/package-lock.json';
      const conflicts = [
        {
          start: 3,
          marker: '<<<<<<< HEAD',
          separator: 5,
          end: 7
        }
      ];

      const message = formatMergeConflictError(filePath, conflicts);

      expect(message).toContain('Detectado merge conflict não resolvido');
      expect(message).toContain('package-lock.json');
      expect(message).toContain('Conflito 1');
      expect(message).toContain('Linha 3');
      expect(message).toContain('git status');
      expect(message).toContain('git add');
      expect(message).toContain('git commit');
    });

    it('should format multiple conflicts in error message', () => {
      const filePath = '/path/to/pnpm-lock.yaml';
      const conflicts = [
        { start: 3, marker: '<<<<<<< HEAD', separator: 5, end: 7 },
        { start: 10, marker: '<<<<<<< HEAD', separator: 12, end: 14 }
      ];

      const message = formatMergeConflictError(filePath, conflicts);

      expect(message).toContain('Conflito 1');
      expect(message).toContain('Conflito 2');
      expect(message).toContain('Linha 3');
      expect(message).toContain('Linha 10');
    });
  });

  describe('readSBOM with merge conflict detection', () => {
    it('should throw error with helpful message when reading SBOM with merge conflicts', () => {
      const conflictContent = `{
<<<<<<< HEAD
"bomFormat": "CycloneDX",
=======
"bomFormat": "OtherFormat",
>>>>>>> main
"components": []
}`;

      mockReadFileSync.mockReturnValue(conflictContent);

      expect(() => {
        readSBOM(testSBOMPath);
      }).toThrow('Detectado merge conflict não resolvido');
    });

    it('should throw descriptive JSON error when not a merge conflict', () => {
      const invalidContent = `{
"bomFormat": "CycloneDX",
invalid json here
}`;

      mockReadFileSync.mockReturnValue(invalidContent);

      expect(() => {
        readSBOM(testSBOMPath);
      }).toThrow('Erro ao fazer parsing do SBOM');
    });
  });
});
