'use strict';

const assert = require('assert');

const gyp = require('../');
const parseJSON = gyp.py.parseJSON;

describe('gyp.py.parseJSON', () => {
  describe('number', () => {
    it('should parse integer', () => {
      assert.equal(parseJSON('123'), 123);
    });

    it('should parse negative integer', () => {
      assert.equal(parseJSON('-123'), -123);
    });

    it('should parse float', () => {
      assert.equal(parseJSON('123.456'), 123.456);
    });

    it('should validate number', () => {
      assert.throws(() => parseJSON('123e123e1'));
    });

    it('should validate number', () => {
      assert.throws(() => parseJSON('--123'));
    });
  });

  describe('string', () => {
    it('should parse single-quote string', () => {
      assert.equal(parseJSON('\'abc\''), 'abc');
    });

    it('should parse double-quote string', () => {
      assert.equal(parseJSON('"abc"'), 'abc');
    });

    it('should parse escape sequences in a string', () => {
      assert.equal(parseJSON('"abc\\"abc"'), 'abc"abc');
      assert.equal(parseJSON('"abc\\r\\n\\f\\v\\b\\tabc"'),
                   'abc\r\n\f\v\b\tabc');
    });

    it('should validate string', () => {
      assert.throws(() => parseJSON('"abc\nabc"'));
    });
  });

  describe('array', () => {
    it('should parse empty array', () => {
      assert.deepEqual(parseJSON('[ ]'), []);
    });

    it('should parse element array', () => {
      assert.deepEqual(parseJSON('[ "a" ]'), [ 'a' ]);
    });

    it('should parse element+comma array', () => {
      assert.deepEqual(parseJSON('[ "a" , ]'), [ 'a' ]);
    });

    it('should parse multi-element array', () => {
      assert.deepEqual(parseJSON('[ "a" , "b" , "c", ]'), [ 'a', 'b', 'c' ]);
    });
  });

  describe('object', () => {
    it('should parse empty object', () => {
      assert.deepEqual(parseJSON('{ }'), {});
    });

    it('should parse single property object', () => {
      assert.deepEqual(parseJSON('{ "a": 1 }'), { a: 1 });
    });

    it('should parse single property + comma object', () => {
      assert.deepEqual(parseJSON('{ "a": 1 , }'), { a: 1 });
    });

    it('should parse multi-property object', () => {
      assert.deepEqual(parseJSON('{ "a": 1 , "b": 2 , }'), { a: 1, b: 2 });
    });
  });

  describe('comments', () => {
    it('should ignore comments', () => {
      assert.deepEqual(parseJSON('# comment\n123'), 123);
    });
  });
});
