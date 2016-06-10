'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const execSync = require('child_process').execSync;

const gyp = require('../gyp');

// A list of types that are treated as linkable.
const linkableTypes = [
  'executable',
  'shared_library',
  'loadable_module',
  'mac_kernel_extension'
];

// A list of sections that contain links to other targets.
const dependencySections = [ 'dependencies', 'export_dependent_settings' ];

// base_path_sections is a list of sections defined by GYP that contain
// pathnames.  The generators can provide more keys, the two lists are merged
// into path_sections, but you should call IsPathSection instead of using either
// list directly.
const basePathSections = [
  'destination',
  'files',
  'include_dirs',
  'inputs',
  'libraries',
  'outputs',
  'sources',
];
const pathSections = {};

// These per-process dictionaries are used to cache build file data when loading
// in parallel mode.
const perProcessData = {};
const perProcessAuxData = {};

function isPathSection(section) {
  /* If section ends in one of the '=+?!' characters, it's applied to a section
   * without the trailing characters.  '/' is notably absent from this list,
   * because there's no way for a regular expression to be treated as a path.
   */
  while (section && /[=+?!]/.test(section[section.length - 1]))
    section = section.slice(0, -1);

  if (pathSections[section])
    return true;

  /* Sections mathing the regexp '_(dir|file|path)s?$' are also
   * considered PathSections. Using manual string matching since that
   * is much faster than the regexp and this can be called hundreds of
   * thousands of times so micro performance matters.
   */
  if (/_/.test(section)) {
    const tail = section.slice(-6);
    if (tail[tail.length - 1] === 's')
      tail = tail.slice(0, -1);
    if (/_(file|path)$/.test(tail))
      return true;
    return /dir$/.test(tail);
  }

  return false;
}

/* base_non_configuration_keys is a list of key names that belong in the target
 * itself and should not be propagated into its configurations.  It is merged
 * with a list that can come from the generator to
 * create non_configuration_keys.
 */
const baseNonConfigurationKeys = [
  // Sections that must exist inside targets and not configurations.
  'actions',
  'configurations',
  'copies',
  'default_configuration',
  'dependencies',
  'dependencies_original',
  'libraries',
  'postbuilds',
  'product_dir',
  'product_extension',
  'product_name',
  'product_prefix',
  'rules',
  'run_as',
  'sources',
  'standalone_static_library',
  'suppress_wildcard',
  'target_name',
  'toolset',
  'toolsets',
  'type',

  // Sections that can be found inside targets or configurations, but that
  // should not be propagated from targets into their configurations.
  'variables'
];
const nonConfigurationKeys = [];

// Keys that do not belong inside a configuration dictionary.
const invalidConfigurationKeys = [
  'actions',
  'all_dependent_settings',
  'configurations',
  'dependencies',
  'direct_dependent_settings',
  'libraries',
  'link_settings',
  'sources',
  'standalone_static_library',
  'target_name',
  'type'
];

// Controls whether or not the generator supports multiple toolsets.
let multipleToolsets = false;

/* Paths for converting filelist paths to output paths: {
 *   toplevel,
 *   qualified_output_dir,
 * }
 */
let generatorFilelistPaths = undefined;

function getIncludedBuildFiles(buildFilePath, auxData, included) {
  /* Return a list of all build files included into build_file_path.
   *
   * The returned list will contain build_file_path as well as all other files
   * that it included, either directly or indirectly.  Note that the list may
   * contain files that were included into a conditional section that evaluated
   * to false and was not merged into build_file_path's dict.
   *
   * aux_data is a dict containing a key for each build file or included build
   * file.  Those keys provide access to dicts whose "included" keys contain
   * lists of all other files included by the build file.
   *
   * included should be left at its default None value by external callers.  It
   * is used for recursion.
   *
   * The returned list will not contain any duplicate entries.  Each build file
   * in the list will be relative to the current directory.
   */

  if (!included)
    included = [];

  if (included.indexOf(buildFilePath) !== -1)
    return included;

  included.push(buildFilePath);

  const list = auxData[buildFilePath]['included'] || [];
  list.forEach((includedBuildFile) => {
    getIncludedBuildFiles(includedBuildFile, auxData, included);
  });

  return included;
}

function checkedEval(fileContents) {
  /* Return the eval of a gyp file.
   *
   * The gyp file is restricted to dictionaries and lists only, and
   * repeated keys are not allowed.
   *
   * Note that this is slower than eval() is.
   */
  throw new Error('Not implemented');
}

function pyCompile(contents) {
  throw new Error('Not implemented');
}

function pyEval(contents) {
  const fn = pyCompile(contents);
  return fn();
}

function loadOneBuildFile(buildFilePath, data, auxData, includes, isTarget,
                          check) {
  if (data[buildFilePath])
    return data[buildFilePath];

  let buildFileContents;
  if (fs.existsSync(buildFilePath))
    buildFileContents = fs.readFileSync(buildFilePath);
  else
    throw new Error(`${buildFilePath} not found (cwd: ${process.cwd()})`);

  let buildFileData;
  if (check)
    buildFileData = checkedEval(buildFileContents, buildFilePath);
  else
    buildFileData = pyEval(buildFileContents, buildFilePath);

  if (typeof buildFileData !== 'object')
    throw new Error(`${buildFilePath} does not evaluate to a dictionary`);

  data[buildFilePath] = buildFileData;
  auxData[buildFilePath] = {};

  // Scan for includes and merge them in.
  if (!buildFileData['skip_includes']) {
    try {
      loadBuildFileIncludesIntoDict(buildFileData, buildFilePath, data,
                                    auxData, is_target ? includes : undefined,
                                    check);
    } catch (e) {
      e.message += ` while reading includes of ${buildFilePath}`;
      // TODO(indutny): verify that it does not overwrite `e.stack`
      throw e;
    }
  }

  return buildFileData;
}

function loadBuildFileIncludesIntoDict(subdict, subdictPath, data, auxData,
                                       includes, check) {
  let includesList = [];
  if (includes)
    includesList = includesList.concat(includes);

  if (subdict['includes']) {
    const sub = subdict['includes'];
    sub.forEach((include) => {
      // "include" is specified relative to subdict_path, so compute the real
      // path to include by appending the provided "include" to the directory
      // in which subdict_path resides.

      // PORT os.path.normpath()
      const relativeInclude = path.normalize(
          path.join(path.dirname(subdictPath), include));
      includesList.push(relativeInclude);
    });

    // Unhook the includes list, it's no longer needed.
    delete subdict['includes'];
  }

  // Merge in the included files.
  includesList.forEach((include) => {
    if (!auxData[subdictPath]['included'])
      auxData[subdictPath]['included'] = [];
    auxData[subdictPath]['included'].push(include);

    gyp.debugOutput(gyp.DEBUG_INCLUDES, 'Loading Included FIle: \'%s\'',
                    include);

    mergeDicts(
        subdict,
        loadOneBuildFile(include, data, auxData, undefined, false, check),
        subdictPath, include);
  });

  // Recurse into subdictionaries.
  Object.keys(subdict).forEach((k) => {
    const v = subdict[k];
    if (typeof v === 'object') {
      loadBuildFileIncludesIntoDict(
          v, subdictPath, data, auxData, undefined, check);
    } else if (Array.isArray(v)) {
      loadBuildFileIncludesIntoList(
          v, subdictPath, data, auxData, check);
    }
  });
}

// This recurses into lists so that it can look for dicts.
function loadBuildFileIncludesIntoList(sublist, sublistPath, data, auxData,
                                       check) {
  sublist.forEach((item) => {
    if (typeof item === 'object') {
      loadBuildFileIncludesIntoDict(item, sublistPath, data, auxData, undefined,
                                    check);
    } else if (Array.isArray(item)) {
      loadBuildFileIncludesIntoList(item, sublistPath, data, auxData, check);
    }
  });
}

// Processes toolsets in all the targets. This recurses into condition entries
// since they can contain toolsets as well.
function processToolsetsInDict(data) {
  if (data['targets']) {
    const targetList = data['targets'];
    const newTargetList = [];
    targetList.forEach((target) => {
      // If this target already has an explicit 'toolset', and no 'toolsets'
      // list, don't modify it further.
      if (target['toolset'] && !target['toolsets']) {
        newTargetList.push(target);
        return;
      }

      let toolsets;
      if (multipleToolsets)
        toolsets = target['toolsets'] || [ 'target' ];
      else
        toolsets = [ 'target' ];
      // Make sure this 'toolsets' definition is only processed once.
      delete target['toolsets'];

      if (toolsets.length > 0) {
        // Optimization: only do copies if more than one toolset is specified.
        toolsets.forEach((build) => {
          // PORT: gyp.simple_copy.deepcopy()
          const newTarget = JSON.parse(JSON.stringify(target));
          newTarget['toolset'] = build;
          newTargetList.push(target);
        });
        target['toolset'] = toolsets[0]
        newTargetList.push(target);
      }
    });
    data['targets'] = newTargetList;
  }
  if (data['conditions']) {
    data['conditions'].forEach((condition) => {
      if (Array.isArray(condition)) {
        condition.forEach((conditionDict) => {
          if (typeof conditionDict === 'object')
            processToolsetsInDict(conditionDict);
        });
      }
    });
  }
}

