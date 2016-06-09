'use strict';

const assert = require('assert');

const gyp = require('../');
const shlex = gyp.shlex;

describe('gyp.shlex', () => {
  it('should split words', () => {
    assert.deepEqual(shlex.split('  a   b \nc  '), [ 'a', 'b', 'c' ]);
  });

  it('should coalesce parts in single quotes', () => {
    assert.deepEqual(shlex.split('a   pre\'b c\'post d'), [
        'a', 'preb cpost', 'd' ]);
  });

  it('should coalesce parts in double quotes', () => {
    assert.deepEqual(shlex.split('a   pre"b c"post d'), [
        'a', 'preb cpost', 'd' ]);
  });

  it('should not escape `\\` in single quotes', () => {
    assert.deepEqual(shlex.split('a   pre\'b\\n c\'post d'), [
        'a', 'preb\\n cpost', 'd' ]);
  });

  it('should escape `\\` in double quotes', () => {
    assert.deepEqual(shlex.split('a   pre\"b\\n c\"post d'), [
        'a', 'preb\n cpost', 'd' ]);
  });

  it('should escape `\\"` in double quotes', () => {
    assert.deepEqual(shlex.split('a   pre\"b\\" c\"post d'), [
        'a', 'preb" cpost', 'd' ]);
  });
});
