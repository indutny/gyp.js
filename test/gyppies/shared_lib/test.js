'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

module.exports = function(out) {
  assert(fs.existsSync(path.join(out, 'libshared.so')) ||
         fs.existsSync(path.join(out, 'libshared.dll')) ||
         fs.existsSync(path.join(out, 'libshared.dylib')));
};
