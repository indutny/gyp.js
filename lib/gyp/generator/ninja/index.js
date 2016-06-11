'use strict';

// TODO(indutny): replace with minimal-assert
const path = require('path');
const fs = require('fs');

const gyp = require('../../../gyp');
const Writer = require('./writer');

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

  // TODO(indutny): allow override?
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

function Ninja(outDir, target, targetDict, ninjas) {
  const [ buildFile, targetName, toolset ] =
      gyp.common.parseQualifiedTarget(target);

  let obj = 'obj';
  if (toolset !== 'target')
    obj += '.' + toolset;

  this.ninjas = ninjas;

  this.targetName = targetName;
  this.targetDict = targetDict;

  this.outDir = outDir;
  this.objDir = path.join(outDir, obj, path.dirname(buildFile));
  this.srcDir = path.dirname(buildFile);
  this.useCxx = false;

  const filename = path.join(this.objDir, targetName) + '.ninja';
  this.n = new Writer(filename);
  this.filename = filename;

  this.flavor = process.platform;
  this.objExt = this.flavor === 'win32' ? '.obj' : '.o';
}

Ninja.prototype.srcPath = function srcPath(p) {
  // TODO(indutny`): replace INTERMEDIATE_DIR, etc
  p = p.replace(/\$!PRODUCT_DIR/g, this.outDir);

  return path.relative(this.outDir, path.join(this.srcDir, p));
};

