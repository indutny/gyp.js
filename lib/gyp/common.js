'use strict';

const fs = require('fs');
const path = require('path');

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
  // This function resolves a target into a canonical form:
  // - a fully defined build file, either absolute or relative to the current
  // directory
  // - a target name
  // - a toolset
  //
  // build_file is the file relative to which 'target' is defined.
  // target is the qualified target.
  // toolset is the default toolset for that target.
  let parsedBuildFile;
  let parsedToolset;
  [ parsedBuildFile, target, parsedToolset ] = parseQualifiedTarget(target);

  if (parsedBuildFile) {
    if (buildFile) {
      // If a relative path, parsed_build_file is relative to the directory
      // containing build_file.  If build_file is not in the current directory,
      // parsed_build_file is not a usable path as-is.  Resolve it by
      // interpreting it as relative to build_file.  If parsed_build_file is
      // absolute, it is usable as a path regardless of the current directory,
      // and os.path.join will return it as-is.
      buildFile = path.normalize(path.join(path.dirname(buildFile),
                                           parsedBuildFile));
      // Further (to handle cases like ../cwd), make it relative to cwd)
      // PORT: RelativePath()
      if (!path.isAbsolute(buildFile))
        buildFile = path.relative(buildFile, '.');
    } else {
      buildFile = parsedBuildFile;
    }
  }

  if (parsedToolset)
    toolset = parsedToolset;

  return [ buildFile, target, toolset ];
};

function parseQualifiedTarget(target) {
  // Splits a qualified target into a build file, target name and toolset.

  // NOTE: rsplit is used to disambiguate the Windows drive letter separator.
  let buildFile;
  if (/:/.test(target)) {
    let _;
    [ _, buildFile, target ] = target.match(/^(.*)(?::([^:*]))?$/);
  } else {
    buildFile = undefined;
  }

  let toolset;
  if (/#/.test(target)) {
    let _;
    [ _, target, toolset ] = target.match(/^(.*)(?:#([^:*]))?$/);
  } else {
    toolset = undefined;
  }

  return [ buildFile, target, toolset ];
};
exports.parseQualifiedTarget = parseQualifiedTarget;

exports.findQualifiedTargets = function findQualifiedTargets(target, flatList) {
  throw new Error('Not implemented');
};

exports.buildFile = function (fullyQualifiedTarget) {
  throw new Error('Not implemented');
}
