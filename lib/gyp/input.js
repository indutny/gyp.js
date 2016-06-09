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
}
