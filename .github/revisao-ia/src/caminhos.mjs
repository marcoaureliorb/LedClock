/**
 * Correspondencia de caminhos por glob, sem dependencias externas.
 *
 * Suporta `**` (qualquer numero de diretorios), `*` (qualquer trecho dentro de
 * um segmento) e `?` (um caractere dentro de um segmento).
 */

const cacheDeRegex = new Map();

const CARACTERES_ESPECIAIS = '\\^$.|+()[]{}';

/** Normaliza separadores e remove `./` inicial. */
export function normalizar(caminho) {
  return String(caminho ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

function padraoParaRegex(padrao) {
  let expressao = '';

  for (let i = 0; i < padrao.length; i += 1) {
    const caractere = padrao[i];

    if (caractere === '*') {
      const ehGlobstar = padrao[i + 1] === '*';

      if (ehGlobstar && padrao[i + 2] === '/') {
        expressao += '(?:[^/]*/)*';
        i += 2;
      } else if (ehGlobstar) {
        expressao += '.*';
        i += 1;
      } else {
        expressao += '[^/]*';
      }
    } else if (caractere === '?') {
      expressao += '[^/]';
    } else if (CARACTERES_ESPECIAIS.includes(caractere)) {
      expressao += `\\${caractere}`;
    } else {
      expressao += caractere;
    }
  }

  return new RegExp(`^${expressao}$`, 'i');
}

function obterRegex(padrao) {
  if (!cacheDeRegex.has(padrao)) cacheDeRegex.set(padrao, padraoParaRegex(padrao));

  return cacheDeRegex.get(padrao);
}

/** Indica se o caminho corresponde a pelo menos um dos padroes informados. */
export function correspondeAAlgum(caminho, padroes) {
  if (!Array.isArray(padroes) || padroes.length === 0) return false;

  const alvo = normalizar(caminho);

  return padroes.some((padrao) => obterRegex(padrao).test(alvo));
}

/** Retorna o primeiro padrao que corresponde ao caminho, ou `null`. */
export function primeiroPadraoCorrespondente(caminho, padroes) {
  if (!Array.isArray(padroes)) return null;

  const alvo = normalizar(caminho);

  return padroes.find((padrao) => obterRegex(padrao).test(alvo)) ?? null;
}
