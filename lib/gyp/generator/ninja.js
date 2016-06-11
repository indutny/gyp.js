'use strict';

// TODO(indutny): replace with minimal-assert
const path = require('path');
const fs = require('fs');

const gyp = require('../../gyp');

const generatorDefaultVariables = {
  'EXECUTABLE_PREFIX': '',
  'EXECUTABLE_SUFFIX': '',
  'STATIC_LIB_PREFIX': 'lib',
  'STATIC_LIB_SUFFIX': '.a',
  'SHARED_LIB_PREFIX': 'lib',

  /* Gyp expects the following variables to be expandable by the build
   * system to the appropriate locations.  Ninja prefers paths to be
   * known at gyp time.  To resolve this, introduce special
   * variables starting with $! and $| (which begin with a $ so gyp knows it
   * should be treated specially, but is otherwise an invalid
   * ninja/shell variable) that are passed to gyp here but expanded
   * before writing out into the target .ninja files; see
   * ExpandSpecial.
   * $! is used for variables that represent a path and that can only appear at
   * the start of a string, while $| is used for variables that can appear
   * anywhere in a string.
   */
  'INTERMEDIATE_DIR': '$!INTERMEDIATE_DIR',
  'SHARED_INTERMEDIATE_DIR': '$!PRODUCT_DIR/gen',
  'PRODUCT_DIR': '$!PRODUCT_DIR',
  'CONFIGURATION_NAME': '$|CONFIGURATION_NAME',

  /* Special variables that may be used by gyp 'rule' targets.
   * We generate definitions for these variables on the fly when processing a
   * rule.
   */
  'RULE_INPUT_ROOT': '${root}',
  'RULE_INPUT_DIRNAME': '${dirname}',
  'RULE_INPUT_PATH': '${source}',
  'RULE_INPUT_EXT': '${ext}',
  'RULE_INPUT_NAME': '${name}'
};
exports.generatorDefaultVariables = generatorDefaultVariables;

exports.generatorAdditionalNonConfigurationKeys = [];
exports.generatorAdditionalPathSections = [];
exports.generatorExtraSourcesForRules = [];
exports.generatorFilelistPaths = undefined;
exports.generatorSupportsMultipleToolsets = gyp.common.crossCompileRequested();


function calculateVariables(defaultVariables, params) {
  function setdef(key, val) {
    if (!defaultVariables.hasOwnProperty(key))
      defaultVariables[key] = val;
  }

  if (process.platform === 'darwin') {
    setdef('OS', 'mac');
    setdef('SHARED_LIB_SUFFIX', '.dylib');
    setdef('SHARED_LIB_DIR', generatorDefaultVariables['PRODUCT_DIR']);
    setdef('LIB_DIR', generatorDefaultVariables['PRODUCT_DIR']);
  } else if (process.platform === 'win32') {
    setdef('OS', 'win')
    defaultVariables['EXECUTABLE_SUFFIX'] = '.exe';
    defaultVariables['STATIC_LIB_PREFIX'] = ''
    defaultVariables['STATIC_LIB_SUFFIX'] = '.lib';
    defaultVariables['SHARED_LIB_PREFIX'] = ''
    defaultVariables['SHARED_LIB_SUFFIX'] = '.dll';
  } else {
    setdef('OS', process.platform);
    setdef('SHARED_LIB_SUFFIX', '.so');
    setdef('SHARED_LIB_DIR', path.join('$!PRODUCT_DIR', 'lib'));
    setdef('LIB_DIR', path.join('$!PRODUCT_DIR', 'obj'));
  }
};
exports.calculateVariables = calculateVariables;

function Ninja() {
}

Ninja.prototype.generate = function generate(target, targetDict, data, params) {
  console.log(target, targetDict.configurations);
};

exports.generateOutput = function generateOutput(targetList, targetDicts, data,
                                                 params) {
  const ninjaFiles = targetList.map((target) => {
    const ninja = new Ninja();

    return ninja.generate(target, targetDicts[target], data, params);
  });

};

exports.performBuild = function performBuild() {
  throw new Error('Not implemented');
};
