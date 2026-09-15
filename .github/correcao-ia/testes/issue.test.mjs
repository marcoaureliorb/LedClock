import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ehBug,
  gerarSlug,
  montarNomeDaBranch,
  normalizarIssue,
  pedeReanalise,
} from '../src/issue.mjs';

const CONFIGURACAO = {
  rotulosDeBug: ['bug'],
  prefixosDeTitulo: ['[BUG]'],
  limites: { maxCaracteresDaIssue: 200, maxComentariosDaIssue: 2 },
};

describe('ehBug', () => {
  it('reconhece a Issue pelo rotulo', () => {
    assert.equal(ehBug({ titulo: 'Cor errada', rotulos: ['bug'] }, CONFIGURACAO), true);
  });

  it('reconhece o rotulo sem diferenciar caixa nem acento', () => {
    assert.equal(ehBug({ titulo: 'x', rotulos: ['BUG'] }, CONFIGURACAO), true);
  });

  it('reconhece a Issue pelo prefixo do titulo', () => {
    assert.equal(ehBug({ titulo: '[BUG] Cor errada', rotulos: [] }, CONFIGURACAO), true);
    assert.equal(ehBug({ titulo: '[bug] cor errada', rotulos: [] }, CONFIGURACAO), true);
  });

  it('recusa Issue que nao e bug', () => {
    assert.equal(ehBug({ titulo: 'Sugestao de tema', rotulos: ['enhancement'] }, CONFIGURACAO), false);
  });

  it('recusa quando o prefixo aparece fora do inicio do titulo', () => {
    assert.equal(ehBug({ titulo: 'Talvez seja um [BUG]?', rotulos: [] }, CONFIGURACAO), false);
  });

  it('recusa Issue sem titulo e sem rotulo', () => {
    assert.equal(ehBug({}, CONFIGURACAO), false);
  });
});

describe('gerarSlug', () => {
  it('reduz o titulo a letras minusculas, numeros e hifens', () => {
    assert.equal(gerarSlug('Cor do 2o digito muda errado!'), 'cor-do-2o-digito-muda-errado');
  });

  it('remove acentuacao', () => {
    assert.equal(gerarSlug('Relogio nao atualiza a temperatura'), 'relogio-nao-atualiza-a-temperatura');
    assert.equal(gerarSlug('Referência nula'), 'referencia-nula');
  });

  it('descarta o prefixo entre colchetes', () => {
    assert.equal(gerarSlug('[BUG] deco line 2 apaga'), 'deco-line-2-apaga');
  });

  it('nao deixa passar caractere que quebraria um nome de branch', () => {
    const slug = gerarSlug('fix: ../../etc/passwd; rm -rf / && echo "oi"');

    assert.match(slug, /^[a-z0-9-]+$/);
    assert.equal(slug.includes('..'), false);
  });

  it('nao termina em hifen depois do corte', () => {
    const slug = gerarSlug('a'.repeat(40) + ' fim do titulo muito longo', 41);

    assert.equal(slug.endsWith('-'), false);
  });

  it('devolve um valor utilizavel quando o texto nao tem nada aproveitavel', () => {
    assert.equal(gerarSlug('!!! ### @@@'), 'bug');
    assert.equal(gerarSlug(''), 'bug');
    assert.equal(gerarSlug(null), 'bug');
  });
});

describe('montarNomeDaBranch', () => {
  it('usa o prefixo obrigatorio e termina com o numero da Issue', () => {
    const branch = montarNomeDaBranch({
      prefixo: 'automated-error-analysis',
      descricao: '[BUG] Referência nula em contrato',
      numeroDaIssue: 123,
    });

    assert.equal(branch, 'automated-error-analysis/referencia-nula-em-contrato-123');
  });

  it('e deterministico para a mesma Issue', () => {
    const argumentos = { prefixo: 'automated-error-analysis', descricao: 'Bug X', numeroDaIssue: 7 };

    assert.equal(montarNomeDaBranch(argumentos), montarNomeDaBranch(argumentos));
  });
});

describe('pedeReanalise', () => {
  it('reconhece o comando em uma linha propria', () => {
    assert.equal(pedeReanalise('/analisar-bug', '/analisar-bug'), true);
    assert.equal(pedeReanalise('segue o log\n/analisar-bug\n', '/analisar-bug'), true);
  });

  it('ignora o comando citado no meio de uma frase', () => {
    assert.equal(pedeReanalise('ontem rodei o /analisar-bug e deu erro', '/analisar-bug'), false);
  });

  it('ignora comentario comum', () => {
    assert.equal(pedeReanalise('tambem acontece comigo', '/analisar-bug'), false);
  });
});

describe('normalizarIssue', () => {
  it('extrai os dados que o agente precisa', () => {
    const issue = normalizarIssue(
      {
        number: 42,
        title: '[BUG] Cor errada',
        body: 'O segundo digito muda junto.',
        labels: [{ name: 'bug' }, 'firmware'],
        user: { login: 'alguem' },
        state: 'open',
        created_at: '2026-01-02T03:04:05Z',
      },
      [],
      CONFIGURACAO,
    );

    assert.equal(issue.numero, 42);
    assert.equal(issue.titulo, '[BUG] Cor errada');
    assert.deepEqual(issue.rotulos, ['bug', 'firmware']);
    assert.equal(issue.autor, 'alguem');
    assert.equal(issue.ehPullRequest, false);
  });

  it('redige segredo colado no corpo da Issue', () => {
    const issue = normalizarIssue(
      { number: 1, body: 'minha config: password = "abacaxi123"' },
      [],
      CONFIGURACAO,
    );

    assert.equal(issue.corpo.includes('abacaxi123'), false);
    assert.ok(issue.corpo.includes('REDIGIDO'));
    assert.ok(issue.segredosRedigidos >= 1);
  });

  it('mantem os comentarios mais recentes ao aplicar o limite', () => {
    const comentarios = [1, 2, 3, 4].map((numero) => ({
      body: `comentario ${numero}`,
      user: { login: 'pessoa' },
    }));

    const issue = normalizarIssue({ number: 1 }, comentarios, CONFIGURACAO);

    assert.equal(issue.comentarios.length, 2);
    assert.equal(issue.comentarios[0].texto, 'comentario 3');
    assert.equal(issue.comentarios[1].texto, 'comentario 4');
  });

  it('marca o payload que na verdade e um Pull Request', () => {
    const issue = normalizarIssue({ number: 9, pull_request: { url: 'x' } }, [], CONFIGURACAO);

    assert.equal(issue.ehPullRequest, true);
  });

  it('corta o corpo no limite configurado', () => {
    const issue = normalizarIssue({ number: 1, body: 'x'.repeat(5000) }, [], CONFIGURACAO);

    assert.equal(issue.corpo.length, 200);
  });
});
