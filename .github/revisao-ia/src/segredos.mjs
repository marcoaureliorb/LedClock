/**
 * Redacao de segredos no conteudo enviado ao modelo.
 *
 * Segunda linha de defesa: arquivos notoriamente sensiveis ja sao descartados
 * pelos globs de exclusao (`revisor.config.json`). Aqui tratamos o caso de um
 * segredo introduzido no meio de um arquivo de codigo legitimo.
 */

const REGRAS = [
  {
    nome: 'atribuicao-sensivel',
    // "ClientSecret": "valor" | senha = 'valor' | ApiKey: "valor"
    regex:
      /((?:"|')?(?:senha|password|pwd|secret|client[_-]?secret|api[_-]?key|apikey|access[_-]?key|accesstoken|access[_-]?token|bearer[_-]?token|connection[_-]?string|instrumentationkey)(?:"|')?\s*[:=]\s*(?:"|'))([^"'\r\n]{4,})((?:"|'))/gi,
    substituir: (_todo, prefixo, _valor, sufixo) => `${prefixo}***REDIGIDO***${sufixo}`,
  },
  {
    nome: 'chave-anthropic',
    regex: /sk-ant-[A-Za-z0-9_-]{12,}/g,
    substituir: () => 'sk-ant-***REDIGIDO***',
  },
  {
    nome: 'chave-openai',
    regex: /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}/g,
    substituir: () => 'sk-***REDIGIDO***',
  },
  {
    nome: 'jwt',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    substituir: () => 'eyJ***REDIGIDO***',
  },
  {
    nome: 'senha-em-connection-string',
    regex: /\b(Password|Pwd)\s*=\s*[^;"'\r\n]+/gi,
    substituir: (_todo, chave) => `${chave}=***REDIGIDO***`,
  },
  {
    nome: 'chave-privada',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    substituir: () => '-----BEGIN PRIVATE KEY-----***REDIGIDO***-----END PRIVATE KEY-----',
  },
];

/**
 * Aplica todas as regras de redacao.
 *
 * @returns {{ texto: string, ocorrencias: number }}
 */
export function redigirSegredos(conteudo) {
  let texto = String(conteudo ?? '');
  let ocorrencias = 0;

  for (const regra of REGRAS) {
    texto = texto.replace(regra.regex, (...argumentos) => {
      ocorrencias += 1;

      return regra.substituir(...argumentos);
    });
  }

  return { texto, ocorrencias };
}
