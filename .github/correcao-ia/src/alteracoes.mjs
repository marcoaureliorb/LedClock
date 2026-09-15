/**
 * Aplicacao das alteracoes propostas pelo modelo.
 *
 * O formato e busca/substituicao com trecho exato, nao patch unificado e nao
 * reescrita do arquivo inteiro. A razao e a taxa de erro: patch produzido por
 * modelo erra deslocamento de hunk com frequencia, e reescrita integral de um
 * arquivo de 900 linhas perde trechos silenciosamente. Aqui, um trecho que nao
 * casa exatamente uma vez interrompe a correcao em vez de corromper o arquivo.
 *
 * A funcao e pura: recebe e devolve conteudo em memoria. Quem grava em disco e
 * o orquestrador, depois de conferir o resultado.
 */

/** Conta ocorrencias de um literal, sem regex. */
function contarOcorrencias(conteudo, trecho) {
  if (trecho === '') return 0;

  let total = 0;
  let posicao = conteudo.indexOf(trecho);

  while (posicao !== -1) {
    total += 1;
    posicao = conteudo.indexOf(trecho, posicao + trecho.length);
  }

  return total;
}

/**
 * Normaliza fim de linha do conteudo do arquivo para comparacao.
 *
 * Um arquivo com CRLF nunca casaria com um trecho vindo de JSON, que traz "\n".
 * Comparar em LF e reaplicar o estilo original resolve sem reescrever o arquivo
 * inteiro.
 */
function paraLf(texto) {
  return texto.replace(/\r\n/g, '\n');
}

/**
 * Normaliza um trecho devolvido pelo modelo.
 *
 * Alem do CRLF, remove o `\r` solto: quem copia de um arquivo CRLF costuma
 * devolver a linha terminada so em "\r", e esse unico caractere invisivel
 * transformaria uma correcao valida em "trecho nao encontrado". Ele e removido,
 * e nao convertido em "\n" — converter faria o trecho consumir a quebra de
 * linha seguinte e colaria duas linhas do arquivo.
 */
function normalizarTrechoDoModelo(texto) {
  return paraLf(texto).replace(/\r/g, '');
}

function usaCrlf(conteudo) {
  return conteudo.includes('\r\n');
}

function paraCrlf(texto) {
  return texto.replace(/\r?\n/g, '\r\n');
}

export class AlteracaoInaplicavelError extends Error {
  constructor(caminho, motivo) {
    super(`Nao foi possivel aplicar a alteracao em "${caminho}": ${motivo}`);
    this.name = 'AlteracaoInaplicavelError';
    this.caminho = caminho;
    this.motivo = motivo;
  }
}

/**
 * Aplica as alteracoes sobre um mapa de conteudos.
 *
 * @param {Map<string,string|null>} conteudoPorArquivo conteudo atual; `null` = arquivo inexistente
 * @param {Array<{caminho:string,trechoOriginal:string,trechoNovo:string,descricao:string}>} alteracoes
 * @returns {{ resultado: Map<string,string>, aplicadas: object[] }}
 * @throws {AlteracaoInaplicavelError} quando um trecho nao casa exatamente uma vez
 */
export function aplicarAlteracoes(conteudoPorArquivo, alteracoes) {
  const resultado = new Map();
  const aplicadas = [];

  for (const alteracao of alteracoes) {
    const { caminho, trechoOriginal, trechoNovo } = alteracao;

    if (!conteudoPorArquivo.has(caminho)) {
      throw new AlteracaoInaplicavelError(caminho, 'arquivo nao foi carregado para edicao');
    }

    const original = conteudoPorArquivo.get(caminho);
    const atual = resultado.has(caminho) ? resultado.get(caminho) : original;

    // Criacao de arquivo novo.
    if (trechoOriginal === '') {
      if (atual !== null && atual !== undefined) {
        throw new AlteracaoInaplicavelError(
          caminho,
          'a alteracao pede criacao de arquivo, mas o arquivo ja existe',
        );
      }

      resultado.set(caminho, trechoNovo.endsWith('\n') ? trechoNovo : `${trechoNovo}\n`);
      aplicadas.push({ caminho, tipo: 'criacao', descricao: alteracao.descricao });
      continue;
    }

    if (atual === null || atual === undefined) {
      throw new AlteracaoInaplicavelError(
        caminho,
        'a alteracao referencia um trecho existente, mas o arquivo nao existe',
      );
    }

    const crlf = usaCrlf(atual);
    const conteudoLf = paraLf(atual);
    const originalLf = normalizarTrechoDoModelo(trechoOriginal);
    const novoLf = normalizarTrechoDoModelo(trechoNovo);

    const ocorrencias = contarOcorrencias(conteudoLf, originalLf);

    if (ocorrencias === 0) {
      throw new AlteracaoInaplicavelError(
        caminho,
        'o trecho original informado nao foi encontrado no arquivo',
      );
    }

    if (ocorrencias > 1) {
      throw new AlteracaoInaplicavelError(
        caminho,
        `o trecho original aparece ${ocorrencias} vezes no arquivo e nao identifica um ponto unico`,
      );
    }

    const alterado = conteudoLf.replace(originalLf, () => novoLf);

    resultado.set(caminho, crlf ? paraCrlf(alterado) : alterado);
    aplicadas.push({ caminho, tipo: 'edicao', descricao: alteracao.descricao });
  }

  return { resultado, aplicadas };
}

/**
 * Resume as alteracoes em contagem de linhas, para exibir no Pull Request.
 */
export function resumirAlteracoes(conteudoPorArquivo, resultado) {
  return [...resultado.entries()].map(([caminho, novo]) => {
    const antes = conteudoPorArquivo.get(caminho);

    const linhasAntes = typeof antes === 'string' ? paraLf(antes).split('\n').length : 0;
    const linhasDepois = paraLf(novo).split('\n').length;

    return {
      caminho,
      novo: typeof antes !== 'string',
      linhasAntes,
      linhasDepois,
      variacao: linhasDepois - linhasAntes,
    };
  });
}
