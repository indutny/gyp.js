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

  describe('unary', () => {
    it('should parse single `not`', () => {
      assert.deepEqual(parseCondition('not a'), {
        type: 'Unary',
        op: 'not',
        argument: { type: 'Identifier', name: 'a' }
      });
    });

    it('should parse double `not`', () => {
      assert.deepEqual(parseCondition('not not a'), {
        type: 'Unary',
        op: 'not',
        argument: {
          type: 'Unary',
          op: 'not',
          argument: { type: 'Identifier', name: 'a' }
        }
      });
    });

    it('should parse `not` in expression', () => {
      assert.deepEqual(parseCondition('not a and not b'), {
        type: 'Binary',
        op: 'and',
        left: {
          type: 'Unary',
          op: 'not',
          argument: { type: 'Identifier', name: 'a' }
        },
        right: {
          type: 'Unary',
          op: 'not',
          argument: { type: 'Identifier', name: 'b' }
        }
      });
    });
  });

  describe('binary', () => {
    it('should parse `and`', () => {
      assert.deepEqual(parseCondition('a and b'), {
        type: 'Binary',
        op: 'and',
        left: { type: 'Identifier', name: 'a' },
        right: { type: 'Identifier', name: 'b' }
      });
    });

    it('should parse `>=`', () => {
      assert.deepEqual(parseCondition('a >= b'), {
        type: 'Binary',
        op: '>=',
        left: { type: 'Identifier', name: 'a' },
        right: { type: 'Identifier', name: 'b' }
      });
    });

    it('should parse nested', () => {
      assert.deepEqual(parseCondition('a == "1" and b >= 1'), {
        type: 'Binary',
        op: 'and',
        left: {
          type: 'Binary',
          op: '==',
          left: { type: 'Identifier', name: 'a' },
          right: { type: 'Literal', value: '1' }
        },
        right: {
          type: 'Binary',
          op: '>=',
          left: { type: 'Identifier', name: 'b' },
          right: { type: 'Literal', value: 1 }
        }
      });
    });
  });
});
