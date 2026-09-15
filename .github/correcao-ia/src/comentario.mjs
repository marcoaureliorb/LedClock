/**
 * Renderizacao dos comentarios publicados na Issue e da descricao do Pull
 * Request.
 *
 * Todo texto produzido aqui deixa explicito que a origem e um agente de IA e
 * que a revisao humana e obrigatoria.
 */

const LIMITE_DO_COMENTARIO = 60000;

export const MARCADOR = '<!-- correcao-ia -->';

const RODAPE_DE_IA = '_Comentario gerado automaticamente por um agente de IA '
  + '(`.github/correcao-ia`). Nenhuma alteracao e feita na `main` por esta automacao._';

function recortar(corpo) {
  if (corpo.length <= LIMITE_DO_COMENTARIO) return corpo;

  return `${corpo.slice(0, LIMITE_DO_COMENTARIO)}\n\n> _Comentario truncado por exceder o limite do GitHub._`;
}

function listar(itens, vazio = '- (nenhum)') {
  return itens.length === 0 ? [vazio] : itens.map((item) => `- ${item}`);
}

function blocoDeInvestigacao(analise) {
  const linhas = ['### Investigacao realizada', ''];

  linhas.push(
    `- Arquivos analisados: ${analise.arquivosInvestigados.length}`,
    ...analise.arquivosInvestigados.map((caminho) => `  - \`${caminho}\``),
  );

  if (analise.buscasRealizadas.length > 0) {
    linhas.push(
      `- Buscas realizadas no codigo:`,
      ...analise.buscasRealizadas.map((termo) => `  - \`${termo}\``),
    );
  }

  if (analise.confianca !== null) {
    linhas.push(
      `- Confianca estimada pelo modelo: **${analise.confianca}** `
        + '(estimativa da propria IA, nao evidencia de correcao)',
    );
  }

  return linhas;
}

/**
 * Comentario para status `uncertain` ou `not_found`: nenhuma alteracao feita.
 */
export function renderizarComentarioDeAnaliseManual({ analise, issue }) {
  const linhas = [
    MARCADOR,
    '## Analise automatizada de bug',
    '',
    analise.status === 'not_found'
      ? 'O agente de IA **nao conseguiu identificar a causa** do problema descrito nesta Issue.'
      : 'O agente de IA **nao reuniu evidencias suficientes** para propor uma correcao com seguranca.',
    '',
    ...blocoDeInvestigacao(analise),
    '',
  ];

  if (analise.resumo) linhas.push('### Resumo da investigacao', '', analise.resumo, '');

  if (analise.causaRaiz) {
    linhas.push('### Possiveis causas consideradas', '', analise.causaRaiz, '');
  }

  if (analise.solucaoProposta) {
    linhas.push('### Caminho sugerido (nao implementado)', '', analise.solucaoProposta, '');
  }

  if (analise.arquivosDescartados.length > 0) {
    linhas.push(
      '### Caminhos citados pela IA que foram descartados na validacao',
      '',
      ...analise.arquivosDescartados.map((item) => `- \`${item.caminho}\` - ${item.motivo}`),
      '',
    );
  }

  linhas.push(
    '### Informacoes que ajudariam a concluir',
    '',
    analise.analiseManual
      ?? 'Passos para reproduzir o erro, mensagem ou stack trace completo, versao do firmware e '
        + 'condicoes em que o problema aparece.',
    '',
    '---',
    '',
    `**Nenhuma alteracao foi realizada no codigo.** Nenhuma branch foi criada e nenhum Pull Request `
      + `foi aberto para a Issue #${issue.numero}. A analise manual e recomendada.`,
    '',
    RODAPE_DE_IA,
  );

  return recortar(linhas.join('\n'));
}

/**
 * Comentario quando a correcao foi implementada mas as validacoes reprovaram.
 */
