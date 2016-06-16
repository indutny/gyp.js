const platform = exports;

platform.unix = require('./unix');
platform.darwin = require('./darwin');
platform.win = require('./win');
