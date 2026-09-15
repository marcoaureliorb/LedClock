/**
 * Acesso somente-leitura ao codigo do repositorio, para a fase de investigacao.
 *
 * Tudo o que o modelo pede passa por aqui, e aqui estao as tres travas:
 * o caminho precisa ficar dentro da raiz do repositorio, precisa casar com os
 * globs de `incluir` e nao casar com os de `excluir`, e o conteudo devolvido
 * passa pela redacao de segredos antes de virar prompt.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { correspondeAAlgum, normalizar, primeiroPadraoCorrespondente }
  from '../../revisao-ia/src/caminhos.mjs';
import { redigirSegredos } from '../../revisao-ia/src/segredos.mjs';

const DIRETORIOS_SEMPRE_IGNORADOS = new Set(['.git', 'node_modules', '.pio', '.vscode']);
const MAX_CARACTERES_POR_LINHA_DE_BUSCA = 240;

/**
 * Valida um caminho vindo do modelo e o resolve dentro da raiz.
 *
 * @returns {{ valido: boolean, motivo?: string, relativo?: string, absoluto?: string }}
 */
export function resolverCaminhoSeguro(caminhoBruto, raiz) {
  const caminho = normalizar(caminhoBruto);

  if (caminho === '') return { valido: false, motivo: 'caminho vazio' };

  if (caminho.includes('\0')) return { valido: false, motivo: 'caminho com byte nulo' };

  if (/^[a-zA-Z]:/.test(caminho) || caminho.startsWith('/')) {
    return { valido: false, motivo: 'caminho absoluto nao e permitido' };
  }

  if (caminho.split('/').includes('..')) {
    return { valido: false, motivo: 'caminho com ".." nao e permitido' };
  }

  const absoluto = resolve(raiz, caminho);
  const relativo = relative(raiz, absoluto);

  if (relativo === '' || relativo.startsWith('..') || relativo.includes(`..${sep}`)) {
    return { valido: false, motivo: 'caminho fora da raiz do repositorio' };
  }

  return { valido: true, relativo: normalizar(relativo), absoluto };
}

/** Indica se o caminho esta no escopo de leitura definido pela configuracao. */
export function estaNoEscopoDeLeitura(caminho, configuracao) {
  const excluido = primeiroPadraoCorrespondente(caminho, configuracao.excluir);

  if (excluido) return { permitido: false, motivo: `excluido por "${excluido}"` };

  if (!correspondeAAlgum(caminho, configuracao.incluir)) {
    return { permitido: false, motivo: 'extensao fora da lista de arquivos analisaveis' };
  }

  return { permitido: true };
}

/** Indica se o caminho pode ser alterado pela correcao automatica. */
export function estaNoEscopoDeEdicao(caminho, configuracao) {
  const leitura = estaNoEscopoDeLeitura(caminho, configuracao);

  if (!leitura.permitido) return leitura;

  if (!correspondeAAlgum(caminho, configuracao.editaveis)) {
    return {
      permitido: false,
      motivo: 'caminho fora da lista "editaveis" do corretor.config.json',
    };
  }

  return { permitido: true };
}

/**
 * Lista os arquivos analisaveis do repositorio, em ordem alfabetica.
 *
 * A lista e o mapa que o modelo recebe na primeira rodada: sem ela ele chuta
 * nomes de arquivo.
 */
