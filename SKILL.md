---
name: sbomtest-review
description: Generates automated Jest tests for a source file using sbomtest-generated .md as reference. Use when the user wants to generate, write, or create tests based on sbomtest analysis output.
argument-hint: [source-file-path]
allowed-tools: Read, Glob, Grep, Edit, Write, Bash
---

# Sbomtest — Generate Automated Tests

Your job is to **write automated Jest tests** for a source file, using the sbomtest-generated `.md` as a reference for how the external libraries are actually used and tested.

For Sbomtest overview, features, and CLI options, refer to:
- `sbomtest --help`
- https://github.com/jadsongmatos/sbomtest/blob/main/README.md

## 0. Prerequisite: Sbomtest CLI

Before proceeding, verify that the Sbomtest CLI is installed by running:

```bash
sbomtest --help
```

If the command is not found, inform the user:

> Sbomtest CLI is not installed. Please follow the installation guide at:
> https://github.com/jadsongmatos/sbomtest/blob/main/README.md
>
> After installing, run `sbomtest --help` to verify the installation, then invoke this skill again.

**Do not proceed** with the remaining steps until the CLI is available.

## 1. Determine the target file

If `$ARGUMENTS` was provided, use it as the source file path.

Otherwise, open `SBOMTEST_CHECKLIST.md` and pick the **first unchecked item** (`- [ ]`). The checklist entry is the path to the `.md` file — remove the `.md` suffix to get the source file path.

## 2. Read both files in parallel

Read both the source file and the sbomtest `.md` (same path with `.md` appended) before doing anything else. **Never guess** what these files contain — verify by reading.

## 3. Understand the source file

From the source file, identify:
- What functions/classes this module **exports** (verify by reading implementation, not assuming from names)
- Which **external libraries** it imports and which methods/functions it calls on them

## 4. Mine the sbomtest markdown for patterns

The `.md` file contains real test blocks extracted from the dependency source code. For each external library section:
- Extract the **patterns** they demonstrate: how to set up the library, what inputs to pass, what to assert, how errors are handled
- Adapt them to test **your module's behavior**, not the library itself

## 5. Check for an existing test file

Look for `tests/<module-name>.test.js` (e.g. `src/lib/utils.js` → `tests/utils.test.js`).

- If it **exists**: read it, then **add new `describe`/`it` blocks** for uncovered functions. Do not duplicate existing tests.
- If it **does not exist**: create it from scratch following the conventions below.

## 6. Write the tests

```pseudocode
import module_under_test

mock all I/O dependencies (fs, os, child_process, http, ...)

describe "Module Name":
  before each test: clear all mocks
  after each test: restore all mocks

  describe "functionName":
    it "should <expected behavior> when <condition>":
      arrange: set up inputs and mock return values
      act: call the exported function
      assert: verify output / side effects

    it "should throw / return null / handle error when <bad input>":
      arrange: set up invalid or boundary inputs
      act: call the exported function
      assert: verify error thrown or safe fallback returned
```

**Rules:**
- Test **this module's exported functions**, not the external libraries directly
- Use the sbomtest `.md` test examples as inspiration — adapt them to the module under test (reasoning by analogy, not copying)
- Mock all I/O: `fs`, `os`, `child_process`, `https`, `path` (when side-effectful)
- Cover: happy path, edge cases, and error/exception paths for every exported function
- Use `jest.spyOn` for partial mocks when full mock is too broad
- Follow 2-space indentation, semicolons, `const`/`let`

## 7. Save the test file

Write or update `tests/<module-name>.test.js` using native patching tools. **NEVER** use `sed`, `awk`, or `echo >>` to mutate source code.

## 8. Cleanup

**Invariants — nunca violar:**

1. **Proibido marcar em lote.** Cada item do checklist só pode ser marcado após o teste daquele item específico ter sido escrito e salvo.
2. **Proibido deletar o `.md` sem teste validado.** O arquivo de referência só pode ser removido depois que o arquivo de teste existir em disco e cobrir as funções exportadas do módulo.
3. **Ordem obrigatória — uma iteração por item:**
   ```pseudocode
   for each unchecked item in checklist:
     read source_file and reference_md
     write or update test_file
     assert test_file exists and covers exported functions
     mark checklist item as done
     delete reference_md
   ```
   Se o teste falhar ou não puder ser gerado, o item permanece `- [ ]` e o `.md` é preservado.

### 8.1 Mark the checklist item as done

Edit `SBOMTEST_CHECKLIST.md` and change the item from `- [ ]` to `- [x]`.

### 8.2 Delete the sbomtest-generated `.md` file

Remove the `.md` file used as reference (e.g. `src/lib/example.js.md`).

Both steps are required. Do not skip either one.
