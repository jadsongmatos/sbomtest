#!/usr/bin/env bun

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';

import { generateSBOM, readSBOM, extractComponents } from './lib/sbom';
import type { ExtractedComponent, SBOM } from './lib/sbom';
import { downloadRepos } from './lib/repo-downloader';
import { scanSourceFiles, analyzeSourceFile } from './lib/source-analyzer';
import type { LibraryUsage as SourceLibraryUsage, ScanOptions } from './lib/source-analyzer';
import { ensureHorsebox, buildFileContentIndex, buildFileLineIndex } from './lib/horsebox';
import { writeMarkdownForSource } from './lib/markdown-generator';
import type { WriteMarkdownOptions } from './lib/markdown-generator';

interface AnalyzeOptions {
  sbomPath?: string;
  sourceFile?: string;
  downloadDependencies?: boolean;
  maxDownloads?: number;
  respectGitIgnore?: boolean;
  downloadDir?: string | null;
  directOnly?: boolean;
  includePatterns?: string[] | null;
  excludePatterns?: string[] | null;
}

interface AnalyzeResult {
  sbomPath: string;
  generated: string[];
  downloadRoot: string | null;
}

/**
 * Creates a filtered copy of the project directory, excluding problematic folders
 * to avoid Horsebox indexing errors.
 */
function createFilteredProjectCopy(projectPath: string, workRoot: string): string {
  const filteredDir = path.join(workRoot, 'filtered-project');

  // Use restrictive permissions (owner-only) to avoid security issues with world-writable directories
  fs.mkdirSync(filteredDir, { recursive: true, mode: 0o700 });

  // Directories and patterns to exclude
  const excludePatterns: string[] = [
    'node_modules',
    'sbomtest',
    '.git',
    'coverage',
    'ref',
    '.vscode',
    '.idea',
    '*.log',
    '*.db',
    '*.cdx.json',
  ];

  // Build rsync exclude arguments
  const excludeArgs = excludePatterns.flatMap(pattern => ['--exclude', pattern]);

  try {
    // Use rsync to copy only relevant files (respects .gitignore implicitly by excluding common patterns)
    // Using spawnSync instead of execSync to avoid shell injection vulnerabilities
    const rsyncArgs = [
      '-av',
      `--filter=':- .gitignore'`,
      ...excludeArgs,
      `${projectPath}/`,
      `${filteredDir}/`,
    ];

    const result = spawnSync('rsync', rsyncArgs, {
      stdio: 'pipe',
      timeout: 60000, // 1 minute timeout
    });

    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`rsync exited with code ${result.status}`);
    }
  } catch (error) {
    // Fallback: simple copy if rsync fails
    console.warn('rsync failed, using fallback copy method...');
    copyDirectoryRecursive(projectPath, filteredDir, excludePatterns);
  }

  return filteredDir;
}

/**
 * Fallback recursive copy that excludes specified patterns
 */
function copyDirectoryRecursive(src: string, dst: string, excludePatterns: string[]): void {
  // Use restrictive permissions (owner-only) to avoid security issues with world-writable directories
  fs.mkdirSync(dst, { recursive: true, mode: 0o700 });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);

    // Skip excluded directories
    if (excludePatterns.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
        return regex.test(entry.name);
      }
      return entry.name === pattern;
    })) {
      continue;
    }

    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, dstPath, excludePatterns);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

