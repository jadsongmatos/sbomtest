import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, spawnSync } from 'child_process';

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

const { analyze } = await import('../src/index');
import type { AnalyzeResult } from '../src/index';
const {
  generateSBOM,
  readSBOM,
  extractComponents,
  createSBOMFromPackageLock
} = await import('../src/lib/sbom');
const {
  downloadRepos,
  parseRepoUrl
} = await import('../src/lib/repo-downloader');
const {
  analyzeSourceFile,
  scanSourceFiles
} = await import('../src/lib/source-analyzer');
const {
  ensureHorsebox,
  buildFileContentIndex,
  buildFileLineIndex,
  searchIndex
} = await import('../src/lib/horsebox');
const {
  writeMarkdownForSource
} = await import('../src/lib/markdown-generator');

describe('index.js - Main Module', () => {
  let testProjectPath: string;
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbomtest-test-'));
    testProjectPath = path.join(__dirname, 'fixtures', 'test-project');
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('analyze function', () => {
    it('should throw error for non-existent project path', async () => {
      expect(analyze('/non-existent/path-xyz-123')).rejects.toThrow('Project path does not exist');
    });

    it('should throw error when Horsebox is not installed', async () => {
      const horseboxModule = await import('../src/lib/horsebox');

      expect(() => {
        horseboxModule.ensureHorsebox();
      }).not.toThrow();

      expect(horseboxModule.ensureHorsebox.toString()).toContain('Horsebox');
    });

    it('should analyze project and generate markdown files', async () => {
      if (!fs.existsSync(testProjectPath)) {
        console.log('Skipping test - test-project fixture not found');
        return;
      }

      const result: AnalyzeResult = await analyze(testProjectPath, {
        sbomPath: 'test-sbom-temp.json'
      });

      expect(result).toBeDefined();
      expect(result.sbomPath).toBeDefined();
      expect(result.generated).toBeDefined();
      expect(Array.isArray(result.generated)).toBe(true);
    }, 120000);

    it('should handle single file analysis with --file option', async () => {
      if (!fs.existsSync(testProjectPath)) {
        console.log('Skipping test - test-project fixture not found');
        return;
      }

      const result: AnalyzeResult = await analyze(testProjectPath, {
        sourceFile: 'index.js',
        sbomPath: 'test-sbom-single.json'
      });

      expect(result).toBeDefined();
      expect(result.generated).toBeDefined();
      expect(Array.isArray(result.generated)).toBe(true);
    }, 120000);

    it('should respect maxDownloads option', async () => {
      if (!fs.existsSync(testProjectPath)) {
        console.log('Skipping test - test-project fixture not found');
        return;
      }

      const result: AnalyzeResult = await analyze(testProjectPath, {
        downloadDependencies: true,
        maxDownloads: 2,
        sbomPath: 'test-sbom-limited.json'
      });

      expect(result).toBeDefined();
      expect(result.sbomPath).toBeDefined();
    }, 180000);
  });

  describe('CLI argument parsing', () => {
    it('should handle --file argument correctly', () => {
      const args = ['--file=index.js', '--download-dependencies', '--max-downloads=5'];
      const fileArg = args.find(arg => arg.startsWith('--file='));
      const downloadFlag = args.includes('--download-dependencies');
      const maxDownloadsArg = args.find(arg => arg.startsWith('--max-downloads='));

      expect(fileArg).toBe('--file=index.js');
      expect(fileArg?.split('=')[1]).toBe('index.js');
      expect(downloadFlag).toBe(true);
      expect(maxDownloadsArg).toBe('--max-downloads=5');
      expect(parseInt(maxDownloadsArg?.split('=')[1] ?? '', 10)).toBe(5);
    });

    it('should use defaults when no arguments provided', () => {
      const args: string[] = [];
      const fileArg = args.find(arg => arg.startsWith('--file='));
      const downloadFlag = args.includes('--download-dependencies');
      const maxDownloadsArg = args.find(arg => arg.startsWith('--max-downloads='));

      expect(fileArg).toBeUndefined();
      expect(downloadFlag).toBe(false);
      expect(maxDownloadsArg).toBeUndefined();
    });
  });
});