// TODO(mark): I don't love this name.  It just means that it's going to load
// a build file that contains targets and is expected to provide a targets dict
// that contains the targets...
function loadTargetBuildFile(buildFilePath, data, auxData, variables, includes,
                             depth, check, loadDependencies) {
  // If depth is set, predefine the DEPTH variable to be a relative path from
  // this build file's directory to the directory identified by depth.
  if (depth) {
    // TODO(dglazkov) The backslash/forward-slash replacement at the end is a
    // temporary measure. This should really be addressed by keeping all paths
    // in POSIX until actual project generation.

    // PORT: gyp.common.RelativePath
    d = path.relative(depth, path.dirname(buildFilePath));
    if (d === '')
      variables['DEPTH'] = '.';
    else
      // TODO(indutny): is it necessary in JS-land?
      variables['DEPTH'] = d.replace('\\', '/');
  }

  /* The 'target_build_files' key is only set when loading target build files in
   * the non-parallel code path, where LoadTargetBuildFile is called
   * recursively.  In the parallel code path, we don't need to check whether the
   * |build_file_path| has already been loaded, because the 'scheduled' set in
   * ParallelState guarantees that we never load the same |build_file_path|
   * twice.
   */
  if (data['target_build_files']) {
    // Already loaded
    if (data['target_build_files'].indexOf(buildFilePath) !== -1)
      return false;

    data['target_build_files'].push(buildFilePath);
  }

  gyp.debugOutput(gyp.DEBUG_INCLUDES,
                  'Loading Target Build FIle \'%s\'', buildFilePath);

  const buildFileData = loadOneBuildFile(buildFilePath, data, auxData, includes,
                                         true, check);

  // Store DEPTH for later use in generators.
  buildFileData['_DEPTH'] = depth;

  // Set up the included_files key indicating which .gyp files contributed to
  // this target dict.
  if (buildFileData['included_files'])
    throw new Error(buildFilePath + ' must not contain included_files key');

  const included = getIncludedBuildFiles(buildFilePath, auxData);
  buildFileData['included_files'] = [];
  included.forEach((includedFile) => {
    // included_file is relative to the current directory, but it needs to
    // be made relative to build_file_path's directory.

    // PORT: gyp.common.RelativePath
    const includedRelative =
        path.relative(includedFile, path.dirname(buildFilePath));
    buildFileData['included_files'].push(includedRelative);
  });

  // Do a first round of toolsets expansion so that conditions can be defined
  // per toolset.
  processToolsetsInDict(buildFileData);

  // Apply "pre"/"early" variable expansions and condition evaluations.
  processVariablesAndConditionsInDict(
      buildFileData, 'PHASE_EARLY', variables, buildFilePath)

  // Since some toolsets might have been defined conditionally, perform
  // a second round of toolsets expansion now.
  processToolsetsInDict(buildFileData)

  // Look at each project's target_defaults dict, and merge settings into
  // targets.
  if (buildFileData['target_defaults']) {
    if (!buildFileData['targets'])
      throw new Error(`Unable to find targets in build file ${buildFilePath}`);

    let index = 0;
    while (index < buildFileData['targets'].length) {
      /* This procedure needs to give the impression that target_defaults is
       * used as defaults, and the individual targets inherit from that.
       * The individual targets need to be merged into the defaults.  Make
       * a deep copy of the defaults for each target, merge the target dict
       * as found in the input file into that copy, and then hook up the
       * copy with the target-specific data merged into it as the replacement
       * target dict.
       */
      const oldTargetDict = buildFileData['targets'][index];

      // PORT: gyp.simple_copy.deepcopy()
      const newTargetDict =
          JSON.parse(JSON.stringify(buildFileData['target_defaults']));

      MergeDicts(newTargetDict, oldTargetDict, buildFilePath, buildFilePath);
      index++;
    }

    delete buildFileData['target_defaults'];
  }

  /* Look for dependencies.  This means that dependency resolution occurs
   * after "pre" conditionals and variable expansion, but before "post" -
   * in other words, you can't put a "dependencies" section inside a "post"
   * conditional within a target.
   */

  const dependencies = [];
  if (buildFileData['targets']) {
    buildFileData['targets'].forEach((targetDict) => {
      if (!targetDict['dependencies'])
        return;

      targetDict['dependencies'].forEach((dependency) => {
        dependencies.append(gyp.common.resolveTarget(buildFilePath,
                                                     dependency,
                                                     undefined)[0]);
      });
    });
  }

  if (loadDependencies) {
    dependencies.forEach((dependency) => {
      try {
        loadTargetBuildFile(dependency, data, auxData, variables,
                            includes, depth, check, loadDependencies);
      } catch (e) {
        e.message += ` while loading dependencies of ${buildFilePath}`;
        // TODO(indutny): verify that it does not overwrite `e.stack`
        throw e;
      }
    });
  } else {
    // TODO(indutny): use object
    return [ buildFilePath, dependencies ];
  }
}

function callLoadTargetBuildFile(buildFilePath, variables,
                                 includes, depth, check, generatorInputInfo) {
  // TODO(indutny): remove leftovers from `parallel`
  setGeneratorGlobals(generatorInputInfo);
  const result = loadTargetBuildFile(buildFilePath, perProcessData,
                                     perProcessData, perProcessAuxData,
                                     variables, includes, depth, check, false);
  if (!result)
    return result;

  let dependencies;
  [ buildFilePath, dependencies ] = result;

  // We can safely pop the build_file_data from per_process_data because it
  // will never be referenced by this process again, so we don't need to keep
  // it in the cache.
  //
  // XXX(indutny): possibly needs to be removed too
  const buildFileData = perProcessData[buildFilePath];
  delete perProcessData[buildFilePath];

  // This gets serialized and sent back to the main process via a pipe.
  // It's handled in LoadTargetBuildFileCallback.
  return [ buildFilePath, buildFileData, dependencies ];
}

function loadTargetBuildFilesParallel(buildFiles, data, variables, includes,
                                      depth, check, generatorInputInfo) {
  // TODO(indutny): no parallel
  const dependencies = buildFiles.slice();
  const scheduled = new Set();

  while (dependencies.length > 0) {
    const dependency = dependencies.pop();

    const res = callLoadTargetBuildFile(
        dependency, variables, includes, depth, check, generatorInputInfo);
    const [ buildFilePath, buildFileData, dependencies ] = res;

    data[buildFilePath] = buildFileData;
    data['target_build_files'].push(buildFilePath);
    dependencies.forEach((dependency) => {
      const newDependency = dependencies[i];

      if (!scheduled.has(newDependency)) {
        scheduled.add(newDependency);
        dependencies.push(newDependency);
      }
    });
  }
}

/* Look for the bracket that matches the first bracket seen in a
 * string, and return the start and end as a tuple.  For example, if
 * the input is something like "<(foo <(bar)) blah", then it would
 * return (1, 13), indicating the entire string except for the leading
 * "<" and trailing " blah".
 */
function findEnclosingBracketGroup(inputStr) {
  const stack = [];
  let start = -1;

  for (let index = 0; index < inputStr.length; index++) {
    const char = inputStr[index];
    if (/[{[(]/.test(char)) {
      stack.append(char);
      if (start === -1)
        start = index;
    } else if (/[}\])]/.test(char)) {
      if (stack.length === 0)
        return [ -1, -1 ];

      const last = stack.pop();
      if (char === '}' && last !== '{' ||
          char === ']' && last !== '[' ||
          char === ')' && last !== '(') {
        return [ -1, -1 ];
      }

      if (stack.length === 0)
        return [ start, index + 1 ];
    }
  }
  return [ -1, -1 ];
}

const CANONICAL_INT = /^-?\d+$/;

function ifStrCanonicalInt(string) {
  // TODO(indutny): original comment said that regexps are slower, try it!
  return CANONICAL_INT.test(string);
}

// This matches things like "<(asdf)", "<!(cmd)", "<!@(cmd)", "<|(list)",
// "<!interpreter(arguments)", "<([list])", and even "<([)" and "<(<())".
// In the last case, the inner "<()" is captured in match['content'].
const EARLY_VARIABLE_RE = new RegExp(
    '((<(?:(?:!?@?)|\|)?)' + /* (replace(type) */
    '([-a-zA-Z0-9_.]+)?' + /* (command_string) */
    '\((\s*\[?)' + /* ((is_array) */
    '(.*?)(\]?)\))', /* (content))) */
    'g'
);

// This matches the same as early_variable_re, but with '>' instead of '<'.
const LATE_VARIABLE_RE = new RegExp(
    '((>(?:(?:!?@?)|\|)?)' + /* (replace(type) */
    '([-a-zA-Z0-9_.]+)?' + /* (command_string) */
    '\((\s*\[?)' + /* ((is_array) */
    '(.*?)(\]?)\))', /* (content))) */
    'g'
);

// This matches the same as early_variable_re, but with '^' instead of '<'.
const LATELATE_VARIABLE_RE = new RegExp(
    '(([\^](?:(?:!?@?)|\|)?)' + /* (replace(type) */
    '([-a-zA-Z0-9_.]+)?' + /* (command_string) */
    '\((\s*\[?)' + /* ((is_array) */
    '(.*?)(\]?)\))', /* (content))) */
    'g'
);

// Global cache of results from running commands so they don't have to be run
// more then once.
const cachedCommandResults = {};

function fixupPlatformCommand(cmd) {
  if (process.platform === 'win32') {
    if (Array.isArray(cmd))
      cmd = [ cmd[0].replace(/^cat /, 'type ') ].concat(cmd.slice(1));
    else
      cmd = cmd.replace(/^cat /, 'type ');
  }
  return cmd;
}

