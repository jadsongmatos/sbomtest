# Sbomtest

Sbomtest é uma ferramenta de linha de comando que analisa projetos npm, pnpm e yarn e gera arquivos markdown com testes das dependências externas para cada arquivo de código-fonte, usando **Horsebox** como mecanismo de busca de código.

[![Quality gate](https://sonarcloud.io/api/project_badges/quality_gate?project=jadsongmatos_ctest)](https://sonarcloud.io/summary/new_code?id=jadsongmatos_ctest)

## Visão Geral

O Sbomtest analisa seu projeto npm para identificar quais funções de bibliotecas externas são usadas em cada arquivo fonte, então gera arquivos markdown contendo os casos de teste relevantes dessas bibliotecas externas.

## Recursos

- **Checklist Global**: Gera um arquivo `SBOMTEST_CHECKLIST.md` para você controlar o progresso da revisão de cada arquivo analisado.
- **Checklist por Arquivo**: Cada markdown gerado contém um checklist das bibliotecas detectadas.
- **Persistent Cache**: As dependências baixadas são armazenadas em um cache local (`~/.sbomtest/repos`), evitando downloads repetidos.
- **Índices Horsebox Persistente**: Os índices do Horsebox são armazenados em `<download-dir>/.horsebox/`, permitindo reutilização em execuções futuras.
- **Filtro de Dependências Diretas**: Use `--direct-only` para ignorar dependências transitivas e focar no que importa.
- **Auto-discovery de Repo**: Se o `repo_url` estiver faltando no SBOM, o Sbomtest tenta buscá-lo automaticamente no registro do npm.
- **Normalização de URLs**: Converte automaticamente URLs de repositório `git+https` e `git:` para `https` compatível com GitHub.
- **Horsebox Integration**: Indexa o projeto e dependências com Horsebox para buscas ultrarrápidas de trechos de código.
- **AST Analysis**: Detecta funções, membros e cadeias de chamadas (ex: `prisma.user.findUnique`) usando parser do Babel.

## Dependências Externas

O Sbomtest requer o **Horsebox** (`hb`) instalado no sistema:

```bash
uv tool install git+https://github.com/michelcaradec/horsebox
```

## Instalação

```bash
npm install
```

## Instalação como Skill do GitHub Copilot

Você pode instalar o Sbomtest como um skill do GitHub Copilot usando o comando `npx skills add`:

```bash
npx skills add jadsonmatos/sbomtest
```

Isso adicionará o skill `sbomtest-review` ao seu projeto, permitindo que o GitHub Copilot gere testes automatizados baseados na análise do Sbomtest.

### Usando o Skill

Após instalado, você pode usar o skill para gerar testes:

```bash
# Gerar testes para um arquivo específico
/sbomtest-review src/lib/utils.js

# Ou simplesmente peça ao Copilot para usar o skill em qualquer arquivo que você quer testar
```

O skill lerá o arquivo `.md` gerado pelo Sbomtest e criará testes Jest correspondentes para as bibliotecas externas detectadas.

## Suporte a pnpm e Yarn

O Sbomtest detecta automaticamente o gerenciador de pacotes do projeto:

- **pnpm**: Projetos com `pnpm-lock.yaml` usam `@cyclonedx/cyclonedx-pnpm`
- **yarn**: Projetos com `yarn.lock` usam `@cyclonedx/cyclonedx-yarn`
- **npm**: Projetos com `package-lock.json` usam `@cyclonedx/cyclonedx-npm`

Nenhuma configuração adicional é necessária - basta executar o Sbomtest no diretório do projeto.

## Início Rápido

Analise um projeto npm e gere arquivos markdown com testes externos:

```bash
# Com download de dependências (recomendado para resultados completos)
node src/index.js . --download-dependencies --direct-only

# Analisar um arquivo específico
node src/index.js . --file=src/lib/utils.js --download-dependencies
```

## Uso

### Opções de Linha de Comando

| Opção | Descrição |
|-------|-----------|
| `<project-path>` | Caminho para o projeto (npm/pnpm/yarn) (padrão: `.`) |
| `--download-dependencies` | Habilita o download/uso do cache de repositórios das dependências |
| `--direct-only` | Analisa apenas dependências diretas listadas no `package.json` |
| `--download-dir=<path>` | Muda o diretório de cache de repositórios (padrão: `~/.sbomtest/repos`) |
| `--file=<arquivo>` | Analisa apenas um arquivo específico do projeto |
| `--include=<pattern>` | Filtra arquivos para análise usando padrões glob (ex: `src/**`, `**/*.ts`) |
| `--exclude=<pattern>` | Exclui arquivos da análise usando padrões glob (ex: `**/*.test.js`, `**/vendor/**`) |
| `--max-downloads=<n>` | Limita o número de novos downloads de dependências |
| `--respect-gitignore=<true\|false>` | Respeita o `.gitignore` ao varrer o projeto (padrão: `true`) |

### Exemplos

```bash
# Analisar apenas dependências diretas e salvar no diretório local 'deps'
node src/index.js . --download-dependencies --direct-only --download-dir=deps

# Analisar sem baixar nada (usa apenas o que já estiver no cache ou projeto)
node src/index.js .

# Analisar apenas arquivos de uma subpasta específica
node src/index.js . --download-dependencies --include="src/lib/**"

# Analisar apenas arquivos TypeScript
node src/index.js . --download-dependencies --include="**/*.ts"

# Excluir arquivos de teste da análise
node src/index.js . --download-dependencies --exclude="**/*.test.js,**/*.spec.js"

# Combinar include e exclude: analisar src/ mas excluir vendor
node src/index.js . --download-dependencies --include="src/**" --exclude="**/vendor/**"

# Múltiplos padrões include (separados por vírgula)
node src/index.js . --download-dependencies --include="src/**,lib/**"
```

## Como Funciona

1. **SBOM & Discovery**: Gera um SBOM CycloneDX e normaliza as URLs dos repositórios. Se faltar a URL, consulta a API do npm.
2. **Repository Cache**: Gerencia o download das dependências para um diretório persistente. Se já existir, pula o download.
3. **Horsebox Indexing**: Cria índices persistentes em `<download-dir>/.horsebox/`. Se os índices já existirem, reutiliza para acelerar execuções futuras.
4. **AST Analysis**: Varre seus arquivos `.js`, `.ts`, etc., identificando o uso exato de cada biblioteca externa.
5. **Smart Search**: Para cada função ou cadeia detectada, o Sbomtest pergunta ao Horsebox onde isso aparece em arquivos de teste nas dependências.
6. **Code Extraction**: Extrai os blocos `test()` e `it()` que contenham os termos buscados.
7. **Markdown Generation**: Gera um `.md` para cada arquivo, com checklists de libs e os exemplos de código encontrados.
8. **Checklist Global**: Cria o `SBOMTEST_CHECKLIST.md` na raiz do projeto para você marcar o que já revisou.

## Uso Programático

```javascript
const { analyze } = require('./src/index');

async function main() {
  const result = await analyze('.', {
    downloadDependencies: true,
    directOnly: true,
    downloadDir: './my-cache'
  });

  console.log(`Arquivos gerados: ${result.generated.length}`);
}
```

## Rodando Testes

```bash
npm test
```

## License

[GNU General Public License v3.0](./LICENSE)