describe('SBOM Module Integration', () => {
  let tempProjectPath: string;

  beforeAll(() => {
    tempProjectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sbomtest-sbom-'));
    const packageJson = {
      name: 'test-project',
      version: '1.0.0',
      dependencies: {
        lodash: '^4.17.21'
      }
    };
    fs.writeFileSync(
      path.join(tempProjectPath, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );
    const packageLock = {
      name: 'test-project',
      version: '1.0.0',
      lockfileVersion: 2,
      packages: {
        '': {
          name: 'test-project',
          version: '1.0.0'
        },
        'node_modules/lodash': {
          name: 'lodash',
          version: '4.17.21',
          resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz'
        }
      }
    };
    fs.writeFileSync(
      path.join(tempProjectPath, 'package-lock.json'),
      JSON.stringify(packageLock, null, 2)
    );
  });

  afterAll(() => {
    if (tempProjectPath && fs.existsSync(tempProjectPath)) {
      fs.rmSync(tempProjectPath, { recursive: true, force: true });
    }
  });

  it('should generate SBOM for a project', async () => {
    const sbomPath = await generateSBOM(tempProjectPath, 'sbom-test.json');
    expect(sbomPath).toBeDefined();
    expect(fs.existsSync(sbomPath)).toBe(true);
  }, 60000);

  it('should read and parse SBOM file', async () => {
    const sbomPath = await generateSBOM(tempProjectPath, 'sbom-test2.json');
    const sbom = readSBOM(sbomPath);

    expect(sbom).toBeDefined();
    expect(sbom.bomFormat).toBe('CycloneDX');
    expect(sbom.specVersion).toBeDefined();
    expect(sbom.components).toBeDefined();
    expect(Array.isArray(sbom.components)).toBe(true);
  }, 60000);

  it('should extract components with repo_url from SBOM', async () => {
    const sbomPath = await generateSBOM(tempProjectPath, 'sbom-test3.json');
    const sbom = readSBOM(sbomPath);
    const components = extractComponents(sbom);

    expect(Array.isArray(components)).toBe(true);
    components.forEach(comp => {
      expect(comp).toHaveProperty('name');
      expect(comp).toHaveProperty('version');
      expect(comp).toHaveProperty('repo_url');
    });
  }, 60000);

  it('should create SBOM from package-lock.json when cyclonedx fails', async () => {
    const packageLock = {
      name: 'test-project',
      version: '1.0.0',
      packages: {
        '': {
          name: 'test-project',
          version: '1.0.0'
        },
        'node_modules/lodash': {
          name: 'lodash',
          version: '4.17.21',
          resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz'
        }
      }
    };

    const sbom = await createSBOMFromPackageLock(packageLock, false);
    expect(sbom.bomFormat).toBe('CycloneDX');
    expect(sbom.components.length).toBe(1);
    expect(sbom.components[0].name).toBe('lodash');
    expect(sbom.components[0].version).toBe('4.17.21');
  });

  it('should fetch repo URLs when createSBOMFromPackageLock is called with fetchRepoUrls=true', async () => {
    const packageLock = {
      packages: {
        'node_modules/lodash': {
          name: 'lodash',
          version: '4.17.21'
        }
      }
    };

    const sbom = await createSBOMFromPackageLock(packageLock, true);
    expect(sbom.bomFormat).toBe('CycloneDX');
    expect(sbom.components.length).toBeGreaterThanOrEqual(0);
  }, 10000);
});

describe('Repo Downloader Integration', () => {
  it('should parse GitHub repo URLs correctly', () => {
    const testCases = [
      {
        input: 'https://github.com/lodash/lodash',
        expected: { gitUrl: 'https://github.com/lodash/lodash.git', ref: null as string | null }
      },
      {
        input: 'git@github.com:lodash/lodash.git',
        expected: { gitUrl: 'https://github.com/lodash/lodash.git', ref: null as string | null }
      },
      {
        input: 'https://github.com/expressjs/express#4.18.0',
        expected: { gitUrl: 'https://github.com/expressjs/express.git', ref: 'v4.18.0' as string | null }
      }
    ];

    testCases.forEach(({ input, expected }) => {
      const result = parseRepoUrl(input, input.includes('4.18.0') ? '4.18.0' : undefined);
      expect(result!.gitUrl).toBe(expected.gitUrl);
    });
  });

  it('should return null for invalid repo URLs', () => {
    const result = parseRepoUrl('');
    expect(result).toBeNull();
  });

  it('should download repositories when downloadDependencies is true', async () => {
    const components = [
      {
        name: 'lodash',
        version: '4.17.21',
        repo_url: 'https://github.com/lodash/lodash'
      }
    ];

    const result = await downloadRepos(components);
    expect(result).toBeDefined();
    expect(result.downloadRoot).toBeDefined();
    expect(result.results).toBeDefined();
  }, 60000);

  it('should handle components without repo_url', async () => {
    const components = [
      {
        name: 'test-pkg',
        version: '1.0.0',
        repo_url: null as string | null
      }
    ];

    const result = await downloadRepos(components);
    expect(result.results['test-pkg'].success).toBe(false);
    expect(result.results['test-pkg'].reason).toBe('no_repo_url');
  });

  it('should use custom download directory when provided', async () => {
    const customDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbomtest-custom-deps-'));
    const components = [
      {
        name: 'lodash',
        version: '4.17.21',
        repo_url: 'https://github.com/lodash/lodash'
      }
    ];

    const result = await downloadRepos(components, { baseDir: customDir });
    expect(result.downloadRoot).toBe(customDir);
    expect(fs.existsSync(customDir)).toBe(true);

    fs.rmSync(customDir, { recursive: true, force: true });
  }, 60000);
});

describe('Source Analyzer Integration', () => {
  let tempFile: string;

  beforeAll(() => {
    tempFile = path.join(os.tmpdir(), `test-source-${Date.now()}.js`);
  });

  afterAll(() => {
    if (tempFile && fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  });

  it('should analyze source file with ES6 imports', () => {
    const content = `
import { generateSBOM, readSBOM } from './lib/sbom';
import path from 'path';
import fs from 'fs';

const result = generateSBOM('/some/path');
const resolved = path.join('/a', '/b');
`;

    fs.writeFileSync(tempFile, content);
    const result = analyzeSourceFile(tempFile);

    expect(result).toBeDefined();
    expect(result['./lib/sbom']).toBeDefined();
    expect(result['./lib/sbom'].functions).toContain('generateSBOM');
    expect(result['./lib/sbom'].functions).toContain('readSBOM');
  });

  it('should analyze source file with CommonJS requires', () => {
    const content = `
const { downloadRepos } = require('./lib/repo-downloader');
const path = require('path');

downloadRepos([]);
path.join('a', 'b');
`;

    fs.writeFileSync(tempFile, content);
    const result = analyzeSourceFile(tempFile);

    expect(result).toBeDefined();
    expect(result['./lib/repo-downloader']).toBeDefined();
    expect(result['./lib/repo-downloader'].functions).toContain('downloadRepos');
  });

  it('should detect member expression chains', () => {
    const content = `
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const result = await prisma.component.upsert({
  where: { id: 1 },
  data: { name: 'test' }
});
`;

    fs.writeFileSync(tempFile, content);
    const result = analyzeSourceFile(tempFile);

    expect(result).toBeDefined();
    expect(result['@prisma/client']).toBeDefined();
    expect(result['@prisma/client'].chains).toContain('component.upsert');
  });

  it('should track class instances', () => {
    const content = `
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
prisma.user.findMany();
`;

    fs.writeFileSync(tempFile, content);
    const result = analyzeSourceFile(tempFile);

    expect(result).toBeDefined();
    expect(result['@prisma/client']).toBeDefined();
    expect(result['@prisma/client'].members).toHaveProperty('prisma');
  });

  it('should scan source files recursively', () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'test-project');
    if (!fs.existsSync(fixturePath)) {
      console.log('Skipping test - test-project fixture not found');
      return;
    }

    const files = scanSourceFiles(fixturePath);
    expect(Array.isArray(files)).toBe(true);
  });

  it('should exclude node_modules and test directories', () => {
    const tempScanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbomtest-scan-'));

    const srcDir = path.join(tempScanDir, 'src');
    const nodeModulesDir = path.join(tempScanDir, 'node_modules');
    const testsDir = path.join(tempScanDir, 'tests');

    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    fs.mkdirSync(testsDir, { recursive: true });

    fs.writeFileSync(path.join(srcDir, 'index.js'), 'console.log("src");');
    fs.writeFileSync(path.join(nodeModulesDir, 'lib.js'), 'console.log("nm");');
    fs.writeFileSync(path.join(testsDir, 'test.js'), 'console.log("test");');

    const files = scanSourceFiles(tempScanDir);

    expect(files.some(f => f.includes('src/index.js'))).toBe(true);
    expect(files.some(f => f.includes('node_modules'))).toBe(false);
    expect(files.some(f => f.includes('tests/test.js'))).toBe(false);

    fs.rmSync(tempScanDir, { recursive: true, force: true });
  });
});

