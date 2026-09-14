import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { redigirSegredos } from '../src/segredos.mjs';

describe('redigirSegredos', () => {
  it('redige atribuicao de ClientSecret preservando a chave', () => {
    const { texto, ocorrencias } = redigirSegredos('"ClientSecret": "abcdef123456"');

    assert.equal(ocorrencias, 1);
    assert.match(texto, /"ClientSecret": "\*\*\*REDIGIDO\*\*\*"/);
    assert.doesNotMatch(texto, /abcdef123456/);
  });

  it('redige senha em connection string', () => {
    const { texto } = redigirSegredos('Server=x;Database=y;User Id=z;Password=SenhaForte1;');

    assert.doesNotMatch(texto, /SenhaForte1/);
    assert.match(texto, /Password=\*\*\*REDIGIDO\*\*\*/);
  });

  it('redige chave da Anthropic e da OpenAI', () => {
    const { texto } = redigirSegredos('sk-ant-api03-AAAAAAAAAAAAAAAAAAA e sk-BBBBBBBBBBBBBBBBBBBBBBBB');

    assert.doesNotMatch(texto, /AAAAAAAAAAAAAAAAAAA/);
    assert.doesNotMatch(texto, /BBBBBBBBBBBBBBBBBBBBBBBB/);
  });

  it('redige JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r';
    const { texto } = redigirSegredos(`var token = "${jwt}";`);

    assert.doesNotMatch(texto, /dBjftJeZ4CVPmB92K27uhbUJU1p1r/);
  });

  it('nao altera codigo sem segredo', () => {
    const original = 'export async function obterUsuarioPorId(id) {';
    const { texto, ocorrencias } = redigirSegredos(original);

    assert.equal(texto, original);
    assert.equal(ocorrencias, 0);
  });

  it('trata entrada nula sem lancar', () => {
    assert.deepEqual(redigirSegredos(null), { texto: '', ocorrencias: 0 });
  });
});