function getRegExpMatches(re, str) {
  const res = [];

  re.lastIndex = 0;
  for (;;) {
    const match = re.exec(str);
    if (match === null)
      break;

    res.push(match);
  }

  return res;
}

function expandVariables(input, phase, variables, buildFile) {
  // Look for the pattern that gets expanded into variables
  let variableRe;
  if (phase === 'PHASE_EARLY') {
    variableRe = EARLY_VARIABLE_RE;
  } else if (phase === 'PHASE_LATE') {
    variableRe = LATE_VARIABLE_RE;
  } else if (phase === 'PHASE_LATELATE') {
    variableRe = LATELATE_VARIABLE_RE;
  } else {
    throw new Error(`Unexpected phase: ${PHASE}`);
  }

  const inputStr = String(input);
  if (isStrCanonicalInt(inputStr))
    return inputStr | 0;

  // TODO(indutny): again, author claims that RegExps are expensive, perhaps
  // they are not in JS

  // Get the entire list of matches as a list of MatchObject instances.
  // (using findall here would return strings instead of MatchObjects).
  const matches = getRegExpMatches(variableRe, inputStr);
  if (matches.length === 0)
    return inputStr;

  let output = inputStr;
  /* Reverse the list of matches so that replacements are done right-to-left.
   * That ensures that earlier replacements won't mess up the string in a
   * way that causes later calls to find the earlier substituted text instead
   * of what's intended for replacement.
   */
  for (let i = matches.length - 1; i >= 0; i--) {
    const rawMatch = matches[i];
    const match = {
      replace: rawMatch[1],
      type: rawMatch[2],
      command_string: rawMatch[3],
      is_array: rawMatch[4],
      content: rawMatch[5]
    };
    gyp.debugOutput(gyp.DEBUG_VARIABLES, 'Matches: %j', match);
    /* match['replace'] is the substring to look for, match['type']
     * is the character code for the replacement type (< > <! >! <| >| <@
     * >@ <!@ >!@), match['is_array'] contains a '[' for command
     * arrays, and match['content'] is the name of the variable (< >)
     * or command to run (<! >!). match['command_string'] is an optional
     * command string. Currently, only 'pymod_do_main' is supported.
     *
     * run_command is true if a ! variant is used.
     */
    const runCommand = /!/.test(match['type']);
    const commandString = match['command_string'];

    // file_list is true if a | variant is used.
    const fileList = /\|/.test(match['type']);

    // Capture these now so we can adjust them later.
    const replaceStart = rawMatch.index;
    let replaceEnd = replaceStart + rawMatch[0].length;

    // TODO(indutny): test this optimization
    // Find the ending paren, and re-evaluate the contained string.
    const [cStart, cEnd] = findEnclosingBracketGroup(rawMatch[0]);

    // Adjust the replacement range to match the entire command
    // found by FindEnclosingBracketGroup (since the variable_re
    // probably doesn't match the entire command if it contained
    // nested variables).
    replaceEnd = replaceStart + cEnd;

    // Find the "real" replacement, matching the appropriate closing
    // paren, and adjust the replacement start and end.
    let replacement = inputStr.slice(replaceStart, replaceEnd);

    // Figure out what the contents of the variable parens are.
    const contentsStart = replaceStart + cStart + 1;
    const contentsEnd = replaceEnd - 1;
    let contents = inputStr.slice(contentsStart, contentsEnd);

    // Do filter substitution now for <|().
    // Admittedly, this is different than the evaluation order in other
    // contexts. However, since filtration has no chance to run on <|(),
    // this seems like the only obvious way to give them access to filters.
    if (fileList) {
      // PORT: gyp.simple_copy.deepcopy()
      const processedVariables = JSON.parse(JSON.stringify(variables));
      processListFiltersInDict(contents, processedVariables);
      // Recurse to expand variables in the contents
      contents = expandVariables(contents, phase,
                                 processedVariables, buildFile);
    } else {
      // Recurse to expand variables in the contents
      contents = expandVariables(contents, phase, variables, buildFile);
    }

    // Strip off leading/trailing whitespace so that variable matches are
    // simpler below (and because they are rarely needed).
    contents = contents.strip();

    // expand_to_list is true if an @ variant is used.  In that case,
    // the expansion should result in a list.  Note that the caller
    // is to be expecting a list in return, and not all callers do
    // because not all are working in list context.  Also, for list
    // expansions, there can be no other text besides the variable
    // expansion in the input string.
    const expandToList = /@/.test(match['type']) && inputStr == replacement;

    let buildFileDir;
    if (runCommand || fileList) {
      // Find the build file's directory, so commands can be run or file lists
      // generated relative to it.
      buildFileDir = path.dirname(buildFile);
      if (buildFileDir === '' && !fileList) {
        // If build_file is just a leaf filename indicating a file in the
        // current directory, build_file_dir might be an empty string.  Set
        // it to None to signal to subprocess.Popen that it should run the
        // command in the current directory.
        buildFileDir = undefined;
      }
    }

    // Support <|(listfile.txt ...) which generates a file
    // containing items from a gyp list, generated at gyp time.
    // This works around actions/rules which have more inputs than will
    // fit on the command line.
    if (fileList) {
      let contentsList;
      if (Array.isArray(contents))
        contentsList = contents;
      else
        contentsList = contents.split(' ');

      let tpath;
      if (!generatorFilelistPaths) {
        tpath = path.join(buildFileDir, replacement);
      } else {
        let relBuildFileDir;
        if (path.isAbsolute(buildFileDir)) {
          const toplevel = generatorFilelistPaths['toplevel'];
          // PORT: gyp.common.RelativePath()
          relBuildFileDir = path.relative(buildFileDir, toplevel);
        } else {
          relBuildFileDir = buildFileDir;
        }
        const qualifiedOutDir = generatorFilelistPaths['qualified_out_dir'];
        tpath = path.join(qualifiedOutDir, relBuildFileDir, replacement);

        // PORT: gyp.common.EnsureDirExists()
        if (!fs.existsSync(tpath))
          throw new Error(`File not found: ${tpath}`);
      }

      // PORT: gyp.common.RelativePath()
      replacement = path.relative(path, buildFileDir);
      gyp.common.writeOnDiff(path, contentsList.slice(1).join('\n'));
    } else if (runCommand) {
      let useShell = true;
      if (match['is_array']) {
        contents = pyEval(contents);
        useShell = false;
      }

      /* Check for a cached value to avoid executing commands, or generating
       * file lists more than once. The cache key contains the command to be
       * run as well as the directory to run it from, to account for commands
       * that depend on their current directory.
       * TODO(http://code.google.com/p/gyp/issues/detail?id=111): In theory,
       * someone could author a set of GYP files where each time the command
       * is invoked it produces different output by design. When the need
       * arises, the syntax should be extended to support no caching off a
       * command's output so it is run every time.
       */
      const cacheKey = JSON.stringify(contents) + ':' + buildFileDir;
      const cachedValue = cachedCommandResults[cacheKey];
      if (cachedValue === undefined) {
        gyp.debugOutput(gyp.DEBUG_VARIABLES,
                        'Executing command \'%s\' in directory \'%s\'',
                        contents, build_file_dir);
        replacement = '';

        if (commandString) {
          throw new Error(
              `Unknown command string '${commandString}' in '${contents}'`);
        } else {
          // Fix up command with platform specific workarounds.
          contents = fixupPlatformCommand(contents);

          const p = execSync(contents);

          if (p.signal !== 0 || p.stderr.length !== 0) {
            console.error(p.stderr.toString());
            throw new Error(
                `Call to '${contents} returned exit status ${p.signal} ` +
                `while in ${buildFile}`);
          }
        }

        cachedCommandResults[cacheKey] = replacement;
      } else {
        gyp.debugOutput(
            gyp.DEBUG_VARIABLES,
            'Had cache value for command \'%s\' in directory \'%s\'',
            contents, buildFileDir);
        replacement = cachedValue;
      }
    } else {
      if (!variables[contents]) {
        if (/[!/]$/.test(contents)) {
          // In order to allow cross-compiles (nacl) to happen more naturally,
          // we will allow references to >(sources/) etc. to resolve to
          // and empty list if undefined. This allows actions to:
          // 'action!': [
          //   '>@(_sources!)',
          // ],
          // 'action/': [
          //   '>@(_sources/)',
          // ],
          replacement = [];
        } else {
          throw Error(`Undefined variable ${contents} in ${buildFile}`);
        }
      } else {
        replacement = variables[contents];
      }
    }

    if (Array.isArray(replacement)) {
      replacement.forEach((item) => {
        if (!/\/$/.test(contents) &&
            typeof item !== 'string' &&
            typeof item !== 'number') {
          throw new Error(
              `Variable ${contents} must expand to a string or list of ` +
              `strings; list contains a ${typeof item}`);
        }
      });
      // Run through the list and handle variable expansions in it.  Since
      // the list is guaranteed not to contain dicts, this won't do anything
      // with conditions sections.
      processVariablesAndConditionsInList(replacement, phase, variables,
                                          buildFile);
    } else if (typeof replacement !== 'string' &&
               typeof replacement !== 'number') {
      throw new Error(
          `Variable ${contents} must expand to a string or list of ` +
          `strings; list contains a ${typeof item}`);
    }

    if (expandToList) {
      // Expanding in list context.  It's guaranteed that there's only one
      // replacement to do in |input_str| and that it's this replacement.  See
      // above.
      if (array.isArray(replacement)) {
        // If it's already a list, make a copy.
        output = replacement.slice();
      } else {
        // Split it the same way sh would split arguments.
        output = gyp.shlex.split(String(replacement));
      }
    } else {
      // Expanding in string context.
      let encodedReplacement = '';
      if (Array.isArray(replacement)) {
        /* When expanding a list into string context, turn the list items
         * into a string in a way that will work with a subprocess call.
         *
         * TODO(mark): This isn't completely correct.  This should
         * call a generator-provided function that observes the
         * proper list-to-argument quoting rules on a specific
         * platform instead of just calling the POSIX encoding
         * routine.
         */
        encodedReplacement = gyp.common.encodePOSIXShellList(replacement);
      } else {
        encodedReplacement = replacement;
      }

      output = output.slice(0, replaceStart) + encodedReplacement +
          output.slice(replaceEnd);
    }

    // Prepare for the next match iteration.
    inputStr = output;
  }

  if (output === input) {
    gyp.debugOutput(gyp.DEBUG_VARIABLES,
                    'Found only identity matches on %j, avoiding infinite ' +
                        'recursion.',
                    output);
  } else {
    // Look for more matches now that we've replaced some, to deal with
    // expanding local variables (variables defined in the same
    // variables block as this one).
    gyp.debugOutput(gyp.DEBUG_VARIABLES, 'Found output %j, recursing.', output);
    if (Array.isArray(output)) {
      if (output.length !== 0 && Array.isArray(output[0])) {
        // Leave output alone if it's a list of lists.
        // We don't want such lists to be stringified.
      } else {
        const newOutput = [];
        output.forEach((item) => {
          newOutput.push(expandVariables(item, phase, variables, buildFile));
        });
        output = newOutput;
      }
    } else {
      output = expandVariables(output, phase, variables, buildFile);
    }
  }

  // Convert all strings that are canonically-represented integers into integers
  if (Array.isArray(output)) {
    for (let index = 0; index < output.length; index++) {
      if (isStrCanonicalInt(output[index]))
        output[index] |= 0;
    }
  } else if (isStrCanonicalInt(output)) {
    output |= 0;
  }
}

