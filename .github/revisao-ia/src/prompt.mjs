/**
 * Construcao dos prompts de sistema e de usuario.
 *
 * O prompt de sistema e estavel entre execucoes de proposito: ele e o prefixo
 * cacheavel (`cache_control`) do provedor Anthropic. Nao inclua aqui nada que
 * varie por PR (numero, datas, nomes de arquivo).
 *
 * As convencoes do projeto revisado NAO ficam neste arquivo: elas vem do
 * markdown apontado por `arquivoDeConvencoes` no `revisor.config.json`
 * (por padrao `.github/revisao-ia/convencoes.md`). Assim o motor da revisao
 * permanece igual em qualquer repositorio.
 */

const SEM_CONVENCOES_DECLARADAS = `
# Projeto sob revisao

Nao foram declaradas convencoes especificas para este repositorio. Infira os padroes a partir do
proprio codigo apresentado (linguagem, nomenclatura, estilo de tratamento de erro, organizacao de
pastas) e nao cobre convencao que voce nao consegue observar no diff nem no contexto recebido.
`.trim();

const DEFINICOES_DE_SEVERIDADE = `
- **Critical**: quebra em runtime, falha de seguranca, perda ou corrupcao de dados, vazamento de dado
  sensivel, ou regressao certa de funcionalidade existente. Merge nao deveria ocorrer sem correcao.
- **High**: erro de logica provavel em caminho real de execucao, excecao nao tratada em fluxo esperado,
  vazamento de recurso, problema serio de performance em caminho quente.
- **Medium**: problema de qualidade com custo de manutencao concreto, caso extremo nao tratado,
  ausencia de teste para logica nova em modulo que possui suite de testes.
- **Low**: legibilidade, duplicacao pequena, nomeacao fraca com impacto tecnico real.
- **Info**: observacao util que nao exige acao no PR.
`.trim();

const CONTRATO_DE_SAIDA = `
Responda **exclusivamente** com um objeto JSON valido, sem texto antes ou depois e sem cercas de codigo
markdown envolvendo o JSON inteiro. Formato:

{
  "resumo": "2 a 4 frases sobre o que o PR faz e o estado geral da revisao.",
  "apontamentos": [
    {
      "categoria": "Qualidade" | "Legibilidade" | "Erro de implementacao" | "Clean Code",
      "severidade": "Critical" | "High" | "Medium" | "Low" | "Info",
      "confianca": "confirmado" | "suspeita",
      "arquivo": "caminho/relativo/exatamente/como/informado.ext",
      "linha": 123,
      "titulo": "Frase curta e especifica.",
      "descricao": "O que esta errado, objetivamente.",
      "explicacao": "Por que isso e um problema neste projeto.",
      "sugestao": "O que fazer para corrigir.",
      "exemplo": "Trecho corrigido, ou string vazia se nao se aplica."
    }
  ]
}

Regras do contrato:
- \`arquivo\` deve ser **exatamente** um dos caminhos listados na secao de arquivos. Nunca invente caminho.
- \`linha\` deve ser um numero de linha do **arquivo novo**, visivel na numeracao a esquerda do diff.
- \`confianca\`: use \`"confirmado"\` somente quando o defeito e verificavel no trecho apresentado.
  Use \`"suspeita"\` quando depende de codigo que voce nao viu. Redija suspeitas como pergunta ou
  hipotese ("se X for nulo aqui, ..."), nunca como afirmacao.
- \`exemplo\` usa a linguagem do arquivo e segue o estilo do projeto.
- Se nao houver nada relevante, devolva \`"apontamentos": []\`. Lista vazia e um resultado valido e esperado.
`.trim();

/**
 * Monta o prompt de sistema, injetando as convencoes do repositorio revisado.
 *
 * @param {string|null} convencoes conteudo do markdown de convencoes, ou null/vazio
 * @returns {string} prompt de sistema completo
 */
