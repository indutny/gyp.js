'use strict';

const gyp = require('../gyp');
const fs = gyp.bindings.fs;
const path = gyp.bindings.path;
const process = gyp.bindings.process;

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

const GYP_RELATIVE_CACHE = new Map();
function relativePath(tpath, relativeTo, followPathSymlink) {
  followPathSymlink = followPathSymlink !== false;

  const key = `${tpath} <<>> ${relativeTo} <<>> ${followPathSymlink}`;
  if (GYP_RELATIVE_CACHE.has(key))
    return GYP_RELATIVE_CACHE.get(key);

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
    // TODO(indutny): do this
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

  let res;

  // The paths were the same.
  if (relativeSplit.length === 0)
    res = '';
  else
    // Turn it back into a string and we're done.
    res = exports.path.join.apply(path, relativeSplit);

  GYP_RELATIVE_CACHE.set(key, res);
  return res;
}
exports.relativePath = relativePath;

exports.writeOnDiff = function writeOnDiff(path, content) {
  // TODO(indutny): original code does some tricks with move/unlink, check this
  const current = fs.readFileSync(path);
  if (current !== content)
    fs.writeFileSync(path, content);
};

// re objects used by EncodePOSIXShellArgument.  See IEEE 1003.1 XCU.2.2 at
// http://www.opengroup.org/onlinepubs/009695399/utilities/xcu_chap02.html#tag_02_02
// and the documentation for various shells.