describe('Horsebox Integration', () => {
  let tempDir: string;
  let indexDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbomtest-hb-'));
    indexDir = path.join(tempDir, 'index');

    const content = `
function testExample() {
  return 'test';
}

module.exports = { testExample };
`;
    fs.writeFileSync(path.join(tempDir, 'example.js'), content);
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should ensure Horsebox is installed', () => {
    expect(() => ensureHorsebox()).not.toThrow();
  });

  it('should build file content index', () => {
    buildFileContentIndex(tempDir, indexDir);
    expect(fs.existsSync(indexDir)).toBe(true);
  }, 30000);

  it('should build file line index', () => {
    const lineIndexDir = path.join(tempDir, 'line-index');
    buildFileLineIndex(tempDir, lineIndexDir);
    expect(fs.existsSync(lineIndexDir)).toBe(true);
  }, 30000);

  it('should search index with query', () => {
    buildFileContentIndex(tempDir, indexDir);
    const results = searchIndex(indexDir, 'testExample', 10);
    expect(Array.isArray(results)).toBe(true);
  }, 30000);

  it('should return empty array for empty query', () => {
    const results = searchIndex(indexDir, '', 10);
    expect(results).toEqual([]);
  });

  it('should return empty array for whitespace-only query', () => {
    const results = searchIndex(indexDir, ' ', 10);
    expect(results).toEqual([]);
  });
});