export function renderizarComentarioDeValidacaoReprovada({
  analise,
  issue,
  resultados,
  avaliacao,
  branch,
}) {
  const linhas = [
    MARCADOR,
    '## Correcao automatizada interrompida',
    '',
    'O agente identificou uma causa provavel e implementou uma correcao, mas **as validacoes do',
    'projeto nao passaram**. Nenhum Pull Request foi aberto: a saida da IA nao e evidencia de que o',
    'bug foi corrigido, e sem build verde nao ha o que revisar.',
    '',
    `- Issue: #${issue.numero}`,
    `- Branch de trabalho (nao publicada): \`${branch}\``,
    `- Motivo: ${avaliacao.motivo}`,
    '',
    '### Causa identificada',
    '',
    analise.causaRaiz || '(nao informada)',
    '',
    '### Resultado das validacoes',
    '',
  ];

  for (const resultado of resultados) {
    linhas.push(`- \`${resultado.comando}\` - **${resultado.situacao}** (${resultado.detalhe})`);
  }

  const comSaida = resultados.filter((item) => item.situacao !== 'sucesso' && item.saida);

  for (const resultado of comSaida) {
    linhas.push(
      '',
      `<details><summary>Saida de <code>${resultado.comando}</code></summary>`,
      '',
      '```',
      resultado.saida,
      '```',
      '',
      '</details>',
    );
  }

  linhas.push(
    '',
    '### Sugestao para a analise manual',
    '',
    analise.solucaoProposta || '(a IA nao detalhou a solucao)',
    '',
    '---',
    '',
    '**Nenhuma alteracao foi publicada.** A analise manual e necessaria.',
    '',
    RODAPE_DE_IA,
  );

  return recortar(linhas.join('\n'));
}

/** Comentario de interrupcao por erro tecnico (provedor, aplicacao da correcao, Git). */
export function renderizarComentarioDeInterrupcao({ issue, etapa, mensagem, detalhes = [] }) {
  const linhas = [
    MARCADOR,
    '## Correcao automatizada interrompida',
    '',
    `A automacao parou na etapa **${etapa}** e **nao alterou o codigo**.`,
    '',
    `- Issue: #${issue.numero}`,
    `- Motivo: ${mensagem}`,
    '',
  ];

  if (detalhes.length > 0) linhas.push('### Detalhes', '', ...listar(detalhes), '');

  linhas.push(
    'Nenhuma branch automatica foi publicada e nenhum Pull Request foi aberto.',
    '',
    RODAPE_DE_IA,
  );

  return recortar(linhas.join('\n'));
}

/** Comentario de sucesso, com o link do Pull Request aberto. */
export function renderizarComentarioDePullRequest({ issue, analise, pullRequest, branch }) {
  return recortar([
    MARCADOR,
    '## Correcao automatizada proposta',
    '',
    `Foi aberto o Pull Request ${pullRequest.html_url} com uma correcao candidata para a Issue #${issue.numero}.`,
    '',
    `- Branch: \`${branch}\``,
    `- Causa identificada: ${analise.causaRaiz || '(nao informada)'}`,
    '',
    '**A correcao foi gerada por IA e exige revisao humana antes do merge.** A automacao nao aprova',
    'nem faz merge de Pull Request.',
    '',
    RODAPE_DE_IA,
  ].join('\n'));
}

/** Comentario quando ja existe um Pull Request automatico aberto para a Issue. */
export function renderizarComentarioDePullRequestExistente({ issue, pullRequest, branch }) {
  return recortar([
    MARCADOR,
    '## Correcao automatizada ja em andamento',
    '',
    `Ja existe um Pull Request automatico aberto para a Issue #${issue.numero}: ${pullRequest.html_url}`,
    '',
    `- Branch: \`${branch}\``,
    '',
    'Nenhuma nova analise foi executada e nenhum Pull Request adicional foi aberto, para nao duplicar',
    'trabalho. Feche ou faca o merge do Pull Request existente e, se ainda for necessario, peca uma',
    'nova analise.',
    '',
    RODAPE_DE_IA,
  ].join('\n'));
}