function escapeDefine(s) {
  // TODO(indutny): more
  if (/"/.test(s))
    return '\'' + s + '\'';
  return s;
}

Ninja.prototype.type = function type() {
  return this.targetDict.type;
};

Ninja.prototype.output = function output() {
  const targetDict = this.targetDict;

  const gdv = generatorDefaultVariables;
  let prefix;
  let suffix;

  const type = this.type();
  if (type === 'static_library') {
    prefix = gdv.STATIC_LIB_PREFIX;
    suffix = gdv.STATIC_LIB_SUFFIX;
  } else if (type === 'executable') {
    prefix = gdv.EXECUTABLE_PREFIX;
    suffix = gdv.EXECUTABLE_SUFFIX;
  } else if (type === 'none') {
    // pass through
    prefix = '';
    suffix = '';
  } else {
    throw new Error('Not implemented');
  }

  let out = this.targetName + suffix;
  if (out.indexOf(prefix) !== 0)
    out = prefix + out;

  return out;
};

Ninja.prototype.vars = function vars() {
  const targetDict = this.targetDict;

  this.n.section('variables');

  // TODO(indutny): windows
  let cflags = [];
  cflags = cflags.concat(targetDict.cflags || []);
  if (targetDict.xcode_settings)
    cflags = cflags.concat(targetDict.xcode_settings.OTHER_CFLAGS || []);
  cflags = cflags.concat(
      (targetDict.include_dirs || []).map(dir => `-I${this.srcPath(dir)}`));
  cflags = cflags.concat(
      (targetDict.defines || []).map(def => escapeDefine(`-D${def}`)));

  if (cflags.length !== 0)
    this.n.declare('cflags', this.n.escape(cflags.join(' ').trim()));

  let ldflags = [];
  ldflags = ldflags.concat(targetDict.ldflags || []);
  if (targetDict.xcode_settings)
    ldflags = ldflags.concat(targetDict.xcode_settings.OTHER_LDFLAGS || []);

  // TODO(indutny): library_dirs
  ldflags = ldflags.concat(targetDict.libraries || []);

  if (ldflags.length !== 0)
    this.n.declare('ldflags', this.n.escape(ldflags.join(' ').trim()));

  this.n.sectionEnd('variables');
};

Ninja.prototype.generate = function generate(data, params) {
  const targetDict = this.targetDict;

  this.vars();

  // TODO(indutny): actions

  const objs = [];

  (targetDict.dependencies || []).forEach((dep) => {
    const depType = this.ninjas[dep].type();
    if (depType === 'static_library')
      objs.push(this.ninjas[dep].output());
  });

  this.n.section('objects');

  const objShared = path.relative(this.outDir, this.objDir);

  (targetDict.sources || []).forEach((source) => {
    // Ignore non-buildable sources
    if (!/\.(c|cc|cpp|cxxC|s|S|asm)/.test(source))
      return;

    // Get relative path to the source file
    source = this.srcPath(source);

    // TODO(indutny): objc
    const cxx = /\.(cc|cpp|cxx)$/.test(source);
    if (cxx)
      this.useCxx = true;

    const objBasename = this.targetName + '.' +
                        path.basename(source).replace(/\.[^.]$/, '') +
                        this.objExt;

    const obj = path.join(objShared, path.dirname(source), objBasename);
    this.n.build(cxx ? 'cxx' : 'cc', [ obj ], [ source ]);

    objs.push(obj);
  });

  this.n.sectionEnd('objects');

  this.n.section('result');

  const out = this.output();

  const type = this.type();
  if (type === 'static_library')
    this.n.build('alink', [ out ], objs);
  else if (type === 'executable')
    this.n.build('link', [ out ], objs);

  this.n.sectionEnd('result');

  this.n.finalize();
  return this.filename;
};

function generateConfigOutput(targetList, targetDicts, data, params, config) {
  const options = params.options;
  const genDir = path.relative(options.generatorOutput || '.', '.');
  const outDir = path.normalize(path.join(
      genDir,
      options.generator_flags && options.generator_flags.output_dir ||
          'out'));

  const configDir = path.join(outDir, config);

  const main = new Writer(path.join(configDir, 'build.ninja'));

  // TODO(indutny): env variable override
  main.section('variables');

  main.declare('cc', 'clang');
  main.declare('cxx', 'clang++');
  main.declare('ld', 'clang');
  main.declare('ldxx', 'clang++');
  main.declare('ar', 'ar');

  main.sectionEnd('variables');

  main.section('rules');

  main.pool('link_pool', {
    depth: 4
  });

  main.rule('cc', {
    depfile: '$out.d',
    deps: 'gcc',
    command: '$cc -MMD -MF $out.d $cflags $cflags_c -c $in -o $out',
    description: 'CC $out'
  });

  main.rule('cxx', {
    depfile: '$out.d',
    deps: 'gcc',
    command: '$cxx -MMD -MF $out.d $cflags $cflags_cc -c $in -o $out',
    description: 'CXX $out'
  });

  let useCxx = false;
  const ninjas = {};
  const ninjaList = targetList.map((target) => {
    const ninja = new Ninja(configDir, target,
                            targetDicts[target].configurations[config], ninjas);
    ninjas[target] = ninja;
    return ninja;
  });

  const ninjaFiles = ninjaList.map((ninja) => {
    const res = ninja.generate(data, params);
    useCxx = useCxx || ninja.useCxx;
    return path.relative(configDir, res);
  });

  main.rule('link', {
    command: `$${useCxx ? 'ldxx' : 'ld'} ` +
             `$${useCxx ? 'ldflags_cc' : 'ldflags_c'} $ldflags $in -o $out`,
    pool: 'link_pool',
    description: 'LINK $out'
  });

  main.rule('alink', {
    command: 'rm -rf $out && $ar rcs $arflags $out $in',
    description: 'ALINK $out'
  });

  main.sectionEnd('rules');

  main.section('targets');
  ninjaFiles.forEach(file => main.subninja(file));
  main.sectionEnd('targets');

  main.finalize();
}

exports.generateOutput = function generateOutput(targetList, targetDicts, data,
                                                 params) {
  const configs = Object.keys(targetDicts[targetList[0]].configurations);

  configs.forEach((config) => {
    generateConfigOutput(targetList, targetDicts, data, params, config);
  });
};

exports.performBuild = function performBuild() {
  throw new Error('Not implemented');
};
