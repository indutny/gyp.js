'use strict';

const fs = require('fs');

exports.crossCompileRequested = function crossCompileRequested() {
  return false;
};

exports.writeOnDiff = function writeOnDiff(path, content) {
  // TODO(indutny): original code does some tricks with move/unlink, check this
  const current = fs.readFileSync(path);
  if (current !== content)
    fs.writeFileSync(path, content);
};

exports.encodePOSIXShellList = function encodePOSIXShellList(replacement) {
  throw new Error('Not implemented');
};

exports.qualifiedTarget = function qualifiedTarget(buildFile, target, toolset) {
  throw new Error('Not implemented');
};

exports.resolveTarget = function resolveTarget(buildFile, target, toolset) {
  throw new Error('Not implemented');
};