export function listarArvore(raiz, configuracao) {
  const encontrados = [];
  const limite = configuracao.limites.maxArquivosNaArvore;

  function percorrer(diretorioAbsoluto) {
    let entradas;

    try {
      entradas = readdirSync(diretorioAbsoluto, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entrada of entradas.sort((a, b) => a.name.localeCompare(b.name))) {
      if (encontrados.length >= limite) return;

      if (entrada.name.startsWith('.') && DIRETORIOS_SEMPRE_IGNORADOS.has(entrada.name)) continue;

      const absoluto = join(diretorioAbsoluto, entrada.name);
      const caminho = normalizar(relative(raiz, absoluto));

      if (entrada.isDirectory()) {
        if (DIRETORIOS_SEMPRE_IGNORADOS.has(entrada.name)) continue;
        if (primeiroPadraoCorrespondente(`${caminho}/x`, configuracao.excluir)) continue;

        percorrer(absoluto);
        continue;
      }

      if (!entrada.isFile()) continue;
      if (!estaNoEscopoDeLeitura(caminho, configuracao).permitido) continue;

      let tamanho = 0;

      try {
        tamanho = statSync(absoluto).size;
      } catch {
        continue;
      }

      encontrados.push({ caminho, bytes: tamanho });
    }
  }

  percorrer(raiz);

  return {
    arquivos: encontrados,
    truncada: encontrados.length >= limite,
  };
}

/**
 * Le um arquivo para o prompt, com validacao de caminho, escopo e tamanho.
 *
 * @returns {{ ok: boolean, caminho: string, conteudo?: string, motivo?: string,
 *            truncado?: boolean, segredosRedigidos?: number }}
 */
export function lerArquivoParaAnalise(caminhoBruto, raiz, configuracao) {
  const seguro = resolverCaminhoSeguro(caminhoBruto, raiz);

  if (!seguro.valido) {
    return { ok: false, caminho: normalizar(caminhoBruto), motivo: seguro.motivo };
  }

  const escopo = estaNoEscopoDeLeitura(seguro.relativo, configuracao);

  if (!escopo.permitido) return { ok: false, caminho: seguro.relativo, motivo: escopo.motivo };

  let bruto;

  try {
    bruto = readFileSync(seguro.absoluto, 'utf8');
  } catch (erro) {
    return {
      ok: false,
      caminho: seguro.relativo,
      motivo: erro.code === 'ENOENT' ? 'arquivo inexistente' : `nao foi possivel ler: ${erro.code}`,
    };
  }

  const maximo = configuracao.limites.maxCaracteresPorArquivo;
  const truncado = bruto.length > maximo;
  const recortado = truncado ? `${bruto.slice(0, maximo)}\n[... arquivo truncado ...]` : bruto;
  const redigido = redigirSegredos(recortado);

  return {
    ok: true,
    caminho: seguro.relativo,
    conteudo: redigido.texto,
    truncado,
    segredosRedigidos: redigido.ocorrencias,
  };
}

/**
 * Le o conteudo integral e sem redacao de um arquivo, para aplicar a correcao.
 *
 * Diferente de `lerArquivoParaAnalise`: nao trunca e nao redige, porque o
 * resultado e gravado de volta em disco, nao enviado ao modelo.
 */
export function lerArquivoParaEdicao(caminhoBruto, raiz, configuracao) {
  const seguro = resolverCaminhoSeguro(caminhoBruto, raiz);

  if (!seguro.valido) {
    return { ok: false, caminho: normalizar(caminhoBruto), motivo: seguro.motivo };
  }

  const escopo = estaNoEscopoDeEdicao(seguro.relativo, configuracao);

  if (!escopo.permitido) return { ok: false, caminho: seguro.relativo, motivo: escopo.motivo };

  try {
    return {
      ok: true,
      caminho: seguro.relativo,
      absoluto: seguro.absoluto,
      conteudo: readFileSync(seguro.absoluto, 'utf8'),
      existe: true,
    };
  } catch (erro) {
    if (erro.code === 'ENOENT') {
      return { ok: true, caminho: seguro.relativo, absoluto: seguro.absoluto, conteudo: null, existe: false };
    }

    return { ok: false, caminho: seguro.relativo, motivo: `nao foi possivel ler: ${erro.code}` };
  }
}

/**
 * Busca literal (sem regex) por um termo nos arquivos analisaveis.
 *
 * Deliberadamente nao aceita expressao regular: o termo vem do modelo, que por
 * sua vez leu a Issue, e uma regex arbitraria e um vetor de negacao de servico.
 */
export function buscarNoCodigo(termo, raiz, configuracao) {
  const alvo = String(termo ?? '').trim();

  if (alvo.length < 3) {
    return { termo: alvo, ocorrencias: [], motivo: 'termo curto demais (minimo 3 caracteres)' };
  }

  const alvoMinusculo = alvo.toLowerCase();
  const limite = configuracao.limites.maxResultadosPorBusca;
  const ocorrencias = [];

  for (const arquivo of listarArvore(raiz, configuracao).arquivos) {
    if (ocorrencias.length >= limite) break;

    let conteudo;

    try {
      conteudo = readFileSync(resolve(raiz, arquivo.caminho), 'utf8');
    } catch {
      continue;
    }

    if (!conteudo.toLowerCase().includes(alvoMinusculo)) continue;

    const linhas = conteudo.split('\n');

    for (let indice = 0; indice < linhas.length; indice += 1) {
      if (ocorrencias.length >= limite) break;

      if (!linhas[indice].toLowerCase().includes(alvoMinusculo)) continue;

      ocorrencias.push({
        caminho: arquivo.caminho,
        linha: indice + 1,
        texto: redigirSegredos(linhas[indice].trim().slice(0, MAX_CARACTERES_POR_LINHA_DE_BUSCA)).texto,
      });
    }
  }

  return { termo: alvo, ocorrencias, truncada: ocorrencias.length >= limite };
}
