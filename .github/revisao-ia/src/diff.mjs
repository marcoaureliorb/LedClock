/**
 * Selecao dos arquivos do PR, anotacao dos diffs e controle do orcamento de
 * conteudo enviado ao modelo.
 */

import { correspondeAAlgum, normalizar, primeiroPadraoCorrespondente } from './caminhos.mjs';
import { redigirSegredos } from './segredos.mjs';

const LARGURA_DA_NUMERACAO = 5;

function numerar(valor) {
  return String(valor ?? '').padStart(LARGURA_DA_NUMERACAO, ' ');
}

/**
 * Prefixa cada linha do patch com o numero da linha correspondente no arquivo
 * novo. Sem isso o modelo precisa somar deslocamentos de hunk na mao e erra a
 * linha citada no apontamento.
 */
export function anotarPatch(patch) {
  if (!patch) return '';

  const linhas = String(patch).split('\n');
  const saida = [];

  let linhaNova = 0;

  for (const linha of linhas) {
    const cabecalho = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(linha);

    if (cabecalho) {
      linhaNova = Number.parseInt(cabecalho[1], 10);
      saida.push(linha);
      continue;
    }

    if (linha.startsWith('\\')) {
      saida.push(linha);
      continue;
    }

    const marcador = linha[0] ?? ' ';
    const conteudo = linha.slice(1);

    if (marcador === '+') {
      saida.push(`+${numerar(linhaNova)} | ${conteudo}`);
      linhaNova += 1;
    } else if (marcador === '-') {
      saida.push(`-${numerar('')} | ${conteudo}`);
    } else {
      saida.push(` ${numerar(linhaNova)} | ${conteudo}`);
      linhaNova += 1;
    }
  }

  return saida.join('\n');
}

/**
 * Separa os arquivos do PR entre revisaveis e ignorados, com o motivo da
 * exclusao registrado para exibicao no comentario.
 */
export function selecionarArquivos(arquivosDoPr, configuracao) {
  const selecionados = [];
  const ignorados = [];

  for (const arquivo of arquivosDoPr ?? []) {
    const caminho = normalizar(arquivo.filename);

    if (arquivo.status === 'removed') {
      ignorados.push({ caminho, motivo: 'arquivo removido' });
      continue;
    }

    const padraoExcluido = primeiroPadraoCorrespondente(caminho, configuracao.excluir);

    if (padraoExcluido) {
      ignorados.push({ caminho, motivo: `excluido por "${padraoExcluido}"` });
      continue;
    }

    if (!correspondeAAlgum(caminho, configuracao.incluir)) {
      ignorados.push({ caminho, motivo: 'extensao fora da lista de revisao' });
      continue;
    }

    if (!arquivo.patch) {
      ignorados.push({ caminho, motivo: 'sem diff textual (binario ou alteracao muito grande)' });
      continue;
    }

    selecionados.push({
      caminho,
      status: arquivo.status,
      adicoes: arquivo.additions ?? 0,
      remocoes: arquivo.deletions ?? 0,
      patch: arquivo.patch,
      caminhoAnterior: arquivo.previous_filename ? normalizar(arquivo.previous_filename) : null,
    });
  }

  return { selecionados, ignorados };
}

/**
 * Monta o conteudo textual enviado ao modelo respeitando os limites de
 * caracteres. Retorna tambem o que foi cortado, para transparencia no PR.
 *
 * @param {object} parametros
 * @param {Function} parametros.lerArquivo (caminho) => string|null
 */
export function montarContexto({ selecionados, configuracao, lerArquivo }) {
  const { maxArquivos, maxCaracteresTotal, maxCaracteresPorArquivo, maxLinhasParaArquivoCompleto } =
    configuracao.limites;

  const itens = [];
  const naoEnviados = [];

  let caracteresTotais = 0;
  let segredosRedigidos = 0;

  for (const arquivo of selecionados) {
    if (itens.length >= maxArquivos) {
      naoEnviados.push({ caminho: arquivo.caminho, motivo: `limite de ${maxArquivos} arquivos` });
      continue;
    }

    let diff = anotarPatch(arquivo.patch);
    let diffTruncado = false;

    if (diff.length > maxCaracteresPorArquivo) {
      diff = `${diff.slice(0, maxCaracteresPorArquivo)}\n[... diff truncado ...]`;
      diffTruncado = true;
    }

    const redacaoDoDiff = redigirSegredos(diff);

    let conteudoIntegral = null;

    const orcamentoRestante = maxCaracteresTotal - caracteresTotais - redacaoDoDiff.texto.length;

    if (orcamentoRestante > 0) {
      const bruto = lerArquivo(arquivo.caminho);

      if (typeof bruto === 'string') {
        const linhas = bruto.split('\n').length;

        if (linhas <= maxLinhasParaArquivoCompleto && bruto.length <= orcamentoRestante) {
          conteudoIntegral = bruto;
        }
      }
    }

    const redacaoDoConteudo = redigirSegredos(conteudoIntegral ?? '');

    const custo = redacaoDoDiff.texto.length + redacaoDoConteudo.texto.length;

    if (caracteresTotais + custo > maxCaracteresTotal && itens.length > 0) {
      naoEnviados.push({
        caminho: arquivo.caminho,
        motivo: `limite de ${maxCaracteresTotal} caracteres atingido`,
      });
      continue;
    }

    segredosRedigidos += redacaoDoDiff.ocorrencias + redacaoDoConteudo.ocorrencias;
    caracteresTotais += custo;

    itens.push({
      caminho: arquivo.caminho,
      status: arquivo.status,
      adicoes: arquivo.adicoes,
      remocoes: arquivo.remocoes,
      caminhoAnterior: arquivo.caminhoAnterior,
      diff: redacaoDoDiff.texto,
      conteudoIntegral: conteudoIntegral === null ? null : redacaoDoConteudo.texto,
      diffTruncado,
    });
  }

  return { itens, naoEnviados, caracteresTotais, segredosRedigidos };
}
