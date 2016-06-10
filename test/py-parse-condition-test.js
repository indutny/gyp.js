'use strict';

const assert = require('assert');

const gyp = require('../');
const parseCondition = gyp.py.parseCondition;

describe('gyp.py.parseCondition', () => {
  it('should parse number', () => {
    assert.deepEqual(parseCondition('123'), { type: 'Literal', value: 123 });
  });

  it('should parse string', () => {
    assert.deepEqual(parseCondition('"a"'), { type: 'Literal', value: 'a' });
  });

  it('should parse identifier', () => {
    assert.deepEqual(parseCondition('A_b_c'),
                     { type: 'Identifier', name: 'A_b_c' });
  });

  it('should parse parens', () => {
    assert.deepEqual(parseCondition('(((A_b_c)))'),
                     { type: 'Identifier', name: 'A_b_c' });
  });

  it('should parse tuple', () => {
    assert.deepEqual(parseCondition('((a , b , c ))'), {
      type: 'Tuple',
      values: [
        { type: 'Identifier', name: 'a' },
        { type: 'Identifier', name: 'b' },
        { type: 'Identifier', name: 'c' }
      ]
    });
  });

  it('should parse operator', () => {
    assert.deepEqual(parseCondition('a and b'), {
      type: 'Binary',
      op: 'and',
      left: { type: 'Identifier', name: 'a' },
      right: { type: 'Identifier', name: 'b' }
    });
  });
});