// The same condition is often evaluated over and over again so it
// makes sense to cache as much as possible between evaluations.
const cachedConditionsFns = {};

function evalCondition(condition, conditionsKey, phase, variables, buildFile) {
  /* Returns the dict that should be used or None if the result was
   * that nothing should be used.
   */
  if (!Array.isArray(condition))
    throw new Error(`${conditionsKey} must be a list`);

  if (condition.length < 2) {
    // It's possible that condition[0] won't work in which case this
    // attempt will raise its own IndexError.  That's probably fine.
    throw new Error(`${conditionsKey} ${condition[0]} must be at least ` +
                    `length 2, not ${condition.length}`);
  }

  let i = 0;
  let result;
  while (i < condition.length) {
    const condExpr = condition[i];
    const trueDict = condition[i + 1];

    if (typeof trueDict !== 'object') {
      throw new Error(`${conditionsKey} ${condExpr} must be followed by a `
                      `dictionary, not ${typeof trueDict}`);
    }

    let falseDict;
    if (condition.length > i + 2 && typeof condition[i + 2] === 'object') {
      falseDict = condition[i + 2];
      i = i + 3;
      if (i !== condition.length) {
        throw new Error(`${conditionsKey} ${condExpr} has ` +
                        `${condition.length - i} unexpected trailing items`);
      }
    } else {
      i = i + 2;
    }

    if (!result) {
      result = evalSingleCondition(condExpr, trueDict, falseDict, phase,
                                   variables, buildFile);
    }
  }

  return result;
}


function evalSingleCondition(condExpr, trueDict, falseDict, phase, variables,
                             buildFile) {
  /* Returns true_dict if cond_expr evaluates to true, and false_dict
   * otherwise.
   */

  /* Do expansions on the condition itself.  Since the conditon can naturally
   * contain variable references without needing to resort to GYP expansion
   * syntax, this is of dubious value for variables, but someone might want to
   * use a command expansion directly inside a condition.
   */
  const condExprExpanded = expandVariables(condExpr, phase, variables,
                                           buildFile);
  if (typeof condExprExpanded !== 'string' &&
      typeof condExprExpanded !== 'number') {
    throw new Error(`Variable expansion in this context permits str and int ` +
                    `only, found ${typeof condExprExpanded}`);
  }

  try {
    let fn;
    if (cachedConditionsFns[condExprExpanded]) {
      fn = cachedConditionsFns[condExprExpanded];
    } else {
      fn = pyCompile(condExprExpanded);
      cachedConditionsFns[condExprExpanded] = fn;
    }
    if (fn(variables))
      return trueDict;
    return falseDict;
  } catch (e) {
    e.message +=
        ` while evaluating condition ${condExprExpanded} in ${buildFile}`;
    // TODO(indutny): verify that it does not overwrite `e.stack`
    throw e;
  }
}

function processConditionsInDict(theDict, phase, variables, buildFile) {
  /* Process a 'conditions' or 'target_conditions' section in the_dict,
   * depending on phase.
   * early -> conditions
   * late -> target_conditions
   * latelate -> no conditions
   *
   * Each item in a conditions list consists of cond_expr, a string expression
   * evaluated as the condition, and true_dict, a dict that will be merged into
   * the_dict if cond_expr evaluates to true.  Optionally, a third item,
   * false_dict, may be present.  false_dict is merged into the_dict if
   * cond_expr evaluates to false.
   *
   * Any dict merged into the_dict will be recursively processed for nested
   * conditionals and other expansions, also according to phase, immediately
   * prior to being merged.
   */

  let conditionsKey;
  if (phase === 'PHASE_EARLY')
    conditionsKey = 'conditions';
  else if (phase === 'PHASE_LATE')
    conditionsKey = 'target_conditions';
  else
    return;

  if (!theDict[conditionsKey])
    return;

  const conditionsList = theDict[conditionsKey];
  // Unhook the conditions list, it's no longer needed.
  delete theDict[conditionsKey];

  conditionsList.forEach((condition) => {
    const mergeDict = evalCondition(condition, conditionsKey, phase, variables,
                                    buildFile);
    if (mergeDict) {
      // Expand variables and nested conditinals in the merge_dict before
      // merging it.
      processVariablesAndConditionsInDict(mergeDict, phase, variables,
                                          buildFile);
      mergeDicts(theDict, mergeDict, buildFile, buildFile);
    }
  });
}

function loadAutomaticVariablesFromDict(variables, theDict) {
  // Any keys with plain string values in the_dict become automatic variables.
  // The variable name is the key name with a "_" character prepended.
  Object.keys(theDict).forEach((key) => {
    const value = theDict[key];
    if (typeof value === 'string' ||
        typeof value === 'number' ||
        Array.isArray(value)) {
      variables[`_${key}`] = value;
    }
  });
}

function loadVariablesFromVariablesDict(variables, theDict, theDictKey) {
  /* Any keys in the_dict's "variables" dict, if it has one, becomes a
   * variable.  The variable name is the key name in the "variables" dict.
   * Variables that end with the % character are set only if they are unset in
   * the variables dict.  the_dict_key is the name of the key that accesses
   * the_dict in the_dict's parent dict.  If the_dict's parent is not a dict
   * (it could be a list or it could be parentless because it is a root dict),
   * the_dict_key will be None.
   */
  const vars = theDict['variables'];
  if (!vars)
    return;

  Object.keys(vars).forEach((key) => {
    const value = vars[key];

    let variableName;
    if (/%$/.test(key)) {
      variableName = key.slice(0, -1);
      // If the variable is already set, don't set it.
      if (variables[variableName])
        return;
      if (theDictKey === 'variables' && theDict[variableName]) {
        // If the variable is set without a % in the_dict, and the_dict is a
        // variables dict (making |variables| a varaibles sub-dict of a
        // variables dict), use the_dict's definition.
        value = theDict[variableName];
      } else {
        variableName = key;
      }

      variables[variableName] = value;
    }
  });
}

