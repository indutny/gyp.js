'use strict';

const gyp = require('../../../gyp');
const Writer = require('./writer');

const path = gyp.bindings.path;
const process = gyp.bindings.process;

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


function calculateVariables(defaultVariables) {
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
    setdef('OS', 'win');
    defaultVariables['EXECUTABLE_SUFFIX'] = '.exe';
    defaultVariables['STATIC_LIB_PREFIX'] = '';
    defaultVariables['STATIC_LIB_SUFFIX'] = '.lib';
    defaultVariables['SHARED_LIB_PREFIX'] = '';
    defaultVariables['SHARED_LIB_SUFFIX'] = '.dll';
    defaultVariables['MSVS_VERSION'] = gyp.platform.win.getMSVSVersion();
    defaultVariables['MSVS_OS_BITS'] = gyp.platform.win.getOSBits();
  } else {
    setdef('OS', process.platform);
    setdef('SHARED_LIB_SUFFIX', '.so');
    setdef('SHARED_LIB_DIR', path.join('$!PRODUCT_DIR', 'lib'));
    setdef('LIB_DIR', path.join('$!PRODUCT_DIR', 'obj'));
  }
}
exports.calculateVariables = calculateVariables;

function Ninja({ index, outDir, target, targetDict, ninjas, config }) {
  const [ buildFile, targetName, toolset ] =
      gyp.common.parseQualifiedTarget(target);

  let obj = 'obj';
  if (toolset !== 'target')
    obj += '.' + toolset;

  this.index = index;
  this.ninjas = ninjas;
  this.config = config;

  this.targetName = targetName;
  this.targetDict = targetDict;

  this.outDir = outDir;
  this.intDir = path.dirname(buildFile);
  this.objDir = path.join(outDir, obj, this.intDir);
  this.srcDir = path.dirname(buildFile);
  this.useCxx = false;

  const filename = path.join(this.objDir, targetName) + '.ninja';
  this.n = new Writer(filename);
  this.filename = filename;

  this.flavor = process.platform;
  this.objExt = this.flavor === 'win32' ? '.obj' : '.o';

  this.bashAnd = this.flavor === 'win32' ? '&' : '&&';
}

