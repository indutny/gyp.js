'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

module.exports = function(out) {
  assert(fs.existsSync(path.join(out, 'libstatic.a')) ||
         fs.existsSync(path.join(out, 'static.lib')));
};
