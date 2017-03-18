'use strict';

const path = require('path');
const fs = global.bindings.fs;
const execSync = global.bindings.childProcess.execSync;
const mkdirpSync = global.bindings.fs.mkdirpSync;

exports.path = {
  dirname: path.dirname,
  basename: path.basename,
  extname: path.extname,
  normalize: path.normalize,
  relative: path.relative,
  resolve: path.resolve,
  join: path.join,
  isAbsolute: path.isAbsolute,
  sep: path.sep
};
exports.fs = {
  readFileSync: function readFileSync(file) {
    return fs.readFileSync(file);
  },
  writeFileSync: function writeFileSync(file, contents) {
    return fs.writeFileSync(file, contents);
  },
  existsSync: function existsSync(file) {
    return fs.existsSync(file);
  },
  realpathSync: function realpathSync(file) {
    return fs.realpathSync(file);
  },
  mkdirpSync: mkdirpSync,
  readdirSync: fs.readdirSync
};

// NOTE: uses `cwd` option
exports.execSync = execSync;

exports.process = {
  env: global.bindings.env,
  cwd: function cwd() {
    return global.bindings.cwd();
  },
  platform: global.bindings.platform,
  arch: global.bindings.arch,
  exit: function exit(code) {
    return global.bindings.exit(code);
  }
};

exports.log = function log(message) {
  global.bindings.log(message + '\n');
};

exports.error = function error(message) {
  global.bindings.error(message + '\n');
};

Object.defineProperty(exports, 'win', {
  get: function get() {
    // ====== a late require ========
    const getter = require('windows-autoconf');
    // We just need all the binding to be set on `exports`
    getter.setBindings(exports);
    return {
      getMSVSVersion: getter.getMSVSVersion,
      getOSBits: getter.getOSBits,
      resolveDevEnvironment: getter.resolveDevEnvironment
    };
  }
});