// _quote is a pattern that should match any argument that needs to be quoted
// with double-quotes by EncodePOSIXShellArgument.  It matches the following
// characters appearing anywhere in an argument:
//   \t, \n, space  parameter separators
//   #              comments
//   $              expansions (quoted to always expand within one argument)
//   %              called out by IEEE 1003.1 XCU.2.2
//   &              job control
//   '              quoting
//   (, )           subshell execution
//   *, ?, [        pathname expansion
//   ;              command delimiter
//   <, >, |        redirection
//   =              assignment
//   {, }           brace expansion (bash)
//   ~              tilde expansion
// It also matches the empty string, because "" (or '') is the only way to
// represent an empty string literal argument to a POSIX shell.
//
// This does not match the characters in _escape, because those need to be
// backslash-escaped regardless of whether they appear in a double-quoted
// string.
const QUOTE = /[\t\n #$%&\'()*;<=>?\[{|}~]|^$/;

// _escape is a pattern that should match any character that needs to be
// escaped with a backslash, whether or not the argument matched the _quote
// pattern.  _escape is used with re.sub to backslash anything in _escape's
// first match group, hence the (parentheses) in the regular expression.
//
// _escape matches the following characters appearing anywhere in an argument:
//   "  to prevent POSIX shells from interpreting this character for quoting
//   \  to prevent POSIX shells from interpreting this character for escaping
//   `  to prevent POSIX shells from interpreting this character for command
//      substitution
// Missing from this list is $, because the desired behavior of
// EncodePOSIXShellArgument is to permit parameter (variable) expansion.
//
// Also missing from this list is !, which bash will interpret as the history
// expansion character when history is enabled.  bash does not enable history
// by default in non-interactive shells, so this is not thought to be a problem.
// ! was omitted from this list because bash interprets "\!" as a literal string
// including the backslash character (avoiding history expansion but retaining
// the backslash), which would not be correct for argument encoding.  Handling
// this case properly would also be problematic because bash allows the history
// character to be changed with the histchars shell variable.  Fortunately,
// as history is not enabled in non-interactive shells and
// EncodePOSIXShellArgument is only expected to encode for non-interactive
// shells, there is no room for error here by ignoring !.
const ESCAPE = /(["\\`])/;

function encodePOSIXShellArgument(argument) {
  /* Encodes |argument| suitably for consumption by POSIX shells.
   *
   * argument may be quoted and escaped as necessary to ensure that POSIX shells
   * treat the returned value as a literal representing the argument passed to
   * this function. Parameter (variable) expansions beginning with $ are allowed
   * to remain intact without escaping the $, to allow the argument to contain
   * references to variables to be expanded by the shell.
   */

  if (typeof argument !== 'string')
    argument = String(argument);

  let quote;
  if (QUOTE.test(argument))
    quote = '"';
  else
    quote = '';

  const encoded = quote + argument.replace(ESCAPE, '$1') + quote;
  return encoded;
}

exports.encodePOSIXShellList = function encodePOSIXShellList(list) {
  /* Encodes |list| suitably for consumption by POSIX shells.
   *
   * Returns EncodePOSIXShellArgument for each item in list, and joins them
   * together using the space character as an argument separator.
   */

  const encodedArguments = [];
  list.forEach((argument) => {
    encodedArguments.push(encodePOSIXShellArgument(argument));
  });
  return encodedArguments.join(' ');
};

exports.qualifiedTarget = function qualifiedTarget(buildFile, target, toolset) {
  // "Qualified" means the file that a target was defined in and the target
  // name, separated by a colon, suffixed by a # and the toolset name:
  // /path/to/file.gyp:target_name#toolset
  let fullyQualified = buildFile + ':' + target;
  if (toolset)
    fullyQualified += '#' + toolset;
  return fullyQualified;
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
  const parsed = parseQualifiedTarget(target);
  let parsedBuildFile = parsed.buildFile;
  target = parsed.target;
  let parsedToolset = parsed.toolset;

  if (parsedBuildFile) {
    if (buildFile) {
      // If a relative path, parsed_build_file is relative to the directory
      // containing build_file.  If build_file is not in the current directory,
      // parsed_build_file is not a usable path as-is.  Resolve it by
      // interpreting it as relative to build_file.  If parsed_build_file is
      // absolute, it is usable as a path regardless of the current directory,
      // and os.path.join will return it as-is.
      const dir = path.dirname(buildFile);
      if (path.isAbsolute(parsedBuildFile))
        buildFile = path.relative('.', parsedBuildFile);
      else
        buildFile = path.normalize(exports.path.join(dir, parsedBuildFile));
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

  return { buildFile: buildFile, target: target, toolset: toolset };
};

function parseQualifiedTarget(target) {
  // Splits a qualified target into a build file, target name and toolset.

  // NOTE: rsplit is used to disambiguate the Windows drive letter separator.
  let buildFile;
  if (/:/.test(target)) {
    const match = target.match(/^(.*?)(?::([^:]*))?$/);
    buildFile = match[1];
    target = match[2];
  } else {
    buildFile = undefined;
  }

  let toolset;
  if (/#/.test(target)) {
    const match = target.match(/^(.*?)(?:#([^:]*))?$/);
    target = match[1];
    toolset = match[2];
  } else {
    toolset = undefined;
  }

  return { buildFile: buildFile, target: target, toolset: toolset };
}
exports.parseQualifiedTarget = parseQualifiedTarget;

exports.findQualifiedTargets = function findQualifiedTargets(target, list) {
  /*
   * Given a list of qualified targets, return the qualified targets for the
   * specified |target|.
   */
  return list.filter(t => parseQualifiedTarget(t).target === target);
};

exports.buildFile = function buildFile(fullyQualifiedTarget) {
  // Extracts the build file from the fully qualified target.
  return parseQualifiedTarget(fullyQualifiedTarget).buildFile;
};

//
// Python shims
//

// PORT: os.path.splitext
exports.splitext = function splitext(source) {
  const ext = path.extname(source);
  const name = source.slice(0, -ext.length);

  return [ name, ext ];
};

exports.shallowCopy = function shallowCopy(obj) {
  const res = {};
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++)
    res[keys[i]] = obj[keys[i]];
  return res;
};

const RELATIVE_CACHE = new Map();
exports.cachedRelative = function cachedRelative(from, to) {
  const dirname = path.dirname(to);
  const basename = path.basename(to);
  const key = from + '<<>>' + dirname;

  if (RELATIVE_CACHE.has(key))
    return exports.path.join(RELATIVE_CACHE.get(key), basename);

  const value = path.relative(from, dirname);
  RELATIVE_CACHE.set(key, value);
  return exports.path.join(value, basename);
};

// Python-like implementation
function pathJoin() {
  let args = Array.from(arguments);

  // Skip everything before the last absolute chunk
  for (let i = args.length - 1; i >= 0; i--) {
    const arg = args[i];
    if (path.isAbsolute(arg)) {
      args = args.slice(i);
      break;
    }
  }

  return path.join.apply(path, args);
}

exports.path = { join: pathJoin };
