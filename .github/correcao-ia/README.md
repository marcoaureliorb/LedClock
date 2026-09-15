# Análise e correção automatizada de bugs por IA

Investiga Issues de bug com um modelo de linguagem, corrige o código em uma branch automática e abre
um Pull Request para a `main` — **mas somente quando há evidência no código e o build passa**. Quando
não há, publica na Issue a investigação feita e não altera nada.

Roda em Node.js 20 **sem nenhuma dependência externa** (só a biblioteca padrão e o `fetch` nativo):
não há `npm install`, não há `node_modules`, não há `requirements.txt` e não há action de terceiros na
cadeia de suprimentos. O PlatformIO, usado para compilar o firmware, é instalado pelo workflow.

Complementa o revisor de Pull Requests em [`.github/revisao-ia`](../revisao-ia/README.md), com quem
compartilha os módulos de log, redação de segredos, correspondência por glob e adaptadores de
provedor.

---

## Sumário

- [Instalação](#instalação)
- [Secrets e variáveis](#secrets-e-variáveis)
- [Como funciona](#como-funciona)
- [As cinco travas](#as-cinco-travas)
- [Estrutura dos arquivos](#estrutura-dos-arquivos)
- [Convenções do projeto](#convenções-do-projeto)
- [Validações](#validações)
- [Controle de duplicidade](#controle-de-duplicidade)
- [Execução e teste locais](#execução-e-teste-locais)
- [Segurança](#segurança)
- [Controle de custo](#controle-de-custo)
- [Decisões técnicas](#decisões-técnicas)
- [Limitações conhecidas](#limitações-conhecidas)

---

## Instalação

1. Crie os três secrets em
   `Settings → Secrets and variables → Actions → Secrets → New repository secret`:

   | Secret | Exemplo | Obrigatório |
   |---|---|---|
   | `AZURE_OPENAI_ENDPOINT` | `https://minha-instancia.openai.azure.com` | sim |
   | `AZURE_OPENAI_API_KEY` | a chave do recurso Azure OpenAI | sim |
   | `AZURE_OPENAI_DEPLOYMENT` | `gpt-4o-producao` | sim |

   O `GITHUB_TOKEN` é fornecido automaticamente pelo Actions — não precisa criar.

2. Em `Settings → Actions → General → Workflow permissions`, selecione
   **"Read and write permissions"**. O workflow declara as permissões de que precisa
   (`contents: write`, `pull-requests: write`, `issues: write`), mas elas não podem exceder o teto
   configurado no repositório.

3. Marque **"Allow GitHub Actions to create and approve pull requests"** na mesma tela. Sem isso a
   criação do Pull Request falha com `403`.

4. Confira que o rótulo `bug` existe em `Issues → Labels`. O template
   [`.github/ISSUE_TEMPLATE/bug.yml`](../ISSUE_TEMPLATE/bug.yml) já o aplica automaticamente.

5. Revise [`convencoes.md`](convencoes.md) — é ali que se ajusta o comportamento do agente, não no
   código dele.

6. Abra uma Issue de teste com o rótulo `bug`, ou rode sob demanda em
   `Actions → Análise e Correção Automatizada de Bugs → Run workflow`, informando o número da Issue.

> A automação **nunca faz merge** e **nunca aprova** Pull Request. Ela também nunca escreve na `main`.

---

## Secrets e variáveis

### Secrets (obrigatórios)

| Secret | Para quê |
|---|---|
| `AZURE_OPENAI_ENDPOINT` | Endereço do recurso Azure OpenAI |
| `AZURE_OPENAI_API_KEY` | Chave de autenticação do recurso |
| `AZURE_OPENAI_DEPLOYMENT` | Nome do deployment (o modelo **não** fica fixo no código) |
| `CORRECAO_API_KEY` | Opcional. Tem precedência; serve para usar outro provedor |

### Variables (opcionais)

Crie em `Settings → Secrets and variables → Actions → Variables`. Sem elas valem os padrões de
[`corretor.config.json`](corretor.config.json).

| Variable | Padrão | Para quê |
|---|---|---|
| `CORRECAO_PROVEDOR` | `azure-openai` | `azure-openai`, `anthropic` ou `openai` |
| `CORRECAO_MODELO` | `gpt-4o` | Id do modelo (ignorado no Azure, que usa o deployment) |
| `AZURE_OPENAI_API_VERSION` | `2024-10-21` | `api-version` do Azure |
| `CORRECAO_PARAMETRO_DE_TOKENS` | `max_tokens` | Use `max_completion_tokens` em deployments recentes |
| `CORRECAO_EFFORT` | `high` | `low`…`max` (só Anthropic) |
| `CORRECAO_MAX_RODADAS` | `3` | Rodadas de investigação antes de concluir |
| `CORRECAO_MAX_CARACTERES` | `280000` | Teto de código enviado ao modelo |
| `CORRECAO_MAX_TOKENS_SAIDA` | `16000` | Teto de tokens de resposta |
| `CORRECAO_CONVENCOES` | `.github/correcao-ia/convencoes.md` | Outro arquivo de convenções |
| `CORRECAO_RUNNER` | `ubuntu-latest` | Trocar por um runner self-hosted |

---

## Como funciona

```
issues (opened / edited / labeled / reopened)   issue_comment (/analisar-bug)
  │
  ├─ triagem      é bug? está aberta? já foi analisada? quem pediu tem permissão?
  │               (nenhum token de modelo é consumido nesta etapa)
  │
  ├─ investigação  rodada 1..N: o modelo recebe a Issue + a árvore do repositório
  │                e pede arquivos e buscas; o agente serve o conteúdo e repergunta
  │                └─ conclui com o JSON de análise (status/confidence/root_cause/...)
  │
  ├─ status uncertain | not_found ─────► comenta a investigação na Issue e PARA
  │
  ├─ status identified
  │   ├─ cria a branch automated-error-analysis/<descricao>-<numero> a partir da main
  │   ├─ pede ao modelo blocos de busca/substituição exata
  │   ├─ aplica os blocos (trecho que não casa uma única vez → aborta)
  │   ├─ roda build, verificação de sintaxe e testes
  │   │    ├─ reprovou ──► comenta o erro na Issue, NÃO publica nada e PARA
  │   │    └─ passou ────► commita, publica a branch, abre o Pull Request
  │   └─ comenta o link do Pull Request na Issue
```

### A investigação em rodadas

O agente não dá ao modelo o repositório inteiro nem acesso a ferramentas. A cada rodada o modelo
responde com um dos dois formatos:

```json
{ "acao": "investigar", "arquivos": ["src/main.cpp"], "buscas": ["setDecoColorAll"] }
```

```json
{ "acao": "concluir", "status": "identified", "confidence": 0.82, "root_cause": "...", "...": "..." }
```

O agente atende ao pedido — lendo arquivos e fazendo buscas literais, sempre dentro dos globs
configurados — e reapresenta o dossiê acumulado na rodada seguinte. Ao esgotar
`maxRodadasDeInvestigacao`, a última rodada avisa o modelo de que não haverá outra; se ele ainda não
puder concluir, o status vira `uncertain`.

### O formato da correção

O modelo **não** devolve patch nem o arquivo reescrito, e sim pares de trechos:

```json
{
  "arquivo": "src/main.cpp",
  "trecho_original": "for (uint8_t i = line * 7; i <= line * 7 + 6; i++) {",
  "trecho_novo":     "for (uint8_t i = line * 7; i < line * 7 + 7; i++) {"
}
```

`trecho_original` é localizado por comparação literal e precisa aparecer **exatamente uma vez**. Zero
ocorrências ou mais de uma interrompem a correção com um comentário explicativo — o arquivo não é
tocado. `trecho_original` vazio significa criação de arquivo novo.

---

## As cinco travas

Cada uma é independente: nenhuma alteração chega à `main` sem passar por todas.

| # | Trava | Onde | O que impede |
|---|---|---|---|
| 1 | Triagem | `index.mjs` / `issue.mjs` | Issue que não é bug, Issue fechada, Pull Request, reanálise de quem não tem permissão de escrita |
| 2 | Análise | `analise.mjs` | Correção sem status `identified`, sem causa raiz, sem arquivo válido ou sem plano |
| 3 | Escopo | `repositorio.mjs` | Caminho inventado, travessia de diretório, arquivo fora de `editaveis` |
| 4 | Aplicação | `alteracoes.mjs` | Trecho que não casa exatamente uma vez |
| 5 | Validação | `validacoes.mjs` | Correção que não compila ou que quebra teste |

Além disso, `garantirBranchAutomatica` recusa qualquer commit ou push em branch que não comece com
`automated-error-analysis/`, e a `main` é recusada explicitamente.

**`confidence` não é uma trava.** O número vem do próprio modelo e não é evidência de nada: a
decisão de corrigir usa o que foi declarado (causa, arquivos, plano), e o portão final é o build.

---

## Estrutura dos arquivos

| Arquivo | Responsabilidade |
|---|---|
| `.github/workflows/automated-error-analysis.yml` | Workflow que roda nas Issues |
| `.github/workflows/automated-error-analysis-testes.yml` | Testes e ensaio do próprio agente |
| `.github/ISSUE_TEMPLATE/bug.yml` | Formulário de bug, já com o rótulo `bug` |
| `corretor.config.json` | Configuração: limites, globs, rótulos, comandos de validação |
| `convencoes.md` | Convenções do repositório, injetadas nos prompts de sistema |
| `src/index.mjs` | Orquestração e subcomandos `triagem` / `executar` |
| `src/config.mjs` | Carga e validação da configuração |
| `src/issue.mjs` | Classificação da Issue, higienização e nome da branch |
| `src/repositorio.mjs` | Leitura do código com validação de caminho e escopo |
| `src/prompt.mjs` | Prompts de investigação e de correção |
| `src/analise.mjs` | Interpretação e validação das respostas do modelo |
| `src/alteracoes.mjs` | Aplicação dos blocos de busca/substituição |
| `src/validacoes.mjs` | Execução de build, testes e verificações |
| `src/git.mjs` | Branch, commit e push, com as travas de branch automática |
| `src/github.mjs` | Cliente REST de Issues, rótulos e Pull Requests |
| `src/comentario.mjs` | Markdown dos comentários e da descrição do Pull Request |
| `testes/*.test.mjs` | Suíte `node:test` (171 testes, sem rede) |
| `testes/executar.mjs` | Executor da suíte, estável entre versões do Node |
| `ensaio/stub-offline.mjs` | Ensaio do fluxo completo, sem rede e sem publicar |
| `exemplos/` | Exemplo de Issue de bug e de Pull Request gerado |

---

## Convenções do projeto

Os prompts de sistema têm duas partes: uma fixa (disciplina de investigação, disciplina de correção,
contrato de saída), que vive em `src/prompt.mjs`, e as **convenções do repositório**, que vêm do
markdown apontado por `arquivoDeConvencoes` — por padrão [`convencoes.md`](convencoes.md).

É o principal ajuste de qualidade. Recomendações:

- Escreva apenas regras **verificáveis no código**.
- Diga explicitamente **o que não alterar**: decisões já tomadas, biblioteca que não será trocada,
  arquivo que não deve ser reformatado.
- Aponte **onde existe suíte de testes**, para o agente não inventar estrutura de teste nova.
- Liste o que **nunca** pode aparecer em log ou em resposta (credencial, dado pessoal).

Esse texto é o prefixo cacheado da requisição: mantê-lo estável entre execuções reduz o custo.

---

## Validações

São a única evidência aceita de que a correção funciona. Ficam em `validacoes` no
`corretor.config.json`:

```json
{
  "compilacaoDoFirmware": {
    "habilitada": true,
    "gatilho": ["src/**", "include/**", "lib/**", "platformio.ini"],
    "comando": ["pio", "run", "-e", "esp12e"],
    "diretorio": ".",
    "obrigatoria": true,
    "timeoutEmSegundos": 900
  }
}
```

- `comando` é **sempre um array de argumentos**, executado com `shell: false`. Uma string seria
  recusada na carga da configuração — é o que impede injeção de comando.
- `gatilho` são globs sobre os arquivos alterados. Sem gatilho, a validação roda sempre.
- `obrigatoria: true` significa que **não poder executar também reprova**: sem o build não há
  evidência, e a saída da IA não conta como evidência.
- Se nenhuma validação for aplicável aos arquivos alterados, o Pull Request **não** é aberto.

As deste repositório: `pio run -e esp12e` (firmware), `node --check data/app.js` (painel web) e as
suítes `node:test` das duas automações.

O campo `tests_to_run` devolvido pelo modelo é **informativo**: aparece no Pull Request, mas nunca
vira linha de comando.

---

## Controle de duplicidade

Quatro mecanismos, em camadas:

1. **`concurrency` por Issue**, sem `cancel-in-progress` — cancelar no meio deixaria a Issue rotulada
   como "em andamento" e possivelmente uma branch pela metade.
2. **Branch determinística**: `automated-error-analysis/<descricao>-<numero>`. A mesma Issue sempre
   produz o mesmo nome.
3. **Pull Request existente**: se já houver um aberto para aquela branch, a execução vira um
   comentário de status e nenhum Pull Request adicional é criado.
4. **Rótulos de estado**: `correcao-ia:em-andamento` durante a execução (bloqueia entrada nova) e
   `correcao-ia:analisada` ao final (impede que cada edição da Issue dispare tudo de novo).

Para pedir uma reanálise depois disso, um usuário **com permissão de escrita** comenta
`/analisar-bug` em uma linha própria.

---

## Execução e teste locais

### Suíte de testes

```bash
node .github/correcao-ia/testes/executar.mjs .github/correcao-ia/testes
```

Não faz nenhuma chamada de rede: o `fetch`, o `spawnSync` do Git e o das validações são injetados em
todos os módulos que fazem I/O.

### Ensaio offline do fluxo completo

`ensaio/stub-offline.mjs` substitui o `fetch` por respostas simuladas do GitHub e do provedor.
Combinado com `CORRECAO_SIMULACAO=true`, o Git entra em modo somente leitura e nada é gravado em
disco. Rode a partir da raiz do repositório:

```bash
GITHUB_TOKEN=token-de-ensaio \
GITHUB_REPOSITORY=exemplo/led-clock \
CORRECAO_NUMERO_ISSUE=1 \
CORRECAO_SIMULACAO=true \
AZURE_OPENAI_API_KEY=chave-de-ensaio \
AZURE_OPENAI_ENDPOINT=https://ensaio.openai.azure.com \
AZURE_OPENAI_DEPLOYMENT=ensaio \
node --import ./.github/correcao-ia/ensaio/stub-offline.mjs \
  .github/correcao-ia/src/index.mjs executar
```

Não consome token de modelo, não precisa de chave e não publica nada: o Pull Request que seria
aberto é impresso no terminal. É a forma mais rápida de conferir o efeito de mudanças em
`convencoes.md`, nos globs, nos limites ou no texto dos prompts.

### Ensaio contra uma Issue real

Sem o stub, com `GITHUB_TOKEN="$(gh auth token)"`, o número de uma Issue de verdade e credenciais
válidas do Azure, o mesmo comando faz a análise real. Mantenha `CORRECAO_SIMULACAO=true` para que
nada seja gravado, comentado ou publicado:

```bash
GITHUB_TOKEN="$(gh auth token)" \
GITHUB_REPOSITORY="marcoaureliorb/LedClock" \
CORRECAO_NUMERO_ISSUE="12" \
CORRECAO_SIMULACAO=true \
AZURE_OPENAI_API_KEY="..." \
AZURE_OPENAI_ENDPOINT="https://minha-instancia.openai.azure.com" \
AZURE_OPENAI_DEPLOYMENT="gpt-4o-producao" \
node .github/correcao-ia/src/index.mjs executar
```

Sem `CORRECAO_SIMULACAO`, esse comando **comenta na Issue, cria a branch e abre o Pull Request de
verdade**. Use uma Issue de teste.

---

## Segurança

- **Permissões mínimas**: `contents: write` (branch automática), `pull-requests: write` (abrir o PR)
  e `issues: write` (comentar e rotular). Nada de permissão de organização ou de administração.
- **A `main` nunca é alterada.** `garantirBranchAutomatica` recusa a branch base e qualquer nome sem
  o prefixo `automated-error-analysis/`; ela é chamada antes do commit e de novo antes do push.
- **O agente não aprova e não faz merge** de Pull Request.
- **O conteúdo da Issue é tratado como dado não confiável.** Ele vai ao modelo dentro de um bloco
  delimitado, com instrução explícita de ignorar qualquer comando ali contido, e de concluir com
  `uncertain` se a Issue tentar redirecionar a tarefa.
- **Nada vindo da Issue ou do modelo vira comando.** Os comandos de validação são arrays fixos do
  arquivo de configuração, executados com `shell: false`.
- **Nada vindo do modelo vira caminho sem validação**: caminho absoluto, com `..` ou fora da raiz é
  recusado; depois disso o caminho ainda precisa existir e casar com `editaveis`.
- **O número da Issue é validado como inteiro positivo** antes de compor qualquer URL de API ou nome
  de branch.
- **O nome da branch só aceita `[a-z0-9-]`** no trecho derivado do título, o que impede tanto nome
  inválido no Git quanto dado sensível colado no título.
- **Segredos não chegam ao modelo.** Duas camadas: arquivos sensíveis são excluídos pelos globs
  (`.env`, `secrets*.h`, `*.pem`, `*.key`) e, no que sobra, a redação substitui atribuições de
  senha/token, chaves `sk-…`, JWTs e blocos de chave privada — inclusive no texto da Issue.
- **Segredos não chegam aos logs**: o `GITHUB_TOKEN` e a chave de API são registrados no módulo de
  log e substituídos por `***` em qualquer escrita.
- **Antes do push**, o agente confere o diff contra a base e aborta se algum arquivo fora do escopo
  editável tiver entrado no commit.

### Pull Requests de fork

O workflow dispara em `issues` e `issue_comment`, que sempre rodam no contexto do repositório base —
não há execução de código vindo de fork. O Pull Request gerado é do próprio repositório. O revisor
de Pull Requests (`.github/revisao-ia`) usa `pull_request`, nunca `pull_request_target`, então
código de fork continua sem acesso a secrets.

Ainda assim, **qualquer pessoa que consiga abrir uma Issue consegue fazer o agente gastar tokens**.
Por isso a reanálise exige permissão de escrita, e o rótulo `correcao-ia:analisada` impede o
reprocessamento automático. Em repositório público com muito tráfego, considere trocar o gatilho
`opened` por `labeled`, deixando a entrada sob controle de quem aplica o rótulo.

---

## Controle de custo

O custo é dominado pelos tokens de entrada. Uma execução típica faz 2 a 4 chamadas ao modelo.

Mecanismos já embutidos:

1. **A triagem não consome tokens** — ela decide antes de qualquer chamada.
2. **Tetos de conteúdo** (`maxCaracteresPorArquivo`, `maxCaracteresTotal`, `maxArquivosNaArvore`).
3. **Investigação sob demanda**: o modelo recebe a árvore de arquivos, não o conteúdo deles, e pede
   só o que precisa.
4. **Cache de prompt** no provedor Anthropic (o prompt de sistema é idêntico entre execuções).
5. **`concurrency` por Issue** e rótulo de conclusão, que evitam reprocessamento.
6. **O PlatformIO só é instalado** quando a triagem aprova a Issue.

Para ajustar: `CORRECAO_MAX_RODADAS=2` corta uma rodada inteira; `CORRECAO_MAX_CARACTERES=120000`
reduz pela metade o teto de entrada.

---

## Decisões técnicas

**Por que Node e não Python.** O enunciado permitia Python com o SDK do Azure OpenAI. O repositório
já tem uma automação de IA em Node 20 ESM sem dependências (`.github/revisao-ia`), com convenções,
suíte de testes e adaptador Azure OpenAI prontos. Usar Python adicionaria uma segunda stack,
`requirements.txt`, resolução de dependências em cada execução e duplicação da lógica de redação de
segredos. Em Node, o agente reaproveita `log.mjs`, `segredos.mjs`, `caminhos.mjs` e `provedor.mjs`.

**Por que busca/substituição e não patch.** Patch produzido por modelo erra deslocamento de hunk com
frequência, e reescrita integral de um arquivo de 900 linhas perde trechos silenciosamente. Com
trecho exato, o pior caso é a correção não ser aplicada — nunca um arquivo corrompido.

**Por que rodadas e não tool calling.** Tool calling tem formato diferente em cada provedor. A
investigação em rodadas, com o dossiê remontado a cada chamada, funciona igual em Azure OpenAI,
OpenAI e Anthropic, mantém o prompt de sistema cacheável e é testável sem rede.

**Por que `confidence` não decide nada.** É um número que o próprio modelo escolhe. Abrir Pull
Request porque ele passou de um limiar seria confiar na IA para auditar a IA. A decisão usa evidência
declarada; o portão final é a compilação.

**Por que dois clientes REST do GitHub.** O de `revisao-ia` cobre arquivos de Pull Request e não
expõe o helper de retentativa. Duplicar ~60 linhas custa menos do que arriscar quebrar um revisor já
em produção.

**Por que a correção não roda em `pull_request`.** Os eventos de Issue rodam no contexto do
repositório base, com acesso a secrets e sem executar código de terceiros.

---

## Limitações conhecidas

1. **O agente vê os arquivos que pede, não o repositório inteiro.** Bug cuja causa esteja em um
   arquivo que ele não pensou em pedir termina como `uncertain`.
2. **Não há suíte de testes unitários do firmware.** A validação disponível é a compilação, que
   prova que o código compila — não que o bug foi corrigido. **A revisão humana é obrigatória.**
3. **O firmware não é executado nem testado em hardware.** Bug de temporização, de brilho ou de
   comportamento do LED não é detectável pelo build.
4. **Correção multiarquivo é limitada** a `maxArquivosAlterados` (6 por padrão).
5. **Arquivo maior que `maxCaracteresPorArquivo` é truncado** na investigação; o agente é instruído a
   não propor alteração em trecho que não viu.
6. **A revisão de código por IA não roda no Pull Request gerado.** O GitHub não dispara workflows de
   `pull_request` para Pull Requests criados com o `GITHUB_TOKEN` — é uma proteção contra recursão de
   Actions. Para que `.github/revisao-ia` também revise a correção automática, rode-a sob demanda em
   `Actions → Revisão de Código por IA → Run workflow`, informando o número do Pull Request, ou
   troque o `GITHUB_TOKEN` por um Personal Access Token nos secrets (ao custo de usar uma
   credencial pessoal na automação).
7. **Não há retomada**: se o workflow for cancelado no meio, o rótulo `correcao-ia:em-andamento` pode
   ficar na Issue e precisa ser removido à mão.
8. **Uma tentativa por Issue.** Se o Pull Request automático for fechado sem merge, a branch
   permanece e uma nova análise comenta o status em vez de reabrir — apague a branch para permitir
   uma tentativa nova.
9. **Só o que roda em runner hospedado.** O build do ESP8266 cabe; toolchain proprietária exigiria um
   runner self-hosted (`CORRECAO_RUNNER`).
