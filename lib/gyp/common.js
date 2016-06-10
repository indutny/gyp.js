'use strict';

const fs = require('fs');
const path = require('path');

exports.crossCompileRequested = function crossCompileRequested() {
  // TODO: figure out how to not build extra host objects in the
  // non-cross-compile case when this is enabled, and enable unconditionally.
  return process.env['GYP_CROSSCOMPILE'] ||
          process.env['AR_host'] ||
          process.env['CC_host'] ||
          process.env['CXX_host'] ||
          process.env['AR_target'] ||
          process.env['CC_target'] ||
          process.env['CXX_target'];
};

// TODO(indutny): memoize
function relativePath(tpath, relativeTo, followPathSymlink = true) {
  // Assuming both |path| and |relative_to| are relative to the current
  // directory, returns a relative path that identifies path relative to
  // relative_to.
  // If |follow_symlink_path| is true (default) and |path| is a symlink, then
  // this method returns a path to the real file represented by |path|. If it is
  // false, this method returns a path to the symlink. If |path| is not a
  // symlink, this option has no effect.

  // Convert to normalized (and therefore absolute paths).
  if (followPathSymlink)
    tpath = fs.realpathSync(tpath);
  else
    tpath = path.resolve(tpath);
  relativeTo = fs.realpathSync(relativeTo);

  // On Windows, we can't create a relative path to a different drive, so just
  // use the absolute path.
  if (process.platform === 'win32') {
    throw new Error('Not implemented');
  }

  // Split the paths into components.
  const pathSplit = tpath.split(path.sep);
  const relativeToSplit = relativeTo.split(path.sep);

  // Determine how much of the prefix the two paths share.
  let prefixLen = 0;
  for (let i = 0; i < Math.min(pathSplit.length, relativeToSplit.length); i++) {
    if (pathSplit[i] !== relativeToSplit[i])
      break;
    prefixLen++;
  }

  // Put enough ".." components to back up out of relative_to to the common
  // prefix, and then append the part of path_split after the common prefix.
  const relativeSplit =
      new Array(relativeToSplit.length - prefixLen).fill('..').concat(
        pathSplit.slice(prefixLen));

  // The paths were the same.
  if (relativeSplit.length === 0)
    return '';

  // Turn it back into a string and we're done.
  return path.join.apply(path, relativeSplit);
}
exports.relativePath = relativePath;

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
        buildFile = relativePath(buildFile, '.');
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
    [ _, buildFile, target ] = target.match(/^(.*?)(?::([^:]*))?$/);
  } else {
    buildFile = undefined;
  }

  let toolset;
  if (/#/.test(target)) {
    let _;
    [ _, target, toolset ] = target.match(/^(.*?)(?:#([^:]*))?$/);
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
