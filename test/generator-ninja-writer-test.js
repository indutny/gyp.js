'use strict';
/* global describe it */

const assert = require('assert');

const NinjaWriter = require('../lib/gyp/generator/ninja/writer');
const nwriter = new NinjaWriter;

describe('gyp.generator.ninja.writer', () => {
  describe('escape', () => {
    it('should not escape empty string', () => {
      assert.equal(nwriter.escape(''), '');
    });

    it('should not escape regular string', () => {
      assert.equal(nwriter.escape('abc'), 'abc');
    });

    it('should escape ` `', () => {
      assert.equal(nwriter.escape('abc def'), 'abc$ def');
      assert.equal(nwriter.escape(' xx yy   zz  '), '$ xx$ yy$ $ $ zz$ $ ');
    });

    it('should escape `$` symbols', () => {
      assert.equal(nwriter.escape('a$b'), 'a$$b');
      assert.equal(nwriter.escape('$ab$'), '$$ab$$');
      assert.equal(nwriter.escape('a$$b$$$c'), 'a$$$$b$$$$$$c');
    });

    it('should escape `:` symbols', () => {
      assert.equal(nwriter.escape('a:b'), 'a$:b');
      assert.equal(nwriter.escape(':ab:'), '$:ab$:');
      assert.equal(nwriter.escape(':a::b::c:::'), '$:a$:$:b$:$:c$:$:$:');
    });

    it('should escape ` `, `$` and `:` symbols', () => {
      assert.equal(nwriter.escape('$ a:b$:c d'), '$$$ a$:b$$$:c$ d');
    });
  });
});