async function analyze(projectPath: string, options: AnalyzeOptions = {}): Promise<AnalyzeResult> {
  const {
    sbomPath = 'sbom.cdx.json',
    sourceFile,
    downloadDependencies = false,
    maxDownloads = -1,
    respectGitIgnore = true,
    downloadDir = null,
    directOnly = false,
    includePatterns = null,
    excludePatterns = null,
  } = options;

  const resolvedProjectPath = path.resolve(projectPath || process.cwd());

  if (!fs.existsSync(resolvedProjectPath)) {
    throw new Error(`Project path does not exist: ${resolvedProjectPath}`);
  }

  ensureHorsebox();

  console.log('Generating SBOM...');
  const generatedSbomPath = await generateSBOM(resolvedProjectPath, sbomPath, true, directOnly);

  console.log('Reading SBOM...');
  const sbom: SBOM = readSBOM(generatedSbomPath);

  const allComponents: ExtractedComponent[] = extractComponents(sbom).filter(c => c.repo_url);
  console.log(`Found ${allComponents.length} components with repo_url`);

  let downloadInfo: { downloadRoot: string | null; results: Record<string, { success: boolean; path: string | null; repo?: string; identifier?: string; cached?: boolean; reason?: string }> } = {
    downloadRoot: null,
    results: {},
  };

  if (downloadDependencies) {
    const componentsToDownload = maxDownloads > 0
      ? allComponents.slice(0, maxDownloads)
      : allComponents;
    const countDesc = maxDownloads > 0 ? `up to ${maxDownloads}` : 'all';
    console.log(`Downloading ${countDesc} dependency repositories...`);

    // Resolve downloadDir relative to projectPath if it's provided and relative
    let resolvedDownloadDir = downloadDir;
    if (downloadDir && !path.isAbsolute(downloadDir)) {
      resolvedDownloadDir = path.resolve(resolvedProjectPath, downloadDir);
    }

    downloadInfo = await downloadRepos(
      componentsToDownload as Array<{ name: string; version?: string; repo_url: string }>,
      {
      baseDir: resolvedDownloadDir ?? undefined,
    });
  }

  // Use download directory for Horsebox indexes if available, otherwise use temp directory
  const indexRoot = downloadInfo.downloadRoot
    ? downloadInfo.downloadRoot
    : fs.mkdtempSync(path.join(os.tmpdir(), 'sbomtest-work-'));

  const projectIndexDir = path.join(indexRoot, '.horsebox', 'index-project-files');
  const libsIndexDir = path.join(indexRoot, '.horsebox', 'index-libs-files');
  const libsLineIndexDir = path.join(indexRoot, '.horsebox', 'index-libs-lines');

  // Create index directories
  // Use restrictive permissions (owner-only) to avoid security issues with world-writable directories
  fs.mkdirSync(projectIndexDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(libsIndexDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(libsLineIndexDir, { recursive: true, mode: 0o700 });

  // Use separate temp directory for filtered project copy to avoid recursive copy issues
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sbomtest-work-'));

  // Create filtered project copy to avoid indexing node_modules and other problematic directories
  console.log('Creating filtered project copy (excluding node_modules, sbomtest/, etc.)...');
  const filteredProjectPath = createFilteredProjectCopy(resolvedProjectPath, workRoot);

  console.log('Building Horsebox index for project source files...');

  // Check if project index already exists and has content
  const projectIndexExists = fs.existsSync(projectIndexDir)
    && fs.readdirSync(projectIndexDir).length > 0;

  if (projectIndexExists) {
    console.log('Project index already exists, skipping build...');
  } else {
    buildFileContentIndex(filteredProjectPath, projectIndexDir);
  }

  if (downloadInfo.downloadRoot && fs.existsSync(downloadInfo.downloadRoot)) {
    // Check if any repositories were successfully downloaded
    const successfulDownloads = Object.values(downloadInfo.results).filter(r => r.success);

    if (successfulDownloads.length > 0) {
      console.log(`Building Horsebox index for ${successfulDownloads.length} downloaded dependencies...`);

      try {
        // Check if lib indexes already exist and have content
        const libsIndexExists = fs.existsSync(libsIndexDir)
          && fs.readdirSync(libsIndexDir).length > 0;
        const libsLineIndexExists = fs.existsSync(libsLineIndexDir)
          && fs.readdirSync(libsLineIndexDir).length > 0;

        if (!libsIndexExists) {
          buildFileContentIndex(downloadInfo.downloadRoot, libsIndexDir);
        } else {
          console.log('Libs filecontent index already exists, skipping build...');
        }

        if (!libsLineIndexExists) {
          buildFileLineIndex(downloadInfo.downloadRoot, libsLineIndexDir);
        } else {
          console.log('Libs fileline index already exists, skipping build...');
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`Warning: Failed to build index for dependencies: ${msg}`);
        console.warn('Continuing without dependency tests...');
      }
    } else {
      console.log('No dependencies were successfully downloaded, skipping dependency index...');
    }
  }

  // Determine directories to exclude from scanning (e.g., downloadDir if inside projectPath)
  const excludeDirs: string[] = [];
  if (downloadInfo.downloadRoot) {
    const relDownloadPath = path.relative(resolvedProjectPath, downloadInfo.downloadRoot);
    if (!relDownloadPath.startsWith('..') && !path.isAbsolute(relDownloadPath)) {
      // It's inside the project
      excludeDirs.push(relDownloadPath.split(path.sep)[0]);
    }
  }

  const sourceFiles = sourceFile
    ? [path.resolve(resolvedProjectPath, sourceFile)]
    : scanSourceFiles(resolvedProjectPath, {
        respectGitIgnore,
        excludeDirs,
        includePatterns,
        excludePatterns,
      });

  const generated: string[] = [];

  for (const file of sourceFiles) {
    if (!fs.existsSync(file)) {
      console.warn(`Skipping missing file: ${file}`);
      continue;
    }

    console.log(`Generating markdown for: ${path.relative(resolvedProjectPath, file)}`);

    const usage = analyzeSourceFile(file);
    const outputFile = `${file}.md`;

    await writeMarkdownForSource({
      sourceFile: file,
      usage,
      outputFile,
      libsIndexDir,
      libsLineIndexDir,
      projectRoot: resolvedProjectPath,
    });

    generated.push(path.relative(resolvedProjectPath, outputFile));
  }

  // Generate a global checklist for tracking progress
  if (generated.length > 0) {
    const checklistPath = path.join(resolvedProjectPath, 'CTEST_CHECKLIST.md');
    let checklistMd = '# CTest Analysis Checklist\n\n';
    checklistMd += `Generated on: ${new Date().toLocaleString()}\n\n`;
    checklistMd += 'Use this file to track your progress reviewing the generated external tests.\n\n';

    for (const relPath of generated) {
      // Create a relative link to the markdown file
      checklistMd += `- [ ] [${relPath}](${relPath})\n`;
    }

    fs.writeFileSync(checklistPath, checklistMd, 'utf8');
    console.log(`\nGlobal checklist created: ${path.relative(process.cwd(), checklistPath)}`);
  }

  return {
    sbomPath: generatedSbomPath,
    generated,
    downloadRoot: downloadInfo.downloadRoot,
  };
}

function showHelp(): void {
  const help = `
sbomtest - Gera arquivos .md com testes externos relevantes usando SBOM + Horsebox

USAGE:
  sbomtest <project-path> [options]

OPTIONS:
  --download-dependencies  Baixa código fonte das dependências via Git
  --download-dir=<dir>     Diretório para baixar dependências (default: cache)
  --direct-only            Analisa somente dependências diretas
  --max-downloads=<n>      Limita número de downloads de dependências
  --file=<path>            Analisa apenas um arquivo específico
  --include=<patterns>     Padrões de inclusão (separados por vírgula)
  --exclude=<patterns>     Padrões de exclusão (separados por vírgula)
  --respect-gitignore=<bool> Respeitar .gitignore (default: true)
  --help                   Mostra esta ajuda

EXAMPLES:
  sbomtest . --download-dependencies --direct-only
  sbomtest . --file=src/lib/utils.js --download-dependencies
  sbomtest . --download-dependencies --download-dir=./deps --max-downloads=5
  sbomtest . --include="src/**" --exclude="src/test/**"
`;
  console.log(help);
  process.exit(0);
}

if (typeof Bun !== 'undefined' && Bun.main === import.meta.path) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
  }

  const projectPath = args[0] || process.cwd();

  const fileArg = args.find((arg: string) => arg.startsWith('--file='));
  const includeArg = args.find((arg: string) => arg.startsWith('--include='));
  const excludeArg = args.find((arg: string) => arg.startsWith('--exclude='));
  const downloadFlag = args.includes('--download-dependencies');
  const directOnlyFlag = args.includes('--direct-only');
  const maxDownloadsArg = args.find((arg: string) => arg.startsWith('--max-downloads='));
  const respectGitIgnoreArg = args.find((arg: string) => arg.startsWith('--respect-gitignore='));
  const downloadDirArg = args.find((arg: string) => arg.startsWith('--download-dir='));

  // Default is true, only false if explicitly set to false
  let respectGitIgnore = true;
  if (respectGitIgnoreArg) {
    const value = respectGitIgnoreArg.split('=')[1].toLowerCase();
    respectGitIgnore = value !== 'false' && value !== '0' && value !== 'no';
  }

  const downloadDir = downloadDirArg ? downloadDirArg.split('=')[1] : null;

  // Parse include/exclude patterns (can be comma-separated)
  const includePatterns = includeArg ? includeArg.split('=')[1].split(',') : null;
  const excludePatterns = excludeArg ? excludeArg.split('=')[1].split(',') : null;

  analyze(projectPath, {
    sourceFile: fileArg ? fileArg.split('=')[1] : undefined,
    downloadDependencies: downloadFlag,
    maxDownloads: maxDownloadsArg ? parseInt(maxDownloadsArg.split('=')[1], 10) : -1,
    respectGitIgnore,
    downloadDir,
    directOnly: directOnlyFlag,
    includePatterns,
    excludePatterns,
  })
    .then(result => {
      console.log(`\nDone. Generated ${result.generated.length} markdown files.`);
      if (result.downloadRoot) {
        console.log(`Dependencies available at: ${result.downloadRoot}`);
      }
    })
    .catch(error => {
      console.error('Error:', error.message);
      process.exit(1);
    });
}

export { analyze };
export type { AnalyzeOptions, AnalyzeResult };
