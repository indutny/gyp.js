'use strict';

const fs = require('fs');
const path = require('path');

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

function pyEval(fileContents) {
  throw new Error('Not implemented');
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

    gyp.DebugOutput(gyp.DEBUG_INCLUDES, 'Loading Included FIle: \'%s\'',
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

  gyp.DebugOutput(gyp.DEBUG_INCLUDES,
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