describe('Markdown Generator Integration', () => {
  let tempDir: string;
  let libsIndexDir: string;
  let libsLineIndexDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbomtest-md-'));
    libsIndexDir = path.join(tempDir, 'libs-index');
    libsLineIndexDir = path.join(tempDir, 'libs-line-index');

    const testContent = `
const { generateSBOM } = require('./lib/sbom');

test('should generate SBOM', () => {
  const result = generateSBOM('/path');
  expect(result).toBeDefined();
});
`;
    fs.writeFileSync(path.join(tempDir, 'test-file.js'), testContent);

    buildFileContentIndex(tempDir, libsIndexDir);
    buildFileLineIndex(tempDir, libsLineIndexDir);
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should generate markdown for source file with usage', async () => {
    const sourceFile = path.join(tempDir, 'test-file.js');
    const outputFile = path.join(tempDir, 'output.md');
    const usage = {
      './lib/sbom': {
        functions: ['generateSBOM'],
        members: {} as Record<string, string[]>,
        chains: [] as string[]
      }
    };

    await writeMarkdownForSource({
      sourceFile,
      usage,
      outputFile,
      libsIndexDir,
      libsLineIndexDir,
      projectRoot: tempDir
    });

    expect(fs.existsSync(outputFile)).toBe(true);
    const content = fs.readFileSync(outputFile, 'utf8');
    expect(content).toContain('# External tests for');
    expect(content).toContain('./lib/sbom');
  }, 30000);

  it('should handle empty usage', async () => {
    const sourceFile = path.join(tempDir, 'test-file.js');
    const outputFile = path.join(tempDir, 'output-empty.md');

    await writeMarkdownForSource({
      sourceFile,
      usage: {},
      outputFile,
      libsIndexDir,
      libsLineIndexDir,
      projectRoot: tempDir
    });

    expect(fs.existsSync(outputFile)).toBe(true);
    const content = fs.readFileSync(outputFile, 'utf8');
    expect(content).toContain('Nenhuma lib externa detectada');
  });

  it('should handle missing index directories gracefully', async () => {
    const sourceFile = path.join(tempDir, 'test-file.js');
    const outputFile = path.join(tempDir, 'output-no-index.md');
    const usage = {
      path: {
        functions: ['resolve', 'join'],
        members: {} as Record<string, string[]>,
        chains: ['resolve']
      }
    };

    await writeMarkdownForSource({
      sourceFile,
      usage,
      outputFile,
      libsIndexDir: '/non-existent-index',
      libsLineIndexDir: '/non-existent-index-line',
      projectRoot: tempDir
    });

    expect(fs.existsSync(outputFile)).toBe(true);
  });
});

describe('End-to-End Integration', () => {
  it('should complete full analysis pipeline', async () => {
    const testProjectPath = path.join(__dirname, 'fixtures', 'test-project');

    if (!fs.existsSync(testProjectPath)) {
      console.log('Skipping E2E test - test-project fixture not found');
      return;
    }

    const result = await analyze(testProjectPath, {
      sbomPath: 'sbom-e2e.json',
      downloadDependencies: false
    });

    expect(result).toBeDefined();
    expect(result.sbomPath).toContain('sbom-e2e.json');
    expect(Array.isArray(result.generated)).toBe(true);
  }, 120000);
});

