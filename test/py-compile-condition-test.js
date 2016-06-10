'use strict';

const assert = require('assert');

const gyp = require('../');
const compileCondition = gyp.py.compileCondition;

const run = (str, scope) => compileCondition(str)(scope);

describe('gyp.py.compileCondition', () => {
  it('should eval number', () => {
    assert.deepEqual(run('123'), 123);
  });

  it('should eval string', () => {
    assert.deepEqual(run('"123"'), '123');
  });

  it('should eval identifier', () => {
    assert.deepEqual(run('a', { a: 123 }), '123');
  });

  it('should eval object', () => {
    assert.deepEqual(run('{ "a": a }', { a: 123 }), { a: 123 });
  });

  it('should eval array', () => {
    assert.deepEqual(run('[ a ]', { a: 123 }), [ 123 ]);
  });

  describe('binary', () => {
    it('should eval ==', () => {
      assert.deepEqual(run('12 == 12'), true);
      assert.deepEqual(run('12 == 13'), false);
    });
  });
});