function processVariablesAndConditionsInDict(theDict, phase, variablesIn,
                                             buildFile, theDictKey) {
  /* Handle all variable and command expansion and conditional evaluation.
   *
   * This function is the public entry point for all variable expansions and
   * conditional evaluations.  The variables_in dictionary will not be modified
   * by this function.
   */

  // Make a copy of the variables_in dict that can be modified during the
  // loading of automatics and the loading of the variables dict.
  // PORT: variables_in.copy()
  const variables = JSON.parse(JSON.stringify(variablesIn));
  loadAutomaticVariablesFromDict(variables, theDict);

  if (theDict['variables']) {
    // Make sure all the local variables are added to the variables
    // list before we process them so that you can reference one
    // variable from another.  They will be fully expanded by recursion
    // in ExpandVariables.
    Object.keys(theDict['variables']).forEach((key) => {
      const value = theDict['variables'][key];
      variables[key] = value;
    });

    // Handle the associated variables dict first, so that any variable
    // references within can be resolved prior to using them as variables.
    // Pass a copy of the variables dict to avoid having it be tainted.
    // Otherwise, it would have extra automatics added for everything that
    // should just be an ordinary variable in this scope.
    processVariablesAndConditionsInDict(theDict['variables'], phase,
                                        variables, buildFile, 'variables');
  }

  loadVariablesFromVariablesDict(variables, theDict, theDictKey);

  Object.keys(theDict).forEach((key) => {
    const value = theDict[key];
    if (key !== 'variables' && typeof value === 'string') {
      const expanded = expandVariables(value, phase, variables, buildFile);
      if (typeof expanded !== 'string' && typeof expanded !== 'number') {
        throw new Error(
            `Variable expansion in this context permits str and int ` +
            `only, found ${typeof expanded} for ${key}`);
      }
      theDict[key] = expanded;
    }
  });

  // Variable expansion may have resulted in changes to automatics.  Reload.
  // TODO(mark): Optimization: only reload if no changes were made.
  variables = JSON.parse(JSON.stringify(variablesIn));
  loadAutomaticVariablesFromDict(variables, theDict);
  loadVariablesFromVariablesDict(variables, theDict, theDictKey);

  // Process conditions in this dict.  This is done after variable expansion
  // so that conditions may take advantage of expanded variables.  For example,
  // if the_dict contains:
  //   {'type':       '<(library_type)',
  //    'conditions': [['_type=="static_library"', { ... }]]},
  // _type, as used in the condition, will only be set to the value of
  // library_type if variable expansion is performed before condition
  // processing.  However, condition processing should occur prior to recursion
  // so that variables (both automatic and "variables" dict type) may be
  // adjusted by conditions sections, merged into the_dict, and have the
  // intended impact on contained dicts.
  //
  // This arrangement means that a "conditions" section containing a "variables"
  // section will only have those variables effective in subdicts, not in
  // the_dict.  The workaround is to put a "conditions" section within a
  // "variables" section.  For example:
  //   {'conditions': [['os=="mac"', {'variables': {'define': 'IS_MAC'}}]],
  //    'defines':    ['<(define)'],
  //    'my_subdict': {'defines': ['<(define)']}},
  // will not result in "IS_MAC" being appended to the "defines" list in the
  // current scope but would result in it being appended to the "defines" list
  // within "my_subdict".  By comparison:
  //   {'variables': {'conditions': [['os=="mac"', {'define': 'IS_MAC'}]]},
  //    'defines':    ['<(define)'],
  //    'my_subdict': {'defines': ['<(define)']}},
  // will append "IS_MAC" to both "defines" lists.
  //
  // Evaluate conditions sections, allowing variable expansions within them
  // as well as nested conditionals.  This will process a 'conditions' or
  // 'target_conditions' section, perform appropriate merging and recursive
  // conditional and variable processing, and then remove the conditions section
  // from the_dict if it is present.
  processConditionsInDict(theDict, phase, variables, buildFile);

  // Conditional processing may have resulted in changes to automatics or the
  // variables dict.  Reload.
  variables = JSON.parse(JSON.stringify(variablesIn));
  loadAutomaticVariablesFromDict(variables, theDict);
  loadVariablesFromVariablesDict(variables, theDict, theDictKey);

  // Recurse into child dicts, or process child lists which may result in
  // further recursion into descendant dicts.
  Object.keys(theDict).forEach((key) => {
    const value = theDict[key];
    // Skip "variables" and string values, which were already processed if
    // present.
    if (key === 'variables' && typeof value === 'string')
      return;

    if (typeof value === 'object') {
      // Pass a copy of the variables dict so that subdicts can't influence
      // parents.
      processVariablesAndConditionsInDict(value, phase, variables, buildFile,
                                          key);
    } else if (Array.isArray(value)) {
      // The list itself can't influence the variables dict, and
      // ProcessVariablesAndConditionsInList will make copies of the variables
      // dict if it needs to pass it to something that can influence it.  No
      // copy is necessary here.
      processVariablesAndConditionsInList(value, phase, variables, buildFile);
    } else if (typeof value !== 'number') {
      throw new Error(`Unknown type ${typeof value} for ${key}`);
    }
  });
}

function processVariablesAndConditionsInList(theList, phase, variables,
                                             buildFile) {
  // Iterate using an index so that new values can be assigned into the_list.
  let index = 0;
  while (index < theList.length) {
    const item = theList[index];
    if (typeof item === 'object') {
      // Make a copy of the variables dict so that it won't influence anything
      // outside of its own scope.
      processVariablesAndConditionsInDict(item, phase, variables, buildFile);
    } else if (Array.isArray(item)) {
      processVariablesAndConditionsInList(item, phase, variables, buildFile);
    } else if (typeof item === 'string') {
      const expanded = expandVariables(item, phase, variables, buildFile);
      if (typeof expanded === 'string' || typeof expanded === 'number') {
        theList[index] = expanded;
      } else if (Array.isArray(expanded)) {
        theList.splice.apply(theList,  [ index, 1 ].concat(expanded));
        index += expanded.length;

        // index now identifies the next item to examine.  Continue right now
        // without falling into the index increment below.
        continue;
      } else {
        throw new Error(
            `Variable expansion in this context permits strings and ` +
            `lists only, found ${typeof expanded} at ${index}`);
      }
    } else if (typeof item !== 'number') {
      throw new Error(`Unknown type ${typeof item} at index ${index}`);
    }

    index++;
  }
}

function buildTargetsDict(data) {
  /* Builds a dict mapping fully-qualified target names to their target dicts.
   *
   * |data| is a dict mapping loaded build files by pathname relative to the
   * current directory.  Values in |data| are build file contents.  For each
   * |data| value with a "targets" key, the value of the "targets" key is taken
   * as a list containing target dicts.  Each target's fully-qualified name is
   * constructed from the pathname of the build file (|data| key) and its
   * "target_name" property.  These fully-qualified names are used as the keys
   * in the returned dict.  These keys provide access to the target dicts,
   * the dicts in the "targets" lists.
   */

  const targets = {};
  data['target_build_files'].forEach((buildFile) => {
    (data[buildFile]['targets'] || []).forEach((target) => {
      const targetName = gyp.common.qualifiedTarget(buildFile,
                                                    target['target_name'],
                                                    target['toolset']);
      if (targets[targetName])
        throw new Error(`Duplicate target definitions for ${targetName}`);

      targets[targetName] = target;
    });
  });

  return targets;
}

function qualifyDependencies(targets) {
  /* Make dependency links fully-qualified relative to the current directory.
   *
   * |targets| is a dict mapping fully-qualified target names to their target
   * dicts.  For each target in this dict, keys known to contain dependency
   * links are examined, and any dependencies referenced will be rewritten
   * so that they are fully-qualified and relative to the current directory.
   * All rewritten dependencies are suitable for use as keys to |targets| or a
   * similar dict.
   */

  const allDependencySections = [];
  dependencySections.forEach((dep) => {
    allDependencySections.push(dep, dep + '!', dep + '/');
  });

  Object.keys(targets).forEach((target) => {
    const targetDict = targets[target];
    const targetBuildFile = targetDict[dependencyKey] || [];
    const toolset = targetDict['toolset'];

    const allDependencySections = [];
    allDependencySections.forEach((dependencyKey) => {
      const dependecies = targetDict[dependencyKey] || [];
      for (let index = 0; index < dependencies.length; index++) {
        const [ depFile, depTarget, depToolset ] = gyp.common.resolveTarget(
            targetBuildFile, dependencies[index], toolset);

        // Ignore toolset specification in the dependency if it is specified.
        if (!multipleToolsets)
          depToolsets = toolset;
        dependency = gyp.common.qualifiedTarget(depFile, depTarget, depToolset);
        dependencies[index] = dependency;

        // Make sure anything appearing in a list other than "dependencies" also
        // appears in the "dependencies" list.
        if (dependencyKey !== 'dependencies' &&
            targetDict['dependencies'].indexOf(dependency) === -1) {
          throw new Error(`Found ${dependency} in ${dependencyKey} of ` +
                          `${target}, but not in dependencies`);
        }
      }
    });
  });
}

function expandWildcardDependencies(targets, data) {
  /* Expands dependencies specified as build_file:*.
   *
   * For each target in |targets|, examines sections containing links to other
   * targets.  If any such section contains a link of the form build_file:*, it
   * is taken as a wildcard link, and is expanded to list each target in
   * build_file.  The |data| dict provides access to build file dicts.
   *
   * Any target that does not wish to be included by wildcard can provide an
   * optional "suppress_wildcard" key in its target dict.  When present and
   * true, a wildcard dependency link will not include such targets.
   *
   * All dependency names, including the keys to |targets| and the values in each
   * dependency list, must be qualified when this function is called.
   */

  Object.keys(targets).forEach((target) => {
    const targetDict = targets[target];
    const toolset = targetDict['toolset'];
    const targetBuildFile = gyp.common.buildFile(target);

    dependencySections.forEach((dependencyKey) => {
      const dependencies = targetDict[dependencyKey] || [];

      // Loop this way instead of "for dependency in" or "for index in xrange"
      // because the dependencies list will be modified within the loop body.
      let index = 0;
      while (index < dependencies.length) {
        const [ dependencyBuildFile, dependencyTarget, dependencyToolset ] =
            gyp.common.parseQualifiedTarget(dependencies[index]);

        if (dependencyTarget !== '*' && dependencyToolset !== '*') {
          // Not a wildcard.  Keep it moving.
          index = index + 1;
          continue;
        }

        if (dependencyBuildFile === targetBuildFile) {
          // It's an error for a target to depend on all other targets in
          // the same file, because a target cannot depend on itself.
          throw new Error(`Found wildcard in ${dependencyKey} of ` +
                          `${target} referring to same build file`);
        }

        // Take the wildcard out and adjust the index so that the next
        // dependency in the list will be processed the next time through the
        // loop.
        dependencies.splice(index, 1);
        index--;

        // Loop through the targets in the other build file, adding them to
        // this target's list of dependencies in place of the removed
        // wildcard.
        const dependencyTargetDicts = data[dependencyBuildFile]['targets'];
        dependencyTargetDicts.forEach((dependencyTargetDict) => {
          if (dependencyTargetDict['suppress_wildcard'])
            return;

          const dependencyTargetName = dependencyTargetDict['target_name'];
          if (dependencyTarget !== '*' &&
              dependencyTarget !== dependencyTargetName) {
            return;
          }
          const dependencyTargetToolset = dependencyTargetDict['toolset'];
          if (dependencyToolset !== '*' &&
              dependencyToolset !== dependencyTargetToolset) {
            return;
          }
          const dependency = gyp.common.qualifiedTarget(
              dependencyBuildFile, dependencyTargetName,
              dependencyTargetToolset);
          index++;
          dependencies.splice(index, 0, dependency);
        });

        index++;
      }
    });
  });
}

