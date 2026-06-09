import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

import { describe, it, expect } from 'bun:test';
import type { AnalyzeResult } from '../src/index';

let horseboxAvailable = false;
try {
  execSync('hb --help', { stdio: 'ignore' });
  horseboxAvailable = true;
} catch {
  // Horsebox not available
}

const { analyze } = await import('../src/index');

describe('Main Module', () => {
  const testProjectPath = path.join(__dirname, 'fixtures', 'test-project');

  describe('analyze', () => {
    it('should throw error for non-existent project path', async () => {
      expect(analyze('/non-existent/path')).rejects.toThrow('Project path does not exist');
    });

    it('should analyze project and generate markdown files', async () => {
      if (!horseboxAvailable) {
        console.log('Skipping test - Horsebox not installed');
        return;
      }
      if (!fs.existsSync(testProjectPath)) {
        console.log('Skipping test - test-project not found');
        return;
      }
      const result: AnalyzeResult = await analyze(testProjectPath, { sbomPath: 'test-sbom.json' });
      expect(result).toBeDefined();
      expect(result.sbomPath).toBeDefined();
      expect(result.generated).toBeDefined();
      expect(Array.isArray(result.generated)).toBe(true);
    }, 120000);
  });
});