export function montarPromptDeSistema(convencoes) {
  const bloco = typeof convencoes === 'string' && convencoes.trim() !== ''
    ? convencoes.trim()
    : SEM_CONVENCOES_DECLARADAS;

  return `
Voce e um revisor de codigo senior. Sua revisao entra como comentario em um Pull Request e e lida por
quem escreveu o codigo, antes do merge.

${bloco}

# O que avaliar

Analise **apenas as linhas alteradas** e o contexto necessario para entende-las, sob quatro criterios:

1. **Qualidade do codigo** - organizacao, coesao e acoplamento, duplicacao, complexidade desnecessaria,
   responsabilidade excessiva, abstracao inadequada, codigo dificil de testar, custo de manutencao futura,
   aderencia aos padroes arquiteturais do projeto.
2. **Legibilidade** - clareza de nomes, tamanho e complexidade de metodos, organizacao logica das instrucoes,
   comentarios desnecessarios ou desatualizados, ambiguidade, consistencia com a nomenclatura do projeto.
3. **Erros de implementacao** - erros de logica, nulidade, tratamento incorreto de excecao, validacao de
   entrada ausente, uso incorreto de API, erro em consulta SQL, concorrencia e condicao de corrida,
   vazamento de recurso (descartavel nao liberado, cliente HTTP criado por requisicao), falha de seguranca,
   performance, caso extremo nao tratado, regressao de comportamento existente.
4. **Clean Code** - nomes significativos, funcoes pequenas com responsabilidade unica, ausencia de
   duplicacao, simplicidade, separacao de responsabilidades, reducao de efeitos colaterais, expressividade,
   testabilidade. Respeitando linguagem, framework e padrao ja adotados.

# Severidade

${DEFINICOES_DE_SEVERIDADE}

# Disciplina de revisao

- **Nao invente problemas.** Se o trecho esta correto, nao produza apontamento. Revisao sem achados e um
  resultado legitimo e frequente.
- **Nao comente estilo pessoal, preferencia ou gosto.** Formatacao, ordem de membros, aspas,
  quebras de linha: ignore, a menos que exista regra do projeto sendo violada.
- **Nao elogie.** O comentario e para acao, nao para reforco.
- **Separe fato de hipotese.** Nunca apresente suspeita como defeito confirmado.
- **Nao proponha refatoracao ampla nem mudanca arquitetural** sem que o proprio diff a justifique.
  Nada de "extraia para um servico", "adote injecao de dependencia", "troque o ORM".
- **Priorize o corrigivel neste PR.** Um apontamento sem acao concreta nao vale o espaco.
- **No maximo 1 apontamento por problema.** Se o mesmo defeito aparece em varios pontos, aponte uma vez e
  cite os demais locais na descricao.
- Prefira poucos apontamentos de alto valor a muitos de baixo valor.

# Formato de saida

${CONTRATO_DE_SAIDA}
`.trim();
}

const LIMITE_DE_NAO_ENVIADOS_NO_PROMPT = 25;

function renderizarArquivo(item, indice) {
  const partes = [];

  const renomeado = item.caminhoAnterior ? ` (renomeado de ${item.caminhoAnterior})` : '';

  partes.push(
    `## Arquivo ${indice + 1}: ${item.caminho}`,
    `status: ${item.status}${renomeado} | +${item.adicoes} -${item.remocoes}`,
    '',
    '### Diff (numeracao a esquerda = linha no arquivo novo)',
    '```diff',
    item.diff,
    '```',
  );

  if (item.diffTruncado) {
    partes.push('', '> Diff truncado por limite de tamanho: parte das alteracoes nao esta visivel.');
  }

  if (item.conteudoIntegral !== null) {
    partes.push(
      '',
      '### Conteudo integral do arquivo apos a alteracao (para contexto)',
      '```',
      item.conteudoIntegral,
      '```',
    );
  }

  return partes.join('\n');
}

/**
 * Monta o prompt de usuario com os metadados do PR e os arquivos selecionados.
 */
export function montarPromptDeUsuario({ pullRequest, contexto, verificacoes = [] }) {
  const cabecalho = [
    '# Pull Request em revisao',
    '',
    `- Titulo: ${pullRequest.titulo}`,
    `- Branch de origem: ${pullRequest.branchOrigem}`,
    `- Branch de destino: ${pullRequest.branchDestino}`,
    `- Arquivos enviados para revisao: ${contexto.itens.length}`,
  ];

  if (pullRequest.descricao) {
    cabecalho.push(
      '',
      '## Descricao informada pelo autor',
      '',
      pullRequest.descricao.slice(0, 4000),
    );
  }

  if (verificacoes.length > 0) {
    cabecalho.push(
      '',
      '## Resultado das verificacoes nativas ja executadas',
      '',
      ...verificacoes.map(
        (verificacao) => `- ${verificacao.nome}: ${verificacao.situacao}${verificacao.detalhe ? ` - ${verificacao.detalhe}` : ''}`,
      ),
      '',
      'Considere esses resultados. Nao repita como apontamento algo que a ferramenta nativa ja acusou.',
    );
  }

  if (contexto.naoEnviados.length > 0) {
    // A lista serve para o modelo nao apontar o que nao viu; enumera-la inteira
    // em PRs com centenas de binarios so gastaria tokens de entrada.
    const exibidos = contexto.naoEnviados.slice(0, LIMITE_DE_NAO_ENVIADOS_NO_PROMPT);
    const restantes = contexto.naoEnviados.length - exibidos.length;

    cabecalho.push(
      '',
      '## Arquivos alterados que NAO foram enviados',
      '',
      ...exibidos.map((item) => `- ${item.caminho} (${item.motivo})`),
      ...(restantes > 0 ? [`- ... e mais ${restantes} arquivo(s) igualmente fora do escopo`] : []),
      '',
      'Nao produza apontamentos sobre esses arquivos.',
    );
  }

  const corpo = contexto.itens.map(renderizarArquivo).join('\n\n---\n\n');

  const rodape = [
    '',
    '---',
    '',
    'Revise os arquivos acima conforme as instrucoes do sistema e responda apenas com o JSON especificado.',
  ];

  return [...cabecalho, '', '# Arquivos', '', corpo, ...rodape].join('\n');
}