function unify(l) {
  if (l.length === 1)
    return l.slice();

  // Removes duplicate elements from l, keeping the first element.
  const seen = new Set();
  const res = [];
  for (let i = 0; i < l.length; i++) {
    if (seen.has(l[i]))
      continue;
    seen.add(l[i]);
    res.push(l[i]);
  }
  return res;
}

function removeDuplicateDependencies(targets) {
  /* Makes sure every dependency appears only once in all targets's dependency
   * lists.
   */
  Object.keys(targets).forEach((targetName) => {
    const targetDict = targets[targetName];
    dependencySections.forEach((dependencyKey) => {
      const dependencies = targetDict[dependencyKey] || [];
      if (dependencies.length !== 0)
        targetDict[dependencyKey] = unify(dependencies);
    });
  });
}

function removeSelfDependencies(targets) {
  /* Remove self dependencies from targets that have the prune_self_dependency
   * variable set.
   */

  // TODO(indutny): cleanup spaghetti
  Object.keys(targets).forEach((targetName) => {
    const targetDict = targets[targetName];
    dependencySections.forEach((dependencyKey) => {
      const dependencies = targetDict[dependencyKey] || [];
      if (dependencies.length !== 0) {
        dependencies.forEach((t) => {
          if (t === targetName &&
              targets[t]['variables'] &&
              targets[t]['variables']['prune_self_dependency']) {
            targetDict[dependencyKey] = dependencies.filter((dep) => {
              return dep !== targetName;
            });
          }
        });
      }
    });
  });
}

// TODO(indutny): merge with together, generalize
function removeLinkDependenciesFromNoneTargets(targets) {
  /* Remove dependencies having the 'link_dependency' attribute from the 'none'
   * targets.
   */

  // TODO(indutny): cleanup spaghetti
  Object.keys(targets).forEach((targetName) => {
    const targetDict = targets[targetName];
    dependencySections.forEach((dependencyKey) => {
      const dependencies = targetDict[dependencyKey] || [];
      if (dependencies.length !== 0) {
        dependencies.forEach((t) => {
          if (targetDict['type'] == 'none' &&
              targets[t]['variables'] &&
              targets[t]['variables']['link_dependency']) {
            targetDict[dependencyKey] = dependencies.filter((dep) => {
              return dep !== targetName;
            });
          }
        });
      }
    });
  });
}

function DependencyGraphNode(ref) {
  /*
   * Attributes:
   *   ref: A reference to an object that this DependencyGraphNode represents.
   *   dependencies: List of DependencyGraphNodes on which this one depends.
   *   dependents: List of DependencyGraphNodes that depend on this one.
   */
  this.ref = ref;
  this.dependencies = [];
  this.dependents = [];
}

DependencyGraphNode.prototype.inspect = function inspect() {
  return util.format('<DependencyGraphNode: %j>', this.ref);
};

function cmpNodes(a, b) {
  return a.ref === b.ref ? 0 : a.ref > b.ref ? 1 : -1;
}

DependencyGraphNode.prototype.flattenToList = function flattenToList() {
  // flat_list is the sorted list of dependencies - actually, the list items
  // are the "ref" attributes of DependencyGraphNodes.  Every target will
  // appear in flat_list after all of its dependencies, and before all of its
  // dependents.
  // TODO(indutny): its ordered, right?
  const flatList = new Set();

  // in_degree_zeros is the list of DependencyGraphNodes that have no
  // dependencies not in flat_list.  Initially, it is a copy of the children
  // of this node, because when the graph was built, nodes with no
  // dependencies were made implicit dependents of the root node.
  const inDegreeZeros = this.dependents.slice().sort(cmpNodes);

  while (inDegreeZeros.length) {
    // Nodes in in_degree_zeros have no dependencies not in flat_list, so they
    // can be appended to flat_list.  Take these nodes out of in_degree_zeros
    // as work progresses, so that the next node to process from the list can
    // always be accessed at a consistent position.
    const node = inDegreeZeros.pop();
    flatList.add(node.ref);

    // Look at dependents of the node just added to flat_list.  Some of them
    // may now belong in in_degree_zeros.
    node.dependents.slice().sort(cmpNodes).forEach((nodeDependent) => {
      let isInDegreeZero = true;

      // TODO: We want to check through the
      // node_dependent.dependencies list but if it's long and we
      // always start at the beginning, then we get O(n^2) behaviour.
      const t = nodeDependent.dependencies.slice().sort(cmpNodes);
      t.forEach((nodeDependentDependency) => {
        if (!flatList.has(nodeDependentDependency.ref)) {
          isInDegreeZero = false;
        }
      });

      if (isInDegreeZero) {
        // All of the dependent's dependencies are already in flat_list.  Add
        // it to in_degree_zeros where it will be processed in a future
        // iteration of the outer loop.
        inDegreeZeroes.push(nodeDependent);
      }
    });
  }

  return Array.from(flatList.values());
}

DependencyGraphNode.prototype.findCycles = function findCycles() {
  /*
   * Returns a list of cycles in the graph, where each cycle is its own list.
   */
  const results = [];
  const visited = new Set();

  function visit(node, path) {
    node.dependents.forEach((child) => {
      const i = path.indexOf(child);
      if (i !== -1) {
        results.append([ child ].concat(path.slice(0, index + 1)));
      } else {
        visited.add(child);
        visit(child, [ child ].concat(path));
      }
    });
  }

  visited.add(this);
  visit(this, [ this ]);

  return results;
};

DependencyGraphNode.prototype.directDependencies =
    function directDependencies(dependencies) {
  // Returns a list of just direct dependencies.
  if (!dependencies)
    dependencies = [];

  this.dependencies.forEach((dependency) => {
    // Check for None, corresponding to the root node.
    if (dependency.ref && dependencies.indexOf(dependency.ref) === -1)
      dependencies.push(dependency.ref);
  });

  return dependencies;
};

DependencyGraphNode.prototype._addImportedDependencies =
    function _addImportedDependencies(targets, dependencies) {
  /* Given a list of direct dependencies, adds indirect dependencies that
   * other dependencies have declared to export their settings.
   *
   * This method does not operate on self.  Rather, it operates on the list
   * of dependencies in the |dependencies| argument.  For each dependency in
   * that list, if any declares that it exports the settings of one of its
   * own dependencies, those dependencies whose settings are "passed through"
   * are added to the list.  As new items are added to the list, they too will
   * be processed, so it is possible to import settings through multiple levels
   * of dependencies.
   *
   * This method is not terribly useful on its own, it depends on being
   * "primed" with a list of direct dependencies such as one provided by
   * DirectDependencies.  DirectAndImportedDependencies is intended to be the
   * public entry point.
   */
  if (!dependencies)
    dependencies = [];

  let index = 0;
  while (index < dependencies.length) {
    const dependency = dependencies[index];
    const dependencyDict = targets[dependency];
    // Add any dependencies whose settings should be imported to the list
    // if not already present.  Newly-added items will be checked for
    // their own imports when the list iteration reaches them.
    // Rather than simply appending new items, insert them after the
    // dependency that exported them.  This is done to more closely match
    // the depth-first method used by DeepDependencies.
    let addIndex = 1;
    (dependencyDict['export_dependent_settings'] || [])
        .forEach((importedDependency) => {
      if (dependencies.indexOf(importedDependency) === -1) {
        dependencies.splice(index + addIndex, 0, importedDependency);
        addIndex++;
      }
    });
    index++;
  }

  return dependencies;
};

DependencyGraphNode.prototype.directAndImportedDependencies =
    function directAndImportedDependencies(targets, dependencies) {
  /* Returns a list of a target's direct dependencies and all indirect
   * dependencies that a dependency has advertised settings should be exported
   * through the dependency for.
   */
  dependencies = this.directDependencies(dependencies);
  return this._addImportedDependencies(targets, dependencies);
};

