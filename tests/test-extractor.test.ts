import { describe, it, expect, beforeEach, mock } from 'bun:test';

const actualUtils = await import('../src/lib/utils');

const mockSafeReadFile = mock();
mock.module('../src/lib/utils', () => ({
  ...actualUtils,
  safeReadFile: mockSafeReadFile,
}));

const {
  extractTestBlocks,
  extractRelevantBlocksFromFile
} = await import('../src/lib/test-extractor');

describe('Test Extractor Module', () => {
  beforeEach(() => {
    mockSafeReadFile.mockClear();
  });

  describe('extractTestBlocks', () => {
    it('should extract test blocks with it', () => {
      const content = `
it('should work', () => {
  expect(true).toBe(true);
});
`;
      const blocks = extractTestBlocks(content);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].title).toBe('should work');
      expect(blocks[0].code).toContain('it(');
    });

    it('should extract test blocks with test', () => {
      const content = `
test('should work', () => {
  expect(true).toBe(true);
});
`;
      const blocks = extractTestBlocks(content);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].title).toBe('should work');
      expect(blocks[0].code).toContain('test(');
    });

    it('should extract multiple test blocks', () => {
      const content = `
test('first test', () => {
  // code
});

it('second test', () => {
  // more code
});
`;
      const blocks = extractTestBlocks(content);

      expect(blocks).toHaveLength(2);
      expect(blocks[0].title).toBe('first test');
      expect(blocks[1].title).toBe('second test');
    });

    it('should handle single quotes in title', () => {
      const content = `
test('should handle \\'quotes\\'', () => {
  // code
});
`;
      const blocks = extractTestBlocks(content);

      expect(blocks).toHaveLength(1);
    });

    it('should handle double quotes in title', () => {
      const content = `
test("should work", () => {
  // code
});
`;
      const blocks = extractTestBlocks(content);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].title).toBe('should work');
    });

    it('should handle template literals in title', () => {
      const content = `
test(\`should work\`, () => {
  // code
});
`;
      const blocks = extractTestBlocks(content);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].title).toBe('should work');
    });

    it('should handle nested braces', () => {
      const content = `
test('should handle nested', () => {
  if (true) {
    // nested block
  }
});
`;
      const blocks = extractTestBlocks(content);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].code).toContain('if (true)');
    });

    it('should handle async tests', () => {
      const content = `
test('should be async', async () => {
  await Promise.resolve();
});
`;
      const blocks = extractTestBlocks(content);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].code).toContain('async');
    });

    it('should handle tests with callbacks', () => {
      const content = `
test('should use done', (done) => {
  setTimeout(done, 100);
});
`;
      const blocks = extractTestBlocks(content);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].code).toContain('done');
    });

    it('should handle empty content', () => {
      const blocks = extractTestBlocks('');
      expect(blocks).toHaveLength(0);
    });

    it('should handle content without tests', () => {
      const content = `
function myFunction() {
  return true;
}
`;
      const blocks = extractTestBlocks(content);
      expect(blocks).toHaveLength(0);
    });

    it('should handle unbalanced braces gracefully', () => {
      const content = `
test('incomplete test', () => {
  // missing closing brace
`;
      const blocks = extractTestBlocks(content);
      expect(blocks).toHaveLength(0);
    });

    it('should handle strings with braces', () => {
      const content = `
test('should handle {braces} in string', () => {
  const str = '{test}';
});
`;
      const blocks = extractTestBlocks(content);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].title).toBe('should handle {braces} in string');
    });

    it('should handle template strings with braces', () => {
      const content = `
test('template', () => {
  const str = \`\${value}\`;
});
`;
      const blocks = extractTestBlocks(content);

      expect(blocks).toHaveLength(1);
    });

    it('should handle escaped quotes in strings', () => {
      const content = `
test('escaped', () => {
  const str = "quote: \\"test\\"";
});
`;
      const blocks = extractTestBlocks(content);

      expect(blocks).toHaveLength(1);
    });
  });

  describe('extractRelevantBlocksFromFile', () => {
    it('should extract blocks matching terms', () => {
      const content = `
test('should connect to db', () => {
  db.connect();
});

test('should query data', () => {
  db.query();
});
`;
      mockSafeReadFile.mockReturnValue(content);

      const blocks = extractRelevantBlocksFromFile('/test/file.js', ['connect to db']);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].title).toBe('should connect to db');
    });

    it('should filter out non-matching blocks', () => {
      const content = `
test('should connect', () => {
  db.connect();
});

test('should query', () => {
  db.query();
});
`;
      mockSafeReadFile.mockReturnValue(content);

      const blocks = extractRelevantBlocksFromFile('/test/file.js', ['connect']);

      expect(blocks).toHaveLength(1);
    });

    it('should handle case-insensitive matching', () => {
      const content = `
test('should Connect', () => {
  db.connect();
});
`;
      mockSafeReadFile.mockReturnValue(content);

      const blocks = extractRelevantBlocksFromFile('/test/file.js', ['CONNECT']);

      expect(blocks).toHaveLength(1);
    });

    it('should return empty array if file cannot be read', () => {
      mockSafeReadFile.mockReturnValue(null);

      const blocks = extractRelevantBlocksFromFile('/test/file.js', ['connect']);

      expect(blocks).toEqual([]);
    });

    it('should return empty array if no blocks match', () => {
      const content = `
test('should query', () => {
  db.query();
});
`;
      mockSafeReadFile.mockReturnValue(content);

      const blocks = extractRelevantBlocksFromFile('/test/file.js', ['connect']);

      expect(blocks).toEqual([]);
    });

    it('should match multiple terms', () => {
      const content = `
test('should connect', () => {
  db.connect();
});

test('should query', () => {
  db.query();
});
`;
      mockSafeReadFile.mockReturnValue(content);

      const blocks = extractRelevantBlocksFromFile('/test/file.js', ['connect', 'query']);

      expect(blocks).toHaveLength(2);
    });

    it('should match terms in test title', () => {
      const content = `
test('connection test', () => {
  // code
});
`;
      mockSafeReadFile.mockReturnValue(content);

      const blocks = extractRelevantBlocksFromFile('/test/file.js', ['connection']);

      expect(blocks).toHaveLength(1);
    });
  });
});
