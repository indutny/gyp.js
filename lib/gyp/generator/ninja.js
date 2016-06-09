'use strict';

const gyp = require('../../gyp');

exports.generatorDefaultVariables = {
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

exports.generatorAdditionalNonConfigurationKeys = [];
exports.generatorAdditionalPathSections = [];
exports.generatorExtraSourcesForRules = [];
exports.generatorFilelistPaths = undefined;
exports.generatorSupportsMultipleToolsets = gyp.common.crossCompileRequested();