DependencyGraphNode.prototype.deepDependencies =
    function deepDependencies(dependencies) {
  /* Returns an OrderedSet of all of a target's dependencies, recursively. */
  if (!dependencies) {
    // Using a list to get ordered output and a set to do fast "is it
    // already added" checks.
    // TODO(indutny): its ordered, right?
    dependencies = new Set();
  }

  this.dependencies.forEach((dependency) => {
    // Check for None, corresponding to the root node.
    if (!dependency.ref)
      return;

    if (dependencies.indexOf(dependency.ref) === -1) {
      dependency.deepDependencies(dependencies);
      dependencies.add(dependency.ref);
    }
  });

  return dependencies;
};

DependencyGraphNode.prototype._linkDependenciesInternal =
    function _linkDependenciesInternal(targets, includeSharedLibraries,
                                       dependencies, initial = true) {
  /* Returns an OrderedSet of dependency targets that are linked
   * into this target.
   *
   * This function has a split personality, depending on the setting of
   * |initial|.  Outside callers should always leave |initial| at its default
   * setting.
   *
   * When adding a target to the list of dependencies, this function will
   * recurse into itself with |initial| set to False, to collect dependencies
   * that are linked into the linkable target for which the list is being built.
   *
   * If |include_shared_libraries| is False, the resulting dependencies will not
   * include shared_library targets that are linked into this target.
   */
  if (!dependencies) {
    // Using a list to get ordered output and a set to do fast "is it
    // already added" checks.
    // TODO(indutny): its ordered, right?
    dependencies = new Set();
  }

  // Check for None, corresponding to the root node.
  if (!this.ref)
    return dependencies;

  // It's kind of sucky that |targets| has to be passed into this function,
  // but that's presently the easiest way to access the target dicts so that
  // this function can find target types.

  if (!targets[this.ref]['target_name'])
    throw new Error('Missing \'target_name\' field in target.');

  if (!targets[this.ref]['type']) {
    throw new Error(`Missing 'type' field in target ` +
                    `${targets[this.ref]['target_name']}`);
  }

  const targetType = targets[this.ref]['type'];

  // TODO(indutny): use Set or Map
  const isLinkable = linkableTypes.indexOf(targetType) !== -1;

  if (initial && !isLinkable) {
    // If this is the first target being examined and it's not linkable,
    // return an empty list of link dependencies, because the link
    // dependencies are intended to apply to the target itself (initial is
    // True) and this target won't be linked.
    return dependencies;
  }

  // Don't traverse 'none' targets if explicitly excluded.
  if (targetType === 'none' &&
      targets[this.ref]['dependencies_traverse'] === false) {
    dependencies.add(this.ref);
    return dependencies;
  }

  // Executables, mac kernel extensions and loadable modules are already fully
  // and finally linked. Nothing else can be a link dependency of them, there
  // can only be dependencies in the sense that a dependent target might run
  // an executable or load the loadable_module.
  if (!initial &&
      (targetType === 'executable' ||
       targetType === 'loadable_module' ||
       targetType === 'mac_kernel_extension')) {
    return dependencies;
  }

  // Shared libraries are already fully linked.  They should only be included
  // in |dependencies| when adjusting static library dependencies (in order to
  // link against the shared_library's import lib), but should not be included
  // in |dependencies| when propagating link_settings.
  // The |include_shared_libraries| flag controls which of these two cases we
  // are handling.
  if (!initial &&
      targetType === 'shared_library' &&
      !includeSharedLibraries) {
    return dependencies;
  }

  // The target is linkable, add it to the list of link dependencies.
  if (!dependencies.has(this.ref)) {
    dependencies.add(this.ref);
    if (!initial || !isLinkable) {
      // If this is a subsequent target and it's linkable, don't look any
      // further for linkable dependencies, as they'll already be linked into
      // this target linkable.  Always look at dependencies of the initial
      // target, and always look at dependencies of non-linkables.
      this.dependencies.forEach((dependency) => {
        dependency._linkDependenciesInternal(targets,
                                             includeSharedLibraries,
                                             dependencies,
                                             false);
      });
    }
  }

  return dependencies;
};

DependencyGraphNode.prototype.dependenciesForLinkSettings =
    function dependenciesForLinkSettings(targets) {
  /*
   * Returns a list of dependency targets whose link_settings should be merged
   * into this target.
   */

  // TODO(sbaig) Currently, chrome depends on the bug that shared libraries'
  // link_settings are propagated.  So for now, we will allow it, unless the
  // 'allow_sharedlib_linksettings_propagation' flag is explicitly set to
  // False.  Once chrome is fixed, we can remove this flag.
  const includeSharedLibraries =
      targets[this.ref]['allow_sharedlib_linksettings_propagation'] !== false;
  return this._linkDependenciesInternal(targets, includeSharedLibraries);
};

DependencyGraphNode.prototype.dependenciesToLinkAgainst =
    function dependenciesToLinkAgainst(targets) {
  /*
   * Returns a list of dependency targets that are linked into this target.
   */

  return this._linkDependenciesInternal(targets, true);
};

function buildDependencyList(targets) {
  // Create a DependencyGraphNode for each target.  Put it into a dict for easy
  // access.
  const dependencyNodes = {};
  Object.keys(targets).forEach((target) => {
    const spec = targets[target];
    if (!dependencyNodes[target])
      dependencyNodes[target] = new DependencyGraphNode(target);
  });

  // Set up the dependency links.  Targets that have no dependencies are treated
  // as dependent on root_node.
  const rootNode = new DependencyGraphNode(undefined);
  Object.keys(targets).forEach((target) => {
    const spec = targets[target];
    const targetNode = dependencyNodes[target];
    const dependencies = spec['dependencies'];

    if (!dependencies) {
      targetNode.dependencies = [ rootNode ];
      rootNode.dependents.push(targetNode);
    } else {
      dependencies.forEach((dependency) => {
        const dependencyNode = dependencyNodes[dependency];
        if (!dependencyNode) {
          throw new Error(`Dependency '${dependency}' not found while `
                          `trying to load target ${target}`);
        }
        // TODO(indutny): method for this
        targretNode.dependencies.push(dependencyNode);
        dependencyNode.dependents.push(targetNode);
      });
    }
  });

  const flatList = rootNode.flattenToList();
  // If there's anything left unvisited, there must be a circular dependency
  // (cycle).
  if (flatList.length !== targets.length) {
    if (rootNode.dependents.length === 0) {
      // If all targets have dependencies, add the first target as a dependent
      // of root_node so that the cycle can be discovered from root_node.
      const target = Object.keys(targets)[0];
      const targetNode = dependencyNodes[target];
      targetNode.dependencies.push(rootNode);
      targetNode.dependents.push(targetNode);
    }

    const cycles = [];
    rootNode.findCycles().forEach((cycle) => {
      const paths = cycle.map((node) => {
        return node.ref;
      });
      cycles.push(`Cycle: ${paths.join(' -> ')}`);
    });
    throw new Error('Cycles in dependency graph detected:\n' +
                    cycles.join('\n'));
  }

  return [ dependencyNodes, flatList ];
}

function verifyNoGYPFileCircularDependencies(targets) {
  // Create a DependencyGraphNode for each gyp file containing a target.  Put
  // it into a dict for easy access.
  const dependencyNodes = {};
  Object.keys(targets).forEach((target) => {
    const buildFile = gyp.common.buildFile(target);
    if (!dependencyNodes[buildFile])
      dependencyNodes[buildFile] = new DependencyGraphNode(buildFile);
  });

  // Set up the dependency links.
  Object.keys(targets).forEach((target) => {
    const spec = targets[target];
    const buildFile = gyp.common.buildFile(target);
    const buildFileNode = dependencyNodes[buildFile];
    const targetDependencies = spec['dependencies'] || [];
    targetDependencies.forEach((dependency) => {
      let dependencyBuildFile;
      try {
        dependencyBuildFile = gyp.common.buildFile(dependency);
      } catch (e) {
        e.message += ` while computing dependencies of .gyp file ${buildFile}`;
        // TODO(indutny): verify that it does not overwrite `e.stack`
        throw e;
      }

      if (dependencyBuildFile === buildFile) {
        // A .gyp file is allowed to refer back to itself.
        return;
      }

      const dependencyNode = dependencyNodes[dependencyBuildFile];
      if (!dependencyNode)
        throw new Error(`Dependancy '${dependencyBuildFile} not found`);

      if (buildFileNode.dependencies.indexOf(dependencyNode) === -1) {
        buildFileNode.dependencies.push(dependencyNode);
        dependencyNode.dependents.push(buildFileNode);
      }
    });
  });

  // Files that have no dependencies are treated as dependent on root_node.
  const rootNode = new DependencyGraphNode(undefined);
  Object.keys(dependencyNodes).forEach((k) => {
    const buildFileNode = dependencyNodes[k];
    if (buildFileNode.dependencies.length === 0) {
      buildFileNode.dependencies.push(rootNode);
      rootNode.dependents.push(buildFileNode);
    }
  });

  const flatList = rootNode.flattenToList();

  // If there's anything left unvisited, there must be a circular dependency
  // (cycle).
  if (flatList.length !== dependencyNodes.length) {
    if (rootNode.dependents.length === 0) {
      // If all files have dependencies, add the first file as a dependent
      // of root_node so that the cycle can be discovered from root_node.
      const fileNode = dependencyNodes[Object.keys(dependencyNodes)[0]];
      fileNode.dependencies.push(rootNode);
      rootNode.dependents.push(fileNode);
    }
    const cycles = [];
    rootNode.findCycles().forEach((cycle) => {
      const paths = cycle.map((node) => {
        return node.ref;
      });

      cycles.append(`Cycle ${paths.join(' -> ')}`);
    });
    throw new Error('Cycles in .gyp file dependency graph detected:\n' +
                    cycles.join('\n'));
  }
}