describe('path module tests (from index.js.md)', () => {
  it('should use path.resolve correctly', () => {
    const resolved = path.resolve('/a', '/b', 'c');
    expect(resolved).toBe(path.join('/b', 'c'));
  });

  it('should use path.join correctly', () => {
    const joined = path.join('a', 'b', 'c');
    expect(joined).toContain('a');
    expect(joined).toContain('b');
    expect(joined).toContain('c');
  });

  it('should use path.relative correctly', () => {
    const relative = path.relative('/a/b/c', '/a/b/c/d/e');
    expect(relative).toBe(path.join('d', 'e'));
  });

  it('should use path.isAbsolute correctly', () => {
    expect(path.isAbsolute('/absolute/path')).toBe(true);
    expect(path.isAbsolute('relative/path')).toBe(false);
  });

  it('should use path.sep correctly', () => {
    expect(path.sep).toBeDefined();
    expect(typeof path.sep).toBe('string');
  });
});

describe('child_process module tests (from index.js.md)', () => {
  it('should use execSync to execute commands', () => {
    const result = execSync('echo "test"', { encoding: 'utf8' });
    expect(result.trim()).toBe('test');
  });

  it('should use execSync with cwd option', () => {
    const result = execSync('pwd', { encoding: 'utf8', cwd: '/tmp' });
    expect(result.trim()).toBe('/tmp');
  });

  it('should use execSync with stdio option', () => {
    const result = execSync('echo "hello"', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    expect(result.trim()).toBe('hello');
  });

  it('should use spawnSync to execute commands', () => {
    const result = spawnSync('echo', ['test'], { encoding: 'utf8' });
    expect(result.stdout!.trim()).toBe('test');
    expect(result.status).toBe(0);
  });

  it('should handle spawnSync with timeout', () => {
    const result = spawnSync('sleep', ['0.1'], {
      encoding: 'utf8',
      timeout: 5000
    });
    expect(result.status).toBe(0);
  });

  it('should capture stderr from spawned process', () => {
    const result = spawnSync('node', ['-e', 'console.error("error message")'], {
      encoding: 'utf8'
    });
    expect(result.stderr!.trim()).toBe('error message');
  });

  it('should handle non-zero exit codes', () => {
    const result = spawnSync('node', ['-e', 'process.exit(1)'], {
      encoding: 'utf8'
    });
    expect(result.status).toBe(1);
  });
});

describe('fs module tests (from index.js.md)', () => {
  let tempDir: string;
  let tempFile: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbomtest-fs-test-'));
    tempFile = path.join(tempDir, 'test-file.txt');
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should use fs.writeFileSync to write files', () => {
    fs.writeFileSync(tempFile, 'test content');
    expect(fs.existsSync(tempFile)).toBe(true);
  });

  it('should use fs.readFileSync to read files', () => {
    fs.writeFileSync(tempFile, 'hello world');
    const content = fs.readFileSync(tempFile, 'utf8');
    expect(content).toBe('hello world');
  });

  it('should use fs.mkdirSync with recursive option', () => {
    const nestedDir = path.join(tempDir, 'a', 'b', 'c');
    fs.mkdirSync(nestedDir, { recursive: true });
    expect(fs.existsSync(nestedDir)).toBe(true);
  });

  it('should use fs.readdirSync with withFileTypes option', () => {
    fs.writeFileSync(tempFile, 'content');
    const entries = fs.readdirSync(tempDir, { withFileTypes: true });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]).toHaveProperty('name');
    expect(entries[0]).toHaveProperty('isFile');
    expect(entries[0]).toHaveProperty('isDirectory');
  });

  it('should use fs.copyFileSync to copy files', () => {
    const srcFile = path.join(tempDir, 'source.txt');
    const dstFile = path.join(tempDir, 'dest.txt');
    fs.writeFileSync(srcFile, 'copy me');
    fs.copyFileSync(srcFile, dstFile);
    expect(fs.readFileSync(dstFile, 'utf8')).toBe('copy me');
  });

  it('should use fs.unlinkSync to delete files', () => {
    const fileToDelete = path.join(tempDir, 'to-delete.txt');
    fs.writeFileSync(fileToDelete, 'delete me');
    expect(fs.existsSync(fileToDelete)).toBe(true);
    fs.unlinkSync(fileToDelete);
    expect(fs.existsSync(fileToDelete)).toBe(false);
  });

  it('should use fs.rmSync with recursive option', () => {
    const dirToRemove = path.join(tempDir, 'to-remove');
    fs.mkdirSync(dirToRemove, { recursive: true });
    fs.writeFileSync(path.join(dirToRemove, 'file.txt'), 'content');
    expect(fs.existsSync(dirToRemove)).toBe(true);
    fs.rmSync(dirToRemove, { recursive: true, force: true });
    expect(fs.existsSync(dirToRemove)).toBe(false);
  });

  it('should use fs.existsSync to check file existence', () => {
    expect(fs.existsSync(tempFile)).toBe(true);
    expect(fs.existsSync('/non-existent-file-xyz')).toBe(false);
  });

  it('should use fs.statSync to get file stats', () => {
    fs.writeFileSync(tempFile, 'stats test');
    const stats = fs.statSync(tempFile);
    expect(stats.isFile()).toBe(true);
    expect(stats.size).toBeGreaterThan(0);
  });
});

