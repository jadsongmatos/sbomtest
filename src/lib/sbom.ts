import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';
import yaml from 'js-yaml';

export interface MergeConflict {
  start: number;
  marker: string;
  middle?: number;
  separator?: number;
  end?: number;
}

export interface MergeConflictResult {
  hasMergeConflict: boolean;
  conflicts: MergeConflict[];
}

export interface PackageManager {
  type: 'npm' | 'pnpm' | 'yarn';
  lockPath: string;
}

export interface ExternalReference {
  type: string;
  url: string;
}

export interface SBOMComponent {
  type?: string;
  name: string;
  version: string;
  bomRef?: string;
  externalReferences?: ExternalReference[];
  repository?: { url: string };
}

export interface SBOM {
  bomFormat?: string;
  specVersion?: string;
  version?: number;
  components: SBOMComponent[];
}

export interface ExtractedComponent {
  name: string;
  version: string;
  repo_url: string | null;
}

interface PackageEntry {
  name: string;
  version: string;
  resolved: string | null;
}

interface NpmPackageInfo {
  repository?: string | { url: string };
  homepage?: string;
}

interface PackageLockPackage {
  name?: string;
  version?: string;
  resolved?: string;
  dependencies?: Record<string, string | { specifier: string; version: string }>;
  devDependencies?: Record<string, string | { specifier: string; version: string }>;
  optionalDependencies?: Record<string, string | { specifier: string; version: string }>;
}

interface PackageLock {
  packages?: Record<string, PackageLockPackage>;
  importers?: Record<string, PackageLockPackage>;
  type?: string;
  data?: Record<string, { version?: string; resolved?: string }>;
}

export function detectMergeConflicts (content: string): MergeConflictResult {
  const lines = content.split('\n');
  const conflicts: MergeConflict[] = [];
  let _inConflict = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('<<<<<<< ')) {
      _inConflict = true;
      conflicts.push({ start: i + 1, marker: line });
    } else if (line.startsWith('||||||| ')) {
      conflicts[conflicts.length - 1].middle = i + 1;
    } else if (line.startsWith('=======')) {
      conflicts[conflicts.length - 1].separator = i + 1;
    } else if (line.startsWith('>>>>>>> ')) {
      conflicts[conflicts.length - 1].end = i + 1;
      _inConflict = false;
    }
  }

  return { hasMergeConflict: conflicts.length > 0, conflicts };
}

export function formatMergeConflictError (filePath: string, conflicts: MergeConflict[]): string {
  let message = `Detectado merge conflict não resolvido em ${filePath}:\n\n`;
  conflicts.forEach((conflict, idx) => {
    message += `Conflito ${idx + 1}:\n`;
    message += ` Linha ${conflict.start}: ${conflict.marker}\n`;
    if (conflict.separator) {
      message += ` Linha ${conflict.separator}: separador (=======)\n`;
    }
    if (conflict.end) {
      message += ` Linha ${conflict.end}: fim do conflito\n`;
    }
    message += '\n';
  });
  message += 'Para resolver, execute:\n';
  message += ' git status # Ver conflitos pendentes\n';
  message += ' # Edite o arquivo e remova os marcadores de conflito\n';
  message += ` git add ${path.basename(filePath)}\n`;
  message += ' git commit -m "Resolve merge conflict"\n';
  return message;
}

export function detectPackageManager (projectPath: string): PackageManager | null {
  const lockFiles: Array<{ type: 'pnpm' | 'yarn' | 'npm'; name: string }> = [
    { type: 'pnpm', name: 'pnpm-lock.yaml' },
    { type: 'yarn', name: 'yarn.lock' },
    { type: 'npm', name: 'package-lock.json' }
  ];

  for (const { type, name } of lockFiles) {
    const lockPath = path.join(projectPath, name);
    if (fs.existsSync(lockPath)) {
      return { type, lockPath };
    }
  }

  return null;
}