function doDependentSettings(key, flatList, targets, dependencyNodes) {
  // key should be one of all_dependent_settings, direct_dependent_settings,
  // or link_settings.
  flatList.forEach((target) => {
    const targetDict = targets[target];
    const buildFile = gyp.common.buildFile(target);

    let dependencies;
    if (key === 'all_dependent_settings') {
      dependencies = dependencyNodes[target].deepDependencies();
    } else if (key === 'direct_dependent_settings') {
      dependencies =
          dependencyNodes[target].directAndImportedDependencies(targets);
    } else if (key === 'link_settings') {
      dependencies =
          dependencyNodes[target].dependenciesForLinkSettings(targets);
    } else {
      throw new Error(`DoDependentSettings doesn't know how to determine ` +
                      `dependencies for ${key}`);
    }

    dependencies.forEach((dependency) => {
      const dependencyDict = targets[dependency];
      if (!dependencyDict[key])
        return;

      const dependencyBuildFile = gyp.common.buildFile(dependency);
      mergeDicts(targetDict, dependencyDict[key], buildFile,
                 dependencyBuildFile);
    });
  });
}

function adjustStaticLibraryDependencies(flatList, targets, dependencyNodes,
                                         sortDependencies) {
  // Recompute target "dependencies" properties.  For each static library
  // target, remove "dependencies" entries referring to other static libraries,
  // unless the dependency has the "hard_dependency" attribute set.  For each
  // linkable target, add a "dependencies" entry referring to all of the
  // target's computed list of link dependencies (including static libraries
  // if no such entry is already present.
  flatList.forEach((target) => {
    const targetDict = targets[target];
    const targetType = targetDict['type'];

    if (targetType === 'static_library') {
      if (!targetDict['dependencies'])
        return;

      targetDict['dependencies_original'] = targetDict['dependencies'].slice();
      // A static library should not depend on another static library unless
      // the dependency relationship is "hard," which should only be done when
      // a dependent relies on some side effect other than just the build
      // product, like a rule or action output. Further, if a target has a
      // non-hard dependency, but that dependency exports a hard dependency,
      // the non-hard dependency can safely be removed, but the exported hard
      // dependency must be added to the target to keep the same dependency
      // ordering.
      const dependencies =
          dependencyNodes[target].directAndImportedDependencies(target);
      let index = 0;
      while (index < dependencies.length) {
        const dependency = dependencies[index];
        const dependencyDict = targets[dependency];

        // Remove every non-hard static library dependency and remove every
        // non-static library dependency that isn't a direct dependency.
        if ((dependencyDict['type'] === 'static_library' &&
             !dependencyDict['hard_dependency']) ||
            (dependencyDict['type'] !== 'static_library' &&
             targetDict['dependencies'].indexOf(dependency) === -1)) {
          dependencies.splice(index, 1);
        } else {
          index++;
        }

        // Update the dependencies. If the dependencies list is empty, it's not
        // needed, so unhook it.
        if (dependencies.length > 0)
          targetDict['dependencies'] = dependencies;
        else
          delete targetDict['dependencies'];
      }
    } else if (linkableTypes.indexOf(targetType)) {
      // Get a list of dependency targets that should be linked into this
      // target.  Add them to the dependencies list if they're not already
      // present.

      const linkDependencies =
          dependencyNodes[target].dependenciesToLinkAgainst(targets);
      linkDependencies.forEach((dependency) => {
        if (dependency === target)
          return;

        if (!targetDict['dependencies'])
          targetDict['dependencies'] = [];
        if (targetDict['dependencies'].indexOf(dependency) === -1)
          targetDict['dependencies'].push(dependency);
      });

      // Sort the dependencies list in the order from dependents to dependencies.
      // e.g. If A and B depend on C and C depends on D, sort them in A, B, C, D.
      // Note: flat_list is already sorted in the order from dependencies to
      // dependents.
      if (sortDependencies && targetDict['dependencies']) {
        targetDict['dependencies'] = flatList.slice().reverse()
            .filter((dep) => {
          return targetDict['dependencies'].indexOf(dep) !== -1;
        });
      }
    }
  });
}

// Initialize this here to speed up MakePathRelative.
const EXCEPTION_RE = /["']?[-/$<>^]/;

function makePathRelative(toFile, froFile, item) {
  // If item is a relative path, it's relative to the build file dict that it's
  // coming from.  Fix it up to make it relative to the build file dict that
  // it's going into.
  // Exception: any |item| that begins with these special characters is
  // returned without modification.
  //   /   Used when a path is already absolute (shortcut optimization;
  //       such paths would be returned as absolute anyway)
  //   $   Used for build environment variables
  //   -   Used for some build environment flags (such as -lapr-1 in a
  //       "libraries" section)
  //   <   Used for our own variable and command expansions (see ExpandVariables)
  //   >   Used for our own variable and command expansions (see ExpandVariables)
  //   ^   Used for our own variable and command expansions (see ExpandVariables)
  //
  //   "/' Used when a value is quoted.  If these are present, then we
  //       check the second character instead.
  //
  if (toFile === froFile || EXCEPTION_RE.test(item)) {
    return item;
  } else {
    // TODO(dglazkov) The backslash/forward-slash replacement at the end is a
    // temporary measure. This should really be addressed by keeping all paths
    // in POSIX until actual project generation.
    // PORT: gyp.common.RelativePath()
    let ret = path.normalize(path.join(
        path.relative(path.dirname(froFile), path.dirname(toFile)),
        items)).replace(/\\/g, '/');
    if (/\/$/.test(item))
      ret += '/';
    return ret;
  }
}

function mergeLists(to, fro, toFile, froFile, isPaths=false, append=true) {
  // Python objects and lists are not hashable
  // TODO(indutny): is it needed?
  const isHashable = val => typeof val !== 'object';

  // If x is hashable, returns whether x is in s. Else returns whether x is in l
  function isInSetOrList(x, s, l) {
    if (isHashable(x))
      return s.has(x);
    return l.indexOf(x) !== -1;
  }

  let prependIndex = 0;

  // Make membership testing of hashables in |to| (in particular, strings)
  // faster.
  const hashableToSet = new Set();
  to.forEach((x) => {
    if (isHashable(x))
      hashableToSet.add(x);
  });
  fro.forEach((item) => {
    let singleton = false;
    let toItem;
    if (typeof item === 'string' || typeof item === 'number') {
      // The cheap and easy case.
      if (isPaths)
        toItem = makePathRelative(toFile, froFile, item);
      else
        toItem = item;

      if (!(typeof item === 'string' && /^-/.test(item))) {
        // Any string that doesn't begin with a "-" is a singleton - it can
        // only appear once in a list, to be enforced by the list merge append
        // or prepend.
        singleton = true;
      }
    } else if (typeof item === 'object') {
      toItem = {};
      mergeDicts(toItem, item, toFile, froFile);
    } else if (Array.isArray(item)) {
      // Recurse, making a copy of the list.  If the list contains any
      // descendant dicts, path fixing will occur.  Note that here, custom
      // values for is_paths and append are dropped; those are only to be
      // applied to |to| and |fro|, not sublists of |fro|.  append shouldn't
      // matter anyway because the new |to_item| list is empty.
      toItem = [];
      mergeLists(toItem, item, toFile, froFile);
    } else {
      throw new TypeError(
          `Attempt to merge list item of unsupported type ${typeof item}`);
    }

    if (append) {
      // If appending a singleton that's already in the list, don't append.
      // This ensures that the earliest occurrence of the item will stay put.
      if (!singleton || !isInSetOrList(toItem, hashableToSet, to)) {
        to.push(toItem);
        if (isHashable(toItem))
          hashableToSet.add(toItem);
      }
    } else {
      // If prepending a singleton that's already in the list, remove the
      // existing instance and proceed with the prepend.  This ensures that the
      // item appears at the earliest possible position in the list.
      while (singleton && to.indexOf(toItem) !== -1)
        to.splice(to.indexOf(toItem), 1);

      // Don't just insert everything at index 0.  That would prepend the new
      // items to the list in reverse order, which would be an unwelcome
      // surprise.
      to.splice(prependIndex, 0, toItem);
      if (isHashable(toItem))
        hashableToSet.add(toItem);
      prependIndex++;
    }
  });
}

function mergeDicts(to, fro, toFile, froFile) {
  // I wanted to name the parameter "from" but it's a Python keyword...
  Object.keys(fro).forEach((k) => {
    const v = fro[k];
    // It would be nice to do "if not k in to: to[k] = v" but that wouldn't give
    // copy semantics.  Something else may want to merge from the |fro| dict
    // later, and having the same dict ref pointed to twice in the tree isn't
    // what anyone wants considering that the dicts may subsequently be
    // modified.
    if (to.hasOwnProperty(k)) {
      let badMerge = false;
      if (typeof v === 'string' || typeof v === 'number') {
        if (typeof to[k] !== 'string' && typeof to[k] !== 'number')
          badMerge = true;
      } else if (typeof v !== typeof to[k]) {
        badMerge = true;
      }

      if (badMerge) {
        throw TypeError(
            `Attempt to merge dict value of type $[typeof v} ` +
            `into incompatible type ${typeof to[k]} ` +
            `for key ${k}`);
      }
    }
  });
}
