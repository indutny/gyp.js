'use strict';

const assert = require('assert');

const gyp = require('../');
const Base = gyp.py.Base;

describe('gyp.py.Base', () => {
  describe('it should return proper pos', () => {
    const b = new Base('123\n456\r\n987\r123');
    b.off = 11;
    assert.equal(b.pos(), '3:2');
  });
});