/**
 * Descricao do Pull Request.
 *
 * Referencia a Issue com `Fixes #n`, descreve causa e solucao, lista arquivos e
 * validacoes executadas, e deixa a exigencia de revisao humana explicita.
 */
export function renderizarDescricaoDoPullRequest({
  issue,
  analise,
  correcao,
  arquivosAlterados,
  resultados,
  provedor,
}) {
  const linhas = [
    '## Correcao automatizada de bug',
    '',
    `Fixes #${issue.numero}`,
    '',
    '### Problema identificado',
    '',
    analise.causaRaiz || '(nao informada)',
    '',
  ];

  if (analise.resumo) linhas.push('**Resumo:** ' + analise.resumo, '');

  linhas.push(
    '### Solucao implementada',
    '',
    correcao.resumo || analise.solucaoProposta || '(nao informada)',
    '',
  );

  if (correcao.alteracoes.length > 0) {
    linhas.push(
      '<details><summary>Alteracoes por arquivo</summary>',
      '',
      ...correcao.alteracoes.map(
        (alteracao) => `- \`${alteracao.caminho}\`: ${alteracao.descricao || '(sem descricao)'}`,
      ),
      '',
      '</details>',
      '',
    );
  }

  linhas.push(
    '### Arquivos alterados',
    '',
    ...listar(arquivosAlterados.map((caminho) => `\`${caminho}\``)),
    '',
    '### Validacoes',
    '',
  );

  for (const resultado of resultados) {
    const marca = resultado.situacao === 'sucesso' ? 'x' : ' ';

    linhas.push(`- [${marca}] \`${resultado.comando}\` - ${resultado.situacao} (${resultado.detalhe})`);
  }

  if (analise.testesSugeridos.length > 0) {
    linhas.push(
      '',
      '<details><summary>Validacoes sugeridas pela IA (informativo, nao executadas automaticamente)</summary>',
      '',
      ...analise.testesSugeridos.map((teste) => `- \`${teste}\``),
      '',
      '</details>',
    );
  }

  if (analise.planoDeImplementacao.length > 0) {
    linhas.push(
      '',
      '<details><summary>Plano de implementacao seguido</summary>',
      '',
      ...analise.planoDeImplementacao.map((passo, indice) => `${indice + 1}. ${passo}`),
      '',
      '</details>',
    );
  }

  linhas.push(
    '',
    '### Observacoes',
    '',
    '**Esta correcao foi gerada por um agente de IA** a partir da Issue referenciada.',
    'A revisao humana e obrigatoria antes do merge: a automacao nao aprova e nao faz merge de',
    'Pull Request, e a estimativa de confianca da IA nao e evidencia de que o bug foi corrigido.',
    '',
    `Confianca estimada pelo modelo: ${analise.confianca ?? 'nao informada'}.`,
    `Provedor: \`${provedor.nome}\` | Modelo: \`${provedor.modelo}\`.`,
  );

  return recortar(linhas.join('\n'));
}

/** Titulo do Pull Request. */
export function montarTituloDoPullRequest(issue, correcao) {
  const descricao = correcao.mensagemDeCommit
    || issue.titulo.replace(/^\s*\[BUG\]\s*/i, '').trim()
    || `corrige o problema relatado na issue ${issue.numero}`;

  return `fix: ${descricao.charAt(0).toLowerCase()}${descricao.slice(1)}`.slice(0, 120);
}

/** Mensagem do commit automatico. */
export function montarMensagemDeCommit(issue, correcao) {
  const titulo = montarTituloDoPullRequest(issue, correcao);

  return [
    titulo,
    '',
    correcao.resumo || 'Correcao gerada automaticamente a partir da analise da Issue.',
    '',
    `Refs #${issue.numero}`,
    '',
    'Correcao gerada por agente de IA. Requer revisao humana.',
  ].join('\n');
}
