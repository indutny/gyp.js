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

  describe('unary', () => {
    it('should eval `.split()`', () => {
      assert.deepEqual(run('"1 2 3" . split ( )'), [ '1', '2', '3' ]);
    });
  });

  describe('binary', () => {
    it('should eval ==', () => {
      assert.deepEqual(run('12 == 12'), true);
      assert.deepEqual(run('12 == 13'), false);
    });

    it('should eval !=', () => {
      assert.deepEqual(run('12 != 12'), false);
      assert.deepEqual(run('12 != 13'), true);
    });

    it('should eval >=', () => {
      assert.deepEqual(run('12 >= 12'), true);
      assert.deepEqual(run('13 >= 12'), true);
      assert.deepEqual(run('11 >= 12'), false);
    });

    it('should eval <=', () => {
      assert.deepEqual(run('12 <= 12'), true);
      assert.deepEqual(run('13 <= 12'), false);
      assert.deepEqual(run('11 <= 12'), true);
    });

    it('should eval >', () => {
      assert.deepEqual(run('12 > 12'), false);
      assert.deepEqual(run('13 > 12'), true);
      assert.deepEqual(run('11 > 12'), false);
    });

    it('should eval <', () => {
      assert.deepEqual(run('12 < 12'), false);
      assert.deepEqual(run('13 < 12'), false);
      assert.deepEqual(run('11 < 12'), true);
    });

    it('should eval "in"', () => {
      assert.deepEqual(run('1 in [1,2,3]'), true);
      assert.deepEqual(run('4 in [1,2,3]'), false);

      assert.deepEqual(run('"1" in "123"'), true);
      assert.deepEqual(run('"4" in "123"'), false);
    });

    it('should eval "not in"', () => {
      assert.deepEqual(run('1 not in [1,2,3]'), false);
      assert.deepEqual(run('4 not in [1,2,3]'), true);

      assert.deepEqual(run('"1" not in "123"'), false);
      assert.deepEqual(run('"4" not in "123"'), true);
    });

    it('should eval "and"', () => {
      assert.deepEqual(run('1 and 2'), 2);
      assert.deepEqual(run('0 and 1'), 0);
      assert.deepEqual(run('0 and unknown'), 0);
    });

    it('should eval "or"', () => {
      assert.deepEqual(run('1 or 2'), 1);
      assert.deepEqual(run('0 or 2'), 2);
      assert.deepEqual(run('1 or unknown'), 1);
    });
  });
});
