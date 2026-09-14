# Revisão de código por IA

Revisa o diff de cada Pull Request com um modelo de linguagem e publica o resultado como um
comentário único no PR. Avalia quatro critérios — **qualidade**, **legibilidade**,
**erros de implementação** e **Clean Code** — com severidade por apontamento e modo opcional
de bloqueio do merge.

Roda em Node.js 20 **sem nenhuma dependência externa** (só a biblioteca padrão e o `fetch` nativo):
não há `npm install`, nem `node_modules`, nem action de terceiros na cadeia de suprimentos.

Não há nada específico de projeto no código: o que o revisor sabe sobre o repositório vem de
`convencoes.md` e de `revisor.config.json`.

---

## Sumário

- [Instalação](#instalação)
- [Como funciona](#como-funciona)
- [Estrutura dos arquivos](#estrutura-dos-arquivos)
- [Convenções do projeto](#convenções-do-projeto)
- [Configuração](#configuração)
- [Verificações nativas](#verificações-nativas)
- [Execução e teste locais](#execução-e-teste-locais)
- [Controle de custo](#controle-de-custo)
- [Segurança](#segurança)
- [Limitações conhecidas](#limitações-conhecidas)

---

## Instalação

1. Copie a pasta `.github/` inteira para a raiz do repositório (ou apenas `.github/revisao-ia/` e
   `.github/workflows/revisao-ia*.yml`, se o repositório já tiver um `.github/`).
2. Crie o secret `REVISAO_API_KEY` em
   `Settings → Secrets and variables → Actions → Secrets → New repository secret`,
   com a chave da API do provedor escolhido. O `GITHUB_TOKEN` usado para comentar é fornecido
   automaticamente pelo Actions — não precisa criar.
3. Confira `Settings → Actions → General → Workflow permissions`: como o workflow declara as
   permissões de que precisa (`contents: read`, `pull-requests: write`), a opção recomendada
   **"Read repository contents and packages permissions"** é suficiente.
4. Escreva as convenções do repositório em `.github/revisao-ia/convencoes.md`
   (ver [Convenções do projeto](#convenções-do-projeto)). Sem isso a revisão funciona, mas cobre
   apenas o que é observável no diff.
5. Abra um PR de teste, ou rode sob demanda em
   `Actions → Revisão de Código por IA → Run workflow`, informando o número do PR.

Opcionalmente, crie *variables* (`Settings → Secrets and variables → Actions → Variables`) para
ajustar o comportamento sem editar arquivos. Todas são opcionais; sem elas valem os padrões de
`revisor.config.json`.

| Variable | Padrão | Para quê |
|---|---|---|
| `REVISAO_PROVEDOR` | `anthropic` | `anthropic`, `azure-openai` ou `openai` |
| `REVISAO_MODELO` | `claude-sonnet-5` | Id do modelo |
| `REVISAO_ENDPOINT` | conforme provedor | Obrigatório em `azure-openai` |
| `REVISAO_DEPLOYMENT` | — | Obrigatório em `azure-openai` |
| `REVISAO_API_VERSION` | `2024-10-21` | `api-version` do Azure |
| `REVISAO_EFFORT` | `high` | `low`…`max` (só Anthropic) |
| `REVISAO_MODO` | `informativo` | `informativo` ou `bloqueante` |
| `REVISAO_SEVERIDADE_BLOQUEIO` | `Critical` | A partir de qual severidade reprovar |
| `REVISAO_MAX_ARQUIVOS` | `40` | Teto de arquivos enviados |
| `REVISAO_MAX_CARACTERES` | `240000` | Teto total de caracteres enviados |
| `REVISAO_CONVENCOES` | `.github/revisao-ia/convencoes.md` | Outro arquivo de convenções |
| `REVISAO_RUNNER` | `ubuntu-latest` | Trocar por um runner self-hosted |

Para tornar a revisão obrigatória: `Settings → Branches → Branch protection rules →
Require status checks to pass`, selecionando **"Revisão por IA"**. Faça isso só depois de rodar
algum tempo em `informativo` e de trocar `REVISAO_MODO` para `bloqueante` — antes disso o check
sempre passa e a proteção não tem efeito prático.

> O merge nunca é feito automaticamente. O Action só comenta e, no modo bloqueante, reprova o check.

---

## Como funciona

```
pull_request (opened / synchronize / reopened / ready_for_review)
  │
  ├─ detectar   GET /pulls/{n}/files → decide quais verificações nativas se aplicam
  │             (nenhum token de modelo é consumido nesta etapa)
  │
  ├─ verificações nativas (opcionais, configuráveis)
  │
  └─ revisar    filtra arquivos → anota o diff com números de linha → redige segredos
                → chama o modelo → valida a resposta → publica/atualiza o comentário
                → decide o código de saída (0 = passa, 1 = bloqueia)
```

Pontos de projeto relevantes:

- **O diff vem da API do GitHub**, não do histórico local. O checkout é `fetch-depth: 1`, sem
  clonar o histórico inteiro.
- **O diff é anotado com o número de linha do arquivo novo** antes de ir ao modelo. Sem isso o
  modelo precisa somar deslocamentos de hunk manualmente e erra a linha citada no apontamento.
- **Apontamento sobre arquivo que não está no PR é descartado**, não exibido. É a principal defesa
  contra alucinação.
- **O comentário é idempotente**: um marcador HTML invisível (`<!-- revisao-ia -->`) permite
  atualizar o comentário existente a cada novo push, em vez de encher o PR de comentários.
- **Falha do provedor não bloqueia o merge** por padrão — ela vira um comentário explicando o
  ocorrido e o job passa. Configurável.

---

## Estrutura dos arquivos

| Arquivo | Responsabilidade |
|---|---|
| `.github/workflows/revisao-ia.yml` | Workflow que roda nos PRs |
| `.github/workflows/revisao-ia-testes.yml` | Testes do próprio revisor |
| `revisor.config.json` | Configuração padrão (limites, globs, modo) |
| `convencoes.md` | Convenções do repositório, injetadas no prompt de sistema |
| `convencoes.exemplo.md` | Exemplo preenchido do arquivo acima |
| `src/index.mjs` | Orquestração e subcomandos `detectar` / `revisar` |
| `src/config.mjs` | Carga e validação da configuração |
| `src/github.mjs` | Cliente REST do GitHub (arquivos do PR, comentários) |
| `src/diff.mjs` | Seleção de arquivos, anotação do diff, orçamento de conteúdo |
| `src/segredos.mjs` | Redação de segredos antes do envio ao modelo |
| `src/caminhos.mjs` | Correspondência por glob |
| `src/prompt.mjs` | Montagem dos prompts de sistema e de usuário |
| `src/provedor.mjs` | Adaptadores Anthropic / Azure OpenAI / OpenAI |
| `src/apuracao.mjs` | Interpretação da resposta, validação e decisão de bloqueio |
| `src/comentario.mjs` | Renderização do markdown e publicação idempotente |
| `src/registrar-verificacao.mjs` | Registra o resultado das verificações nativas |
| `testes/*.test.mjs` | Suíte `node:test` (87 testes, sem rede) |
| `ensaio/stub-offline.mjs` | Ensaio local do fluxo completo, sem rede e sem publicar |

---

## Convenções do projeto

O prompt de sistema tem duas partes: uma fixa (critérios, escala de severidade, disciplina de
revisão, contrato de saída), que vive em `src/prompt.mjs`, e as **convenções do repositório**, que
vêm do markdown apontado por `arquivoDeConvencoes` — por padrão `convencoes.md`.

É o principal ajuste de qualidade da revisão. Recomendações:

- Escreva apenas regras **verificáveis no diff**. "Use nomes claros" não muda nada; "toda consulta
  ao banco fica em `repositorios/`, rota que executa SQL é achado grave" muda bastante.
- Diga explicitamente **o que não apontar**. Decisões arquiteturais já tomadas, código legado que
  não será renomeado, ferramentas que não serão trocadas.
- Aponte **onde existe suíte de testes**, para que o revisor cobre teste apenas onde faz sentido.
- Liste o que **nunca** pode aparecer em log ou em resposta ao cliente (credencial, dado pessoal).
- Se o repositório já tem um arquivo de instruções (por exemplo `CLAUDE.md` ou `CONTRIBUTING.md`),
  aponte para ele em vez de duplicar: `REVISAO_CONVENCOES=CLAUDE.md`.

`convencoes.exemplo.md` mostra o formato preenchido. Esse texto é o prefixo cacheado da requisição:
mantê-lo estável entre execuções reduz o custo.

---

## Configuração

A precedência é **variável de ambiente > `revisor.config.json` > padrão embutido**.

### Escolha do provedor

**Anthropic** (padrão): basta o secret `REVISAO_API_KEY`. É o único que ativa cache de prompt e o
parâmetro `effort`.

**Azure OpenAI**: defina `REVISAO_PROVEDOR=azure-openai`, `REVISAO_ENDPOINT` e `REVISAO_DEPLOYMENT`.
Deployments recentes exigem `max_completion_tokens` no lugar de `max_tokens` — nesse caso acrescente
`"parametroDeTokens": "max_completion_tokens"` ao `revisor.config.json`.

**OpenAI**: defina `REVISAO_PROVEDOR=openai` e `REVISAO_MODELO`.

A chave é lida de `REVISAO_API_KEY` e, se ausente, de `ANTHROPIC_API_KEY` / `AZURE_OPENAI_API_KEY` /
`OPENAI_API_KEY`, conforme o provedor.

### Escopo dos arquivos revisados

`incluir` e `excluir` em `revisor.config.json` são globs (`**`, `*`, `?`). A exclusão vence a
inclusão.

O padrão inclui as extensões de código mais comuns e exclui dependências (`node_modules/`,
`vendor/`), saída de build (`dist/`, `build/`, `target/`, `bin/`, `obj/`), lockfiles, arquivos
gerados, snapshots, binários, imagens e arquivos sensíveis (`.env`, `*.pem`, `*.key`,
`secrets*.json`). Ajuste à realidade do repositório — todo arquivo enviado sem necessidade é custo
e ruído.

### Modo bloqueante

```
REVISAO_MODO=bloqueante
REVISAO_SEVERIDADE_BLOQUEIO=Critical
```

Para não reprovar por hipótese, acrescente ao `revisor.config.json`:

```json
{ "considerarApenasConfirmados": true }
```

Assim só apontamentos marcados pelo modelo como `confirmado` contam para o bloqueio; os marcados
como `suspeita` continuam aparecendo no comentário.

---

## Verificações nativas

Opcionalmente, o workflow pode rodar as ferramentas do próprio projeto (testes, linter) antes da
revisão e entregar o resultado ao modelo, para que ele não repita como apontamento o que a
ferramenta já acusou.

Declare cada verificação em `revisor.config.json`:

```json
{
  "verificacoesNativas": {
    "testesNode": {
      "habilitada": true,
      "gatilho": ["src/**", "package.json"],
      "diretorio": "."
    }
  }
}
```

O passo `detectar` publica então os outputs `rodar_testesNode` e `dir_testesNode`. Escreva um passo
no workflow condicionado a esse output e registre o resultado com
`node .github/revisao-ia/src/registrar-verificacao.mjs "<nome>" "<sucesso|falhou|nao executada>" "<detalhe>"`.
O `revisao-ia.yml` traz o molde comentado. Use `continue-on-error: true`: a falha da ferramenta
aparece no comentário sem derrubar o job por si só.

Com `"verificacoesNativas": {}` (o padrão), nenhuma roda e só a revisão por IA é executada.

---

## Execução e teste locais

### Suíte de testes

```bash
cd .github/revisao-ia
node --test "testes/*.test.mjs"
```

Não faz nenhuma chamada de rede: o `fetch` é injetado em todos os módulos que fazem I/O.

### Ensaio offline, sem rede e sem PR real

`ensaio/stub-offline.mjs` substitui o `fetch` por respostas simuladas da API do GitHub e do
provedor. Não consome token de modelo, não precisa de chave e não publica nada — o comentário que
seria publicado é impresso no terminal. Rode a partir da raiz do repositório:

```bash
GITHUB_TOKEN=token-falso \
GITHUB_REPOSITORY=usuario/meu-repositorio \
REVISAO_NUMERO_PR=1 \
REVISAO_API_KEY=chave-falsa \
RUNNER_TEMP="$PWD/tmp" \
node --import ./.github/revisao-ia/ensaio/stub-offline.mjs .github/revisao-ia/src/index.mjs revisar
```

É a forma mais rápida de conferir o efeito de mudanças em `convencoes.md`, nos globs ou nos
limites. O log mostra os arquivos selecionados e de onde vieram as convenções.

### Ensaio contra um PR real

Sem o stub, com `GITHUB_TOKEN="$(gh auth token)"`, o número de um PR de verdade e uma chave de API
válida, o mesmo comando faz uma revisão real — e **publica o comentário no PR indicado**:

```bash
GITHUB_TOKEN="$(gh auth token)" \
GITHUB_REPOSITORY="usuario/meu-repositorio" \
REVISAO_NUMERO_PR="1" \
REVISAO_API_KEY="sk-ant-..." \
RUNNER_TEMP="$PWD/tmp" \
node .github/revisao-ia/src/index.mjs revisar
```

Use um PR de teste. Para ver o diff e o prompt sem chamar o modelo, adapte o stub deixando passar
apenas os `GET` para `api.github.com`.

---

## Controle de custo

O custo é dominado pelos tokens de entrada: um PR de ~15 arquivos e ~100 mil caracteres gera da
ordem de 40 mil tokens de entrada. O comentário sempre informa os tokens e o custo estimado da
execução (para modelos com preço conhecido em `src/comentario.mjs`).

Mecanismos já embutidos:

1. **Teto de arquivos e de caracteres** (`maxArquivos`, `maxCaracteresTotal`,
   `maxCaracteresPorArquivo`). O que exceder é listado no comentário como "não enviado", nunca
   descartado em silêncio.
2. **Só o diff, mais contexto sob demanda.** O arquivo inteiro só acompanha o diff quando tem até
   400 linhas e cabe no orçamento restante.
3. **Exclusão agressiva do que não é código revisável** — binários, gerados, lockfiles, documentação.
4. **Cache de prompt** (`cache_control` no prompt de sistema, provedor Anthropic). O prompt de
   sistema é idêntico entre execuções; dentro da janela de cache ele é cobrado a ~10% do preço.
5. **`concurrency` com `cancel-in-progress`**: um push novo cancela a revisão do commit anterior,
   em vez de pagar por duas.
6. **A etapa `detectar` não consome tokens** — ela só decide quais verificações rodar.
7. **Não roda em rascunho** (`draft`) nem quando não há arquivo analisável.

Para ajustar:

| Ação | Efeito |
|---|---|
| `REVISAO_MODELO=claude-opus-5` | Revisão mais forte, custo por token bem maior |
| `REVISAO_MODELO=claude-haiku-4-5` | Bem mais barato, achados mais superficiais |
| `REVISAO_EFFORT=medium` | Menos tokens de raciocínio |
| `REVISAO_MAX_CARACTERES=120000` | Corta pela metade o teto de entrada |
| Trocar o gatilho `synchronize` por `ready_for_review` | Uma revisão por PR, não uma por push |

---

## Segurança

- **Permissões mínimas**: `contents: read` e `pull-requests: write`. Nada mais.
- **Evento `pull_request`, nunca `pull_request_target`.** Isso é deliberado: `pull_request_target`
  daria acesso a secrets a código vindo de fork. Como consequência, PRs de fork não têm chave de API
  e a revisão é simplesmente ignorada, com um aviso — o workflow não falha.
- **`persist-credentials: false`** no checkout: o token não fica gravado no `.git/config`.
- **Segredos nunca chegam ao modelo.** Duas camadas: arquivos sensíveis são excluídos pelos globs
  (`.env`, `*.pem`, `*.key`, `secrets*.json`) e, no que sobra, um passo de redação substitui
  atribuições de senha/secret/token, chaves `sk-ant-…`/`sk-…`, JWTs, `Password=` de connection
  string e blocos de chave privada. A contagem de trechos redigidos aparece no comentário.
- **Segredos nunca chegam aos logs**: o `GITHUB_TOKEN` e a chave de API são registrados no módulo de
  log e substituídos por `***` em qualquer escrita.
- **O Action não faz merge**, não aprova PR e não escreve no código.

---

## Limitações conhecidas

1. **Um comentário de resumo, não comentários inline.** Cada apontamento traz `arquivo:linha` com
   permalink clicável, mas não fica ancorado na linha do diff. Comentário inline exige a API de
   *review comments* com `position` calculado sobre o diff — viável como próximo passo, ao custo de
   descartar apontamentos cuja linha caia fora de um hunk.
2. **O modelo vê o diff, não o repositório inteiro.** Ele não segue chamadas para outros arquivos
   não alterados, salvo o conteúdo integral dos arquivos pequenos do próprio PR. Apontamentos que
   dependam de código não enviado vêm marcados como `suspeita`.
3. **PRs de fork não são revisados** (sem acesso a secrets).
4. **PRs muito grandes são revisados parcialmente**, respeitando os tetos. O comentário sempre lista
   o que ficou de fora.
5. **A qualidade da revisão depende das convenções declaradas** em `convencoes.md`. Quando uma
   convenção mudar, atualize o arquivo — é ali que se ajusta o comportamento do revisor, não no
   código.
6. **Só o que roda em runner hospedado.** Verificações nativas que dependam de rede interna,
   credencial corporativa ou toolchain proprietária exigem um runner self-hosted (`REVISAO_RUNNER`).
