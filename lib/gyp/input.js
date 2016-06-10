'use strict';

const fs = require('fs');
const path = require('path');
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
  for (let i = 0; i < list.length; i++) {
    const includedBuildFile = list[i];
    getIncludedBuildFiles(includedBuildFile, auxData, included);
  }

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
      e.message += `while reading includes of ${buildFilePath}`;
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
    for (let i = 0; i < sub.length; i++) {
      const include = sub[i];
      // "include" is specified relative to subdict_path, so compute the real
      // path to include by appending the provided "include" to the directory
      // in which subdict_path resides.

      // PORT os.path.normpath()
      const relativeInclude = path.normalize(
          path.join(path.dirname(subdictPath), include));
      includesList.push(relativeInclude);
    }

    // Unhook the includes list, it's no longer needed.
    delete subdict['includes'];
  }

  // Merge in the included files.
  for (let i = 0; i < includesList.length; i++) {
    const include = includesList[i];

    if (!auxData[subdictPath]['included'])
      auxData[subdictPath]['included'] = [];
    auxData[subdictPath]['included'].push(include);

    gyp.debugOutput(gyp.DEBUG_INCLUDES, 'Loading Included FIle: \'%s\'',
                    include);

    mergeDicts(
        subdict,
        loadOneBuildFile(include, data, auxData, undefined, false, check),
        subdictPath, include);
  }

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
  for (let i = 0; i < sublist.length; i++) {
    const item = sublist[i];
    if (typeof item === 'object') {
      loadBuildFileIncludesIntoDict(item, sublistPath, data, auxData, undefined,
                                    check);
    } else if (Array.isArray(item)) {
      loadBuildFileIncludesIntoList(item, sublistPath, data, auxData, check);
    }
  }
}

// Processes toolsets in all the targets. This recurses into condition entries
// since they can contain toolsets as well.
function processToolsetsInDict(data) {
  if (data['targets']) {
    const targetList = data['targets'];
    const newTargetList = [];
    for (let i = 0; i < targetList.length; i++) {
      const target = targetList[i];

      // If this target already has an explicit 'toolset', and no 'toolsets'
      // list, don't modify it further.
      if (target['toolset'] && !target['toolsets']) {
        newTargetList.push(target);
        continue;
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
        for (let i = 1; i < toolsets.length; i++) {
          const build = toolsets[i];

          // PORT: gyp.simple_copy.deepcopy()
          const newTarget = JSON.parse(JSON.stringify(target));
          newTarget['toolset'] = build;
          newTargetList.push(target);
        }
        target['toolset'] = toolsets[0]
        newTargetList.push(target);
      }
    }
    data['targets'] = newTargetList;
  }
  if (data['conditions']) {
    for (let i = 0; i < data['conditions']; i++) {
      const condition = data['conditions'][i];
      if (Array.isArray(condition)) {
        for (let i = 1; i < condition.length; i++) {
          const conditionDict = condition[i];
          if (typeof conditionDict === 'object')
            processToolsetsInDict(conditionDict);
        }
      }
    }
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
  for (let i = 0; i < included.length; i++) {
    const includedFile = included[i];

    // included_file is relative to the current directory, but it needs to
    // be made relative to build_file_path's directory.

    // PORT: gyp.common.RelativePath
    const includedRelative =
        path.relative(includedFile, path.dirname(buildFilePath));
    buildFileData['included_files'].push(includedRelative);
  }

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
    for (let i = 0; i < buildFileData['targets'].length; i++) {
      const targetDict = buildFileData['targets'][i];
      if (!targetDict['dependencies'])
        continue;

      for (let i = 0; i < targetDict['dependencies'].length; i++) {
        const dependency = targetDict['dependencies'][i];
        dependencies.append(gyp.common.resolveTarget(buildFilePath,
                                                     dependency,
                                                     undefined)[0]);
      }
    }
  }

  if (loadDependencies) {
    for (let i = 0; i < dependencies.length; i++) {
      const dependency = dependencies[i];
      try {
        loadTargetBuildFile(dependency, data, auxData, variables,
                            includes, depth, check, loadDependencies);
      } catch (e) {
        e.message += `while loading dependencies of ${buildFilePath}`;
        // TODO(indutny): verify that it does not overwrite `e.stack`
        throw e;
      }
    }
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
    for (let i = 0; i < dependencies.length; i++) {
      const newDependency = dependencies[i];

      if (!scheduled.has(newDependency)) {
        scheduled.add(newDependency);
        dependencies.push(newDependency);
      }
    }
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
      for (let i = 0; i < replacement.length; i++) {
        const item = replacement[i];
        if (!/\/$/.test(contents) &&
            typeof item !== 'string' &&
            typeof item !== 'number') {
          throw new Error(
              `Variable ${contents} must expand to a string or list of ` +
              `strings; list contains a ${typeof item}`);
        }
      }
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
        for (let i = 0; i < output.length; i++) {
          const item = output[i];
          newOutput.push(expandVariables(item, phase, variables, buildFile));
        }
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
cachedConditionsFns = {};

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
        `while evaluating condition ${condExprExpanded} in ${buildFile}`;
    // TODO(indutny): verify that it does not overwrite `e.stack`
    throw e;
  }
}