Ninja.prototype.expand = function expand(p, productDir = '.') {
  if (productDir === '.')
    p = p.replace(/\$!PRODUCT_DIR[\\\/]/g, '');
  p = p.replace(/\$!PRODUCT_DIR/g, productDir);

  // TODO(indutny): verify this
  if (/\$!INTERMEDIATE_DIR/g.test(p)) {
    const intDir = path.join(productDir, this.intDir, 'gen');
    p = p.replace(/\$!INTERMEDIATE_DIR/g, intDir);
  }

  p = p.replace(/\$\|CONFIGURATION_NAME/g, this.config);

  // TODO(indutny): do this at input
  // Replace backslashes, but not in flags (starting from `-` or `/`)
  if (this.flavor === 'win32' && !/^[\-\/]/.test(p))
    p = p.replace(/\//g, '\\');

  return p;
};

Ninja.prototype.srcPath = function srcPath(p) {
  if (/^\$!/.test(p))
    return this.expand(p);
  p = this.expand(p);
  if (path.isAbsolute(p))
    return p;
  return gyp.common.cachedRelative(this.outDir, path.join(this.srcDir, p));
};

function escapeDefine(s) {
  if (process.platform === 'win32') {
    // cl.exe replaces literal # characters with = in preprocesor definitions
    // for some reason. Octal-encode to work around that.
    s = s.replace(/#/g, '\\0043');
  }

  s = `-D${s}`;
  if (process.platform === 'win32')
    return gyp.platform.win.escapeDefine(s);

  // TODO(indutny): more
  if (/"/.test(s))
    return `'${s}'`;
  return s;
}

Ninja.prototype.type = function type() {
  return this.targetDict.type;
};

Ninja.prototype.output = function output() {
  let res = [];

  let vars = gyp.common.shallowCopy(generatorDefaultVariables);
  exports.calculateVariables(vars, {});

  let prefix;
  let suffix;

  const type = this.type();
  if (type === 'static_library') {
    prefix = vars.STATIC_LIB_PREFIX;
    suffix = vars.STATIC_LIB_SUFFIX;
  } else if (type === 'shared_library' || type === 'loadable_module') {
    prefix = vars.SHARED_LIB_PREFIX;
    suffix = vars.SHARED_LIB_SUFFIX || '';
  } else if (type === 'executable') {
    prefix = vars.EXECUTABLE_PREFIX;
    suffix = vars.EXECUTABLE_SUFFIX;
  } else if (type === 'none') {
    // pass through
    prefix = '';
    suffix = '';
  } else {
    throw new Error('Not implemented');
  }

  let name = this.targetName;

  if (this.targetDict.hasOwnProperty('product_prefix'))
    prefix = this.targetDict.product_prefix;
  if (this.targetDict.product_extension)
    suffix = '.' + this.targetDict.product_extension;
  if (this.targetDict.hasOwnProperty('product_name'))
    name = this.targetDict.product_name;

  let out = name + suffix;
  if (prefix === 'lib' && /^lib/.test(out))
    out = out.slice(3);

  out = prefix + out;

  if (type !== 'none')
    res.push(out);

  // TODO(indutny): cache these, maybe?
  const actions = this.targetDict.actions || [];
  actions.forEach((action) => {
    res = res.concat((action.outputs || []).map(o => this.srcPath(o)));
  });

  // TODO(indutny): cache these, maybe?
  const copies = this.targetDict.copies || [];
  copies.forEach((copy) => {
    const outDir = this.srcPath(copy.destination);

    copy.files.forEach((file) => {
      res.push(path.join(outDir, path.basename(file)));
    });
  });

  if (res.length !== 0)
    return res;

  // Empty output, output dependencies (our recursively)
  res = res.concat(this.deps());
  return res;
};

Ninja.prototype.deps = function deps() {
  let res = [];
  (this.targetDict.dependencies || []).forEach((dep) => {
    const depOut = this.ninjas[dep].output();
    res = res.concat(depOut);
  });
  return res;
};

Ninja.prototype.vars = function vars() {
  const targetDict = this.targetDict;

  this.n.section('variables');

  let cflags = [];
  let cflags_c = [];
  let cflags_cc = [];
  let ldflags = [];
  let libs = [];

  // TODO(indutny): special preparation for includes on windows
  const includes =
      (targetDict.include_dirs || []).map(dir => `-I${this.srcPath(dir)}`);
  const defines =  (targetDict.defines || []).map(def => escapeDefine(def));

  // OSX uses xcode_settings for cflags, ldflags
  if (this.flavor !== 'darwin' && this.flavor !== 'win32') {
    cflags = cflags.concat(targetDict.cflags || []);
    cflags_c = cflags_c.concat(targetDict.cflags_c || []);
    cflags_cc = cflags_cc.concat(targetDict.cflags_cc || []);
    ldflags = ldflags.concat(targetDict.ldflags || []);
  }

  if (this.flavor === 'darwin' && targetDict.xcode_settings) {
    let flags = gyp.platform.darwin.compilerFlags(targetDict.xcode_settings);
    cflags = cflags.concat(flags.cflags);
    cflags_c = cflags_c.concat(flags.cflags_c);
    cflags_cc = cflags_cc.concat(flags.cflags_cc);
    ldflags = ldflags.concat(flags.ldflags);
  }

  if (this.flavor === 'win32') {
    let flags = gyp.platform.win.targetFlags(targetDict);
    cflags = cflags.concat(flags.cflags);
    cflags_c = cflags_c.concat(flags.cflags_c);
    cflags_cc = cflags_cc.concat(flags.cflags_cc);
    ldflags = ldflags.concat(flags.ldflags);
  }

  // TODO(indutny): library_dirs
  libs = libs.concat(targetDict.libraries || []);
  if (this.flavor === 'win32') {
    libs = gyp.platform.win.adjustLibraries(libs);
  }
  const prepare = (list) => {
    return list.map(v => this.expand(v)).join(' ').trim();
  };

  // TODO(indutny): special preparation for ldflags on OS X
  if (ldflags.length !== 0)
    this.n.declare('ldflags', prepare(ldflags));
  if (libs.length !== 0)
    this.n.declare('libs', prepare(Array.from(new Set(libs))));
  if (cflags.length !== 0)
    this.n.declare('cflags', prepare(cflags));
  if (cflags_c.length !== 0)
    this.n.declare('cflags_c', prepare(cflags_c));
  if (cflags_cc.length !== 0)
    this.n.declare('cflags_cc', prepare(cflags_cc));
  if (includes.length !== 0)
    this.n.declare('includes', prepare(includes));
  if (defines.length !== 0)
    this.n.declare('defines', prepare(defines));

  this.n.sectionEnd('variables');
};

Ninja.prototype.actionCmd = function actionCmd(base, toBase, cmds) {
  const res = `cd ${base} ${this.bashAnd} ` +
              `${cmds.map(c => this.expand(c, toBase)).join(' ')}`;
  if (this.flavor !== 'win32')
    return res;

  // TODO(indutny): escape quotes in res
  return `cmd.exe /s /c "${res}"`;
};

Ninja.prototype.copies = function copies() {
  const copies = this.targetDict.copies || [];
  if (copies.length === 0)
    return [];

  this.n.section('copies');

  const deps = this.deps();

  let res = [];
  copies.forEach((copy) => {
    const outDir = this.srcPath(copy.destination);

    copy.files.forEach((file) => {
      const input = this.srcPath(file);
      const output = path.join(outDir, path.basename(file));

      this.n.build('copy', [ output ], [ input ], {
        implicitDeps: deps
      });

      res.push(output);
    });
  });

  this.n.sectionEnd('copies');

  return res;
};

Ninja.prototype.actions = function actions() {
  const actions = this.targetDict.actions || [];
  if (actions.length === 0)
    return [];

  this.n.section('actions');

  const deps = this.deps();

  let res = [];
  actions.forEach((action) => {
    const actionRule = action.action_name + '_' + this.index;

    const base = gyp.common.cachedRelative(this.outDir, this.srcDir);
    const toBase = gyp.common.cachedRelative(this.srcDir, this.outDir);

    this.n.rule(actionRule, {
      description: action.message,
      command: this.n.escape(this.actionCmd(base, toBase, action.action))
    });

    const inputs = (action.inputs || []).map(i => this.srcPath(i));
    const outputs = (action.outputs || []).map(i => this.srcPath(i));

    res = res.concat(outputs);

    this.n.build(actionRule, outputs, inputs, {
      implicitDeps: deps
    });
  });

  this.n.sectionEnd('actions');

  return res;
};

Ninja.prototype.generate = function generate() {
  const targetDict = this.targetDict;

  this.vars();

  const deps = this.actions().concat(this.copies(), this.deps());

  this.n.section('objects');

  let objs = [];
  (targetDict.sources || []).forEach((originalSource) => {
    // Ignore non-buildable sources
    if (!/\.(c|cc|cpp|cxx|s|S|asm)/.test(originalSource))
      return;

    // Get relative path to the source file
    let source = this.srcPath(originalSource);
    originalSource = this.expand(originalSource);

    // TODO(indutny): objc
    const cxx = /\.(cc|cpp|cxx)$/.test(source);
    if (cxx)
      this.useCxx = true;

    let objBasename = this.targetName + '.' +
                      path.basename(originalSource).replace(/\.[^.]+$/, '');

    const isWinASM = this.flavor === 'win32' && /\.asm$/.test(source);
    if (isWinASM)
      objBasename += '_asm.obj';
    else
      objBasename += this.objExt;

    const objPath = path.join(this.objDir,
      path.isAbsolute(originalSource)? '' : path.dirname(originalSource),
      objBasename);
    const obj = gyp.common.cachedRelative(this.outDir, objPath);
    const rule = isWinASM ? 'asm' : cxx ? 'cxx' : 'cc';

    this.n.build(rule, [ obj ], [ source ], {
      orderOnlyDeps: deps
    });

    objs.push(obj);
  });

  objs = objs.concat(deps);

  this.n.sectionEnd('objects');

  this.n.section('result');

  const out = this.output();
  const type = this.type();
  let rule;
  if (type === 'static_library')
    rule = 'alink';
  else if (type === 'shared_library' || type === 'loadable_module')
    rule = 'solink';
  else if (type === 'executable')
    rule = 'link';

  function filterLinkable(obj) {
    // Do not link archives to archives
    if (type === 'static_library')
      return /\.(o|obj)$/.test(obj);

    // TODO(indunty): is it needed?
    // Do not link .so to shared_libraries
    if (type === 'shared_library' || type === 'loadable_module')
      return /\.(o|a|obj|lib)$/.test(obj);

    return /\.(o|a|obj|dll|so|lib)$/.test(obj);
  }

  function filterNotLinkable(obj) {
    return !filterLinkable(obj);
  }

  if (rule) {
    this.n.build(rule, [ out[0] ], objs.filter(filterLinkable), {
      implicitDeps: objs.filter(filterNotLinkable).concat(deps)
    });
  }

  this.n.sectionEnd('result');

  this.n.finalize();
  return this.filename;
};

function NinjaMain(targetList, targetDicts, data, params, config) {
  this.targetList = targetList;
  this.targetDicts = targetDicts;
  this.data = data;
  this.params = params;
  this.config = config;

  this.options = params.options;

  this.genDir = this.options.generator_output || '.'
  if (!path.isAbsolute(this.genDir))
    this.genDir = path.relative(this.genDir, '.');
  this.outDir = path.normalize(path.join(
      this.genDir,
      this.options.generator_flags && this.options.generator_flags.output_dir ||
          'out'));
  this.configDir = path.join(this.outDir, this.config);

  this.n = new Writer(path.join(this.configDir, 'build.ninja'));

  this.ninjas = {};
}

NinjaMain.prototype.generate = function generate() {
  this.vars();
  this.rulesAndTargets();
  this.defaults();
};

NinjaMain.prototype.vars = function vars() {
  const main = this.n;

  // TODO(indutny): env variable override
  main.section('variables');

  const env = process.env;
  let cc;
  let cxx;
  let ar = 'ar';
  let ld;
  if (process.platform === 'darwin') {
    cc = 'clang';
    cxx = 'clang++';
  } else if (process.platform === 'win32') {
    ar = 'lib.exe';
    ld = 'link.exe';

    // TODO(indutny): clang on windows? No way?!
    main.declare('cl_ia32', 'cl.exe');
    main.declare('cl_x64', 'cl.exe');
    main.declare('ml_ia32', 'ml.exe');
    main.declare('ml_x64', 'ml64.exe');
    main.declare('mt', 'mt.exe');

    let arch = this.params.target_arch || 'ia32';

    cc = `$cl_${arch}`;
    cxx = `$cl_${arch}`;
    main.declare('asm', `$ml_${arch}`);
  } else {
    cc = 'gcc';
    cxx = 'g++';
  }
  main.declare('cc', env.CC || cc);
  main.declare('cxx', env.CXX || cxx);
  main.declare('ld', env.CC || ld || cc);
  main.declare('ldxx', env.CXX || ld || cxx);
  main.declare('ar', env.AR || ar);

  main.sectionEnd('variables');
};

NinjaMain.prototype.rulesAndTargets = function rulesAndTargets() {
  const main = this.n;

  main.section('rules');

  main.pool('link_pool', {
    depth: 4
  });

  let useCxx = false;
  const ninjas = this.ninjas;
  const ninjaList = this.targetList.map((target, index) => {
    const ninja = new Ninja({
      index: index,
      outDir: this.configDir,
      target: target,
      targetDict: this.targetDicts[target].configurations[this.config],
      ninjas: ninjas,
      config: this.config
    });
    ninjas[target] = ninja;
    return ninja;
  });

  const ninjaFiles = ninjaList.map((ninja) => {
    const res = ninja.generate();
    useCxx = useCxx || ninja.useCxx;
    return path.relative(this.configDir, res);
  });

  if (process.platform === 'win32') {
    this.options.generator_flags && this.options.generator_flags.output_dir ||
    gyp.platform.win.ninjaRules(main, this.configDir, this.params);
  } else {
    gyp.platform.unix.ninjaRules(main, useCxx);
  }

  main.sectionEnd('rules');

  main.section('targets');
  ninjaFiles.forEach(file => main.subninja(file));
  main.sectionEnd('targets');
};

NinjaMain.prototype.defaults = function defaults() {
  const main = this.n;
  const ninjas = this.ninjas;

  main.section('defaults');
  const defaults = new Set();

  function populateDefaults(ninja) {
    const out = ninja.output();
    if (!Array.isArray(out))
      defaults.add(out);
    else
      out.forEach(o => defaults.add(o));
  }

  this.params.build_files.forEach((buildFile) => {
    this.targetList.forEach((target) => {
      const targetBuildFile =
          gyp.common.parseQualifiedTarget(target)[0];
      if (targetBuildFile !== buildFile)
        return;

      populateDefaults(ninjas[target]);
      (this.targetDicts[target].dependencies || []).forEach((dep) => {
        populateDefaults(ninjas[dep]);
      });
    });
  });

  main.def('all', Array.from(defaults).sort());
  main.sectionEnd('defaults');

  main.finalize();
};

exports.generateOutput = function generateOutput(targetList, targetDicts, data,
                                                 params) {
  if (targetList.length === 0)
    throw new Error('No targets to build!');

  const configs = Object.keys(targetDicts[targetList[0]].configurations);

  configs.forEach((config) => {
    const main = new NinjaMain(targetList, targetDicts, data, params, config);
    main.generate();
  });
};

exports.performBuild = function performBuild() {
  throw new Error('Not implemented');
};
