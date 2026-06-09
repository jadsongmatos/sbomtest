import fs from 'fs';
import path from 'path';
import * as parser from '@babel/parser';

export interface LibraryUsage {
  functions: string[];
  members: Record<string, string[]>;
  chains: string[];
}

interface LibraryUsageData {
  functions: Set<string>;
  members: Record<string, Set<string>>;
  chains: Set<string>;
}

export interface ScanOptions {
  respectGitIgnore?: boolean;
  excludeDirs?: string[];
  includePatterns?: string[] | null;
  excludePatterns?: string[] | null;
}

export function parseGitIgnore(dir: string): string[] {
  const gitIgnorePath = path.join(dir, '.gitignore');
  const patterns: string[] = [];
  if (!fs.existsSync(gitIgnorePath)) {
    return patterns;
  }
  try {
    const content = fs.readFileSync(gitIgnorePath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      patterns.push(trimmed);
    }
  } catch {
  }
  return patterns;
}

export function patternToRegex(pattern: string): RegExp {
  const startsWithAnyDir = pattern.startsWith('**/');
  const basePattern = startsWithAnyDir ? pattern.slice(3) : pattern;
  let regex = basePattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const anchored = basePattern.startsWith('/');
  if (anchored) {
    regex = regex.slice(1);
    return new RegExp(`^${regex}`);
  }
  const dirOnly = basePattern.endsWith('/');
  if (dirOnly) {
    regex = `${regex.slice(0, -1)}/.*`;
  }
  if (startsWithAnyDir) {
    return new RegExp(`(^|/)${regex}($|/)`);
  }
  if (basePattern.includes('/')) {
    return new RegExp(`(^|/)${regex}`);
  }
  return new RegExp(`(^|/)${regex}($|/)`);
}

export function shouldIgnore(filePath: string, patterns: string[], baseDir: string): boolean {
  const relativePath = path.relative(baseDir, filePath);
  const normalizedPath = relativePath.replace(/\\/g, '/');
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      continue;
    }
    const regex = patternToRegex(pattern);
    if (regex.test(normalizedPath)) {
      return true;
    }
  }
  return false;
}

function getGitIgnorePatterns(dir: string): string[] {
  const patterns = parseGitIgnore(dir);
  return patterns;
}

function getRootObjectName(node: any): string | null {
  if (!node) {
    return null;
  }
  if (node.type === 'Identifier') {
    return node.name;
  }
  if (node.type === 'MemberExpression') {
    return getRootObjectName(node.object);
  }
  return null;
}

function getMemberProperties(node: any): string[] {
  if (!node) {
    return [];
  }
  if (node.type === 'Identifier') {
    return [];
  }
  if (node.type === 'MemberExpression') {
    const props: string[] = [];
    let propName: string | null = null;
    if (node.property.type === 'Identifier') {
      propName = node.property.name;
    } else if (node.property.type === 'StringLiteral') {
      propName = node.property.value;
    }
    if (node.object.type === 'MemberExpression') {
      props.push(...getMemberProperties(node.object));
    }
    if (propName) {
      props.push(propName);
    }
    return props;
  }
  return [];
}

function traverse(node: any, callback: (node: any, parent: any) => void, parent: any = null): void {
  if (!node || typeof node !== 'object') {
    return;
  }
  callback(node, parent);
  for (const key in node) {
    if (['loc', 'start', 'end', 'range', 'parent'].includes(key)) {
      continue;
    }
    const value = node[key];
    if (Array.isArray(value)) {
      value.forEach((child: any) => traverse(child, callback, node));
    } else if (value && typeof value === 'object') {
      traverse(value, callback, node);
    }
  }
}