async function fetchNpmPackageInfo (packageName: string): Promise<NpmPackageInfo | null> {
  return new Promise<NpmPackageInfo | null>((resolve) => {
    const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
    https.get(url, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) {
        resolve(null);
        return;
      }
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data) as NpmPackageInfo);
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

export async function createSBOMFromPackageLock (
  packageLock: PackageLock,
  fetchRepoUrls: boolean = false,
  omitTransitive: boolean = false
): Promise<SBOM> {
  const components: SBOMComponent[] = [];
  const packageNames: PackageEntry[] = [];
  const directDependencies = new Set<string>();

  if (omitTransitive) {
    const rootPkg = packageLock.packages ? packageLock.packages[''] : null;
    if (rootPkg && rootPkg.dependencies) {
      Object.keys(rootPkg.dependencies).forEach(d => directDependencies.add(d));
    }
    if (packageLock.importers && packageLock.importers['.']) {
      const rootDeps = packageLock.importers['.'].dependencies || {};
      const rootDevDeps = packageLock.importers['.'].devDependencies || {};
      Object.keys(rootDeps).forEach(d => directDependencies.add(d));
      Object.keys(rootDevDeps).forEach(d => directDependencies.add(d));
    }
  }

  if (packageLock.packages) {
    for (const [pkgPath, pkg] of Object.entries(packageLock.packages)) {
      if (pkgPath === '') {
        continue;
      }
      const name = pkg.name || pkgPath.replace(/^node_modules\//, '').split('/node_modules/').pop()!;
      if (name && pkg.version) {
        if (omitTransitive && !directDependencies.has(name)) {
          continue;
        }
        packageNames.push({ name, version: pkg.version, resolved: pkg.resolved || null });
      }
    }
  }

  if (packageLock.importers) {
    for (const [, importer] of Object.entries(packageLock.importers)) {
      const deps: Record<string, string | PackageLockPackage> = {
        ...(importer.dependencies || {}),
        ...(importer.devDependencies || {}),
        ...(importer.optionalDependencies || {})
      };
      for (const [name, depInfo] of Object.entries(deps)) {
        if (typeof depInfo === 'string') {
          packageNames.push({ name, version: depInfo, resolved: null });
        } else if (depInfo && typeof depInfo === 'object' && (depInfo as PackageLockPackage).version) {
          packageNames.push({ name, version: (depInfo as PackageLockPackage).version!, resolved: null });
        }
      }
    }
  }

  if (packageLock.type === 'yarn' && packageLock.data) {
    for (const [name, info] of Object.entries(packageLock.data)) {
      if (info.version) {
        packageNames.push({ name, version: info.version, resolved: info.resolved || null });
      }
    }
  }

  if (fetchRepoUrls && packageNames.length > 0) {
    for (const { name, version, resolved } of packageNames) {
      const pkgInfo = await fetchNpmPackageInfo(name);
      let repoUrl: string | null = null;
      if (pkgInfo) {
        if (typeof pkgInfo.repository === 'string') {
          repoUrl = pkgInfo.repository;
        } else if (pkgInfo.repository && pkgInfo.repository.url) {
          repoUrl = pkgInfo.repository.url;
        }
        if (!repoUrl && pkgInfo.homepage) {
          repoUrl = pkgInfo.homepage;
        }
      }
      components.push({
        type: 'library',
        name,
        version,
        bomRef: `pkg:npm/${name}@${version}`,
        externalReferences: resolved ? [{ type: 'distribution', url: resolved }] : [],
        ...(repoUrl ? { repository: { url: repoUrl } } : {})
      });
    }
  } else {
    for (const { name, version, resolved } of packageNames) {
      components.push({
        type: 'library',
        name,
        version,
        bomRef: `pkg:npm/${name}@${version}`,
        externalReferences: resolved ? [{ type: 'distribution', url: resolved }] : []
      });
    }
  }

  return { bomFormat: 'CycloneDX', specVersion: '1.4', version: 1, components };
}

export function findPackageLockPath (startDir: string): string | null {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;
  const lockFileNames = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];

  while (current !== root) {
    for (const lockName of lockFileNames) {
      const lockPath = path.join(current, lockName);
      if (fs.existsSync(lockPath)) {
        return lockPath;
      }
    }
    current = path.dirname(current);
  }

  return null;
}

export async function generateSBOM (
  projectPath: string,
  outputFile: string = 'sbom.cdx.json',
  fetchRepoUrls: boolean = false,
  omitTransitive: boolean = false
): Promise<string> {
  const outputFilePath = path.resolve(projectPath, outputFile);
  const pm = detectPackageManager(projectPath);

  if (!pm) {
    throw new Error('Nenhum gerenciador de pacotes detectado. Certifique-se de que o projeto possui pnpm-lock.yaml, yarn.lock ou package-lock.json');
  }

  try {
    let cycloneCmd: string;
    switch (pm.type) {
      case 'pnpm':
        cycloneCmd = 'npx @cyclonedx/cyclonedx-pnpm';
        break;
      case 'yarn':
        cycloneCmd = 'npx @cyclonedx/cyclonedx-yarn';
        break;
      case 'npm':
      default:
        cycloneCmd = 'npx @cyclonedx/cyclonedx-npm';
        break;
    }

    const omitArgs = omitTransitive ? '--omit dev --omit optional --omit peer' : '';
    execSync(
      `${cycloneCmd} ${omitArgs} --output-format JSON --output-file "${outputFilePath}"`,
      {
        cwd: projectPath,
        stdio: 'pipe',
        env: { ...process.env, FORCE_COLOR: '0' } as NodeJS.ProcessEnv
      }
    );

    const sbom: SBOM = JSON.parse(fs.readFileSync(outputFilePath, 'utf8'));
    if (!sbom.components) {
      sbom.components = [];
    }

    if (omitTransitive) {
      const packageJsonPath = path.join(projectPath, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const pkgJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { dependencies?: Record<string, string> };
        const directDeps = new Set<string>(Object.keys(pkgJson.dependencies || {}));

        if (sbom.components.length > 0) {
          sbom.components = sbom.components.filter(c => directDeps.has(c.name));
        }

        if (sbom.components.length === 0 && directDeps.size > 0) {
          const lockPath = findPackageLockPath(projectPath);
          if (lockPath) {
            const packageLock: PackageLock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
            const fallbackSBOM = await createSBOMFromPackageLock(packageLock, false, true);
            sbom.components = fallbackSBOM.components;
          } else {
            for (const name of directDeps) {
              sbom.components.push({ type: 'library', name, version: 'unknown' });
            }
          }
        }
      }
    }

    if (fetchRepoUrls && sbom.components && sbom.components.length > 0) {
      for (const component of sbom.components) {
        let hasRepo = false;
        if (component.externalReferences) {
          hasRepo = component.externalReferences.some(ref => ref.type === 'vcs');
        }
        if (!hasRepo && component.repository && component.repository.url) {
          hasRepo = true;
        }
        if (!hasRepo) {
          const pkgInfo = await fetchNpmPackageInfo(component.name);
          if (pkgInfo) {
            let repoUrl: string | null = null;
            if (typeof pkgInfo.repository === 'string') {
              repoUrl = pkgInfo.repository;
            } else if (pkgInfo.repository && pkgInfo.repository.url) {
              repoUrl = pkgInfo.repository.url;
            } else if (pkgInfo.homepage) {
              repoUrl = pkgInfo.homepage;
            }
            if (repoUrl) {
              if (!component.externalReferences) {
                component.externalReferences = [];
              }
              component.externalReferences.push({ type: 'vcs', url: repoUrl });
            }
          }
        }
      }
    }

    fs.writeFileSync(outputFilePath, JSON.stringify(sbom, null, 2));
  } catch (error) {
    const packageLockPath = findPackageLockPath(projectPath);
    if (!packageLockPath) {
      throw new Error(`SBOM generation failed and no lock file (package-lock.json, pnpm-lock.yaml, yarn.lock) found at ${projectPath} or parent directories: ${(error as Error).message}`);
    }

    console.warn(`Using lock file from ${path.dirname(packageLockPath)} (monorepo fallback)`);

    let packageLock: PackageLock;
    const lockFileContent = fs.readFileSync(packageLockPath, 'utf8');

    if (packageLockPath.endsWith('.yaml') || packageLockPath.endsWith('.yml')) {
      try {
        packageLock = yaml.load(lockFileContent) as PackageLock;
      } catch (yamlError) {
        const { hasMergeConflict, conflicts } = detectMergeConflicts(lockFileContent);
        if (hasMergeConflict) {
          throw new Error(formatMergeConflictError(packageLockPath, conflicts));
        }
        throw new Error(`Erro ao fazer parsing do arquivo YAML ${packageLockPath}: ${(yamlError as Error).message}`);
      }
    } else {
      try {
        packageLock = JSON.parse(lockFileContent) as PackageLock;
      } catch (jsonError) {
        const { hasMergeConflict, conflicts } = detectMergeConflicts(lockFileContent);
        if (hasMergeConflict) {
          throw new Error(formatMergeConflictError(packageLockPath, conflicts));
        }
        throw new Error(`Erro ao fazer parsing do arquivo JSON ${packageLockPath} (linha ${(jsonError as Error).message})`);
      }
    }

    const packageJsonPath = path.join(projectPath, 'package.json');
    let directDeps: Set<string> | null = null;
    if (fs.existsSync(packageJsonPath)) {
      const pkgJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { dependencies?: Record<string, string> };
      directDeps = new Set<string>(Object.keys(pkgJson.dependencies || {}));
    }

    const minimalSBOM = await createSBOMFromPackageLock(packageLock, fetchRepoUrls, omitTransitive);
    if (directDeps && packageLockPath !== path.join(projectPath, 'package-lock.json')) {
      minimalSBOM.components = minimalSBOM.components.filter(c => directDeps.has(c.name));
    }

    fs.writeFileSync(outputFilePath, JSON.stringify(minimalSBOM, null, 2));
  }

  return outputFilePath;
}

export function readSBOM (sbomPath: string): SBOM {
  const content = fs.readFileSync(sbomPath, 'utf8');
  try {
    return JSON.parse(content) as SBOM;
  } catch (error) {
    const { hasMergeConflict, conflicts } = detectMergeConflicts(content);
    if (hasMergeConflict) {
      throw new Error(formatMergeConflictError(sbomPath, conflicts));
    }
    throw new Error(`Erro ao fazer parsing do SBOM em ${sbomPath}: ${(error as Error).message}`);
  }
}

export function extractComponents (sbom: Partial<SBOM>): ExtractedComponent[] {
  const components = sbom.components || [];
  return components.map((component): ExtractedComponent => {
    let repoUrl: string | null = null;
    if (component.externalReferences) {
      const vcsRef = component.externalReferences.find(ref => ref.type === 'vcs');
      if (vcsRef && vcsRef.url) {
        repoUrl = vcsRef.url;
      }
    }
    if (!repoUrl && component.repository && component.repository.url) {
      repoUrl = component.repository.url;
    }
    if (repoUrl && repoUrl.includes('github.com')) {
      repoUrl = repoUrl.replace(/\.git$/, '');
      if (!repoUrl.startsWith('http')) {
        repoUrl = repoUrl.replace(/^git\+/, '').replace(/^git:/, 'https:');
      }
    }
    return { name: component.name, version: component.version, repo_url: repoUrl };
  });
}