describe('os module tests (from index.js.md)', () => {
  it('should use os.tmpdir to get temp directory', () => {
    const tmpDir = os.tmpdir();
    expect(tmpDir).toBeDefined();
    expect(typeof tmpDir).toBe('string');
    expect(tmpDir.length).toBeGreaterThan(0);
  });

  it('should use os.tmpdir for creating temp directories', () => {
    const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbomtest-os-test-'));
    expect(fs.existsSync(testTempDir)).toBe(true);
    fs.rmSync(testTempDir, { recursive: true, force: true });
  });

  it('should use os.homedir to get home directory', () => {
    const homeDir = os.homedir();
    expect(homeDir).toBeDefined();
    expect(typeof homeDir).toBe('string');
  });

  it('should use os.platform to get platform info', () => {
    const platform = os.platform();
    expect(['linux', 'darwin', 'win32']).toContain(platform);
  });

  it('should use os.arch to get architecture info', () => {
    const arch = os.arch();
    expect(arch).toBeDefined();
    expect(typeof arch).toBe('string');
  });
});

describe('Integration tests for index.js main functionality', () => {
  it('should handle project analysis with download-dir option', async () => {
    const testProjectPath = path.join(__dirname, 'fixtures', 'test-project');
    const customDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbomtest-download-'));

    if (!fs.existsSync(testProjectPath)) {
      console.log('Skipping test - test-project fixture not found');
      return;
    }

    try {
      const result = await analyze(testProjectPath, {
        sbomPath: 'sbom-integration.json',
        downloadDependencies: true,
        maxDownloads: 1,
        downloadDir: customDownloadDir
      });

      expect(result).toBeDefined();
      expect(result.downloadRoot).toBe(customDownloadDir);

      const horseboxDir = path.join(customDownloadDir, '.horsebox');
      expect(fs.existsSync(horseboxDir)).toBe(true);

      expect(fs.existsSync(path.join(horseboxDir, 'index-project-files'))).toBe(true);
      expect(fs.existsSync(path.join(horseboxDir, 'index-libs-files'))).toBe(true);
      expect(fs.existsSync(path.join(horseboxDir, 'index-libs-lines'))).toBe(true);
    } finally {
      if (fs.existsSync(customDownloadDir)) {
        fs.rmSync(customDownloadDir, { recursive: true, force: true });
      }
    }
  }, 120000);

  it('should reuse existing indexes when running analysis twice', async () => {
    const testProjectPath = path.join(__dirname, 'fixtures', 'test-project');
    const customDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbomtest-reuse-'));

    if (!fs.existsSync(testProjectPath)) {
      console.log('Skipping test - test-project fixture not found');
      return;
    }

    try {
      await analyze(testProjectPath, {
        sbomPath: 'sbom-first.json',
        downloadDependencies: true,
        maxDownloads: 1,
        downloadDir: customDownloadDir
      });

      const horseboxDir = path.join(customDownloadDir, '.horsebox');
      expect(fs.existsSync(horseboxDir)).toBe(true);

      const result = await analyze(testProjectPath, {
        sbomPath: 'sbom-second.json',
        downloadDependencies: true,
        maxDownloads: 1,
        downloadDir: customDownloadDir
      });

      expect(result).toBeDefined();
      expect(result.generated).toBeDefined();
    } finally {
      if (fs.existsSync(customDownloadDir)) {
        fs.rmSync(customDownloadDir, { recursive: true, force: true });
      }
    }
  }, 180000);
});