export function analyzeSourceFile(filePath: string): Record<string, LibraryUsage> {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const content = fs.readFileSync(filePath, 'utf8');
  let ast: any;
  try {
    ast = parser.parse(content, {
      sourceType: 'unambiguous',
      plugins: [
        'jsx',
        'typescript',
        'classProperties',
        'optionalChaining',
        'nullishCoalescingOperator',
        'asyncGenerators',
        'bigInt',
        'importMeta',
        'logicalAssignment',
        'numericSeparator',
        'optionalCatchBinding',
        'throwExpressions'
      ],
      allowAwaitOutsideFunction: true,
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      allowSuperOutsideMethod: true,
      allowUndeclaredExports: true
    });
  } catch (error: any) {
    console.warn(`Warning: Could not parse ${filePath}: ${error.message}`);
    return {};
  }
  const imports: Record<string, string> = {};
  const classInstances: Record<string, string> = {};
  const libraryUsage: Record<string, LibraryUsageData> = {};
  traverse(ast, (node, parent) => {
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'require'
    ) {
      const arg = node.arguments[0];
      if (!arg || arg.type !== 'StringLiteral') {
        return;
      }
      const libName: string = arg.value;
      if (parent && parent.type === 'VariableDeclarator' && parent.id) {
        if (parent.id.type === 'ObjectPattern') {
          for (const prop of parent.id.properties) {
            if (prop.type === 'Property' || prop.type === 'ObjectProperty') {
              const importedName = prop.key.name || prop.key.value;
              const localName = prop.value.name;
              if (!libraryUsage[libName]) {
                libraryUsage[libName] = { functions: new Set(), members: {}, chains: new Set() };
              }
              libraryUsage[libName].functions.add(importedName);
              imports[localName] = libName;
            }
          }
        } else if (parent.id.type === 'Identifier') {
          imports[parent.id.name] = libName;
        }
      }
    }
    if (node.type === 'ImportDeclaration') {
      const libName: string = node.source.value;
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportDefaultSpecifier') {
          imports[specifier.local.name] = libName;
        } else if (specifier.type === 'ImportSpecifier') {
          const importedName = specifier.imported.name;
          const localName = specifier.local.name;
          if (!libraryUsage[libName]) {
            libraryUsage[libName] = { functions: new Set(), members: {}, chains: new Set() };
          }
          libraryUsage[libName].functions.add(importedName);
          imports[localName] = libName;
        }
      }
    }
    if (node.type === 'NewExpression' && node.callee.type === 'Identifier') {
      const className = node.callee.name;
      if (imports[className] && parent && parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
        classInstances[parent.id.name] = imports[className];
      }
    }
  });
  traverse(ast, (node) => {
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
      const calleeName = node.callee.name;
      const libName = imports[calleeName];
      if (libName) {
        if (!libraryUsage[libName]) {
          libraryUsage[libName] = { functions: new Set(), members: {}, chains: new Set() };
        }
        libraryUsage[libName].functions.add(calleeName);
      }
    }
    if (node.type === 'MemberExpression') {
      const objName = getRootObjectName(node);
      if (!objName) {
        return;
      }
      const libName = imports[objName] || classInstances[objName];
      if (!libName) {
        return;
      }
      const props = getMemberProperties(node);
      if (props.length === 0) {
        return;
      }
      if (!libraryUsage[libName]) {
        libraryUsage[libName] = { functions: new Set(), members: {}, chains: new Set() };
      }
      if (!Object.prototype.hasOwnProperty.call(libraryUsage[libName].members, objName)) {
        libraryUsage[libName].members[objName] = new Set();
      }
      props.forEach(prop => libraryUsage[libName].members[objName].add(prop));
      libraryUsage[libName].chains.add(props.join('.'));
    }
  });
  const result: Record<string, LibraryUsage> = {};
  for (const [libName, data] of Object.entries(libraryUsage)) {
    result[libName] = {
      functions: Array.from(data.functions),
      members: {},
      chains: Array.from(data.chains)
    };
    for (const [memberName, funcs] of Object.entries(data.members)) {
      result[libName].members[memberName] = Array.from(funcs);
    }
  }
  return result;
}

export function scanSourceFiles(dir: string, options: ScanOptions = {}): string[] {
  const {
    respectGitIgnore = true,
    excludeDirs = [],
    includePatterns = null,
    excludePatterns = null
  } = options;
  const sourceFiles: string[] = [];
  const gitIgnorePatterns = respectGitIgnore ? getGitIgnorePatterns(dir) : [];
  const alwaysIgnoredDirs = ['node_modules', '.git', 'dist', 'build', 'coverage', 'test', 'tests', '__tests__', ...excludeDirs];
  const includeRegexes = includePatterns ? includePatterns.map(p => patternToRegex(p.trim())) : null;
  const excludeRegexes = excludePatterns ? excludePatterns.map(p => patternToRegex(p.trim())) : null;
  function scan(currentDir: string): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(dir, fullPath).replace(/\\/g, '/');
      if (entry.isDirectory() && alwaysIgnoredDirs.includes(entry.name)) {
        continue;
      }
      if (respectGitIgnore && gitIgnorePatterns.length > 0) {
        if (shouldIgnore(fullPath, gitIgnorePatterns, dir)) {
          continue;
        }
      }
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.isFile() && /\.(js|jsx|mjs|cjs|ts|tsx)$/.test(entry.name)) {
        if (excludeRegexes) {
          const isExcluded = excludeRegexes.some(regex => regex.test(relativePath));
          if (isExcluded) {
            continue;
          }
        }
        if (includeRegexes) {
          const isIncluded = includeRegexes.some(regex => regex.test(relativePath));
          if (!isIncluded) {
            continue;
          }
        }
        sourceFiles.push(fullPath);
      }
    }
  }
  scan(dir);
  return sourceFiles;
}
