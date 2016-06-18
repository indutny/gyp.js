'use strict';

const argsParser = require('yargs-parser');
const util = require('util');

const gyp = exports;

// Some utils
gyp.bindings = require('./gyp/bindings');
gyp.shlex = require('./gyp/shlex');
gyp.py = require('./gyp/py');

const path = gyp.bindings.path;
const fs = gyp.bindings.fs;

// Some dir structures
gyp.common = require('./gyp/common');
gyp.platform = require('./gyp/platform');
gyp.generator = require('./gyp/generator');
gyp.input = require('./gyp/input');

// Ported contents of __init__.py

// Default debug modes for GYP
const debug = { general: false, all: false, variables: false, include: false };
gyp.debug = debug;

const DEBUG_GENERAL = 'general';
const DEBUG_VARIABLES = 'variables';
const DEBUG_INCLUDES = 'includes';

gyp.DEBUG_GENERAL = DEBUG_GENERAL;
gyp.DEBUG_VARIABLES = DEBUG_VARIABLES;
gyp.DEBUG_INCLUDES = DEBUG_INCLUDES;

function debugOutput(mode, message) {
  const args = Array.from(arguments).slice(2);

  if (debug['all'] || debug[mode]) {
    // Improvised version
    message = util.format.apply(util, [ message ].concat(args));
    try {
      throw new Error('');
    } catch (e) {
      const prefix = e.stack.split('\n')[2].replace(/^\s*at\s*/g, '');
      gyp.bindings.log(`${mode.toUpperCase()}:${prefix} ${message}`);
    }
  }
}
gyp.debugOutput = debugOutput;

function findBuildFiles(cwd) {
  return fs.readdirSync(cwd).filter(file => /\.gyp$/.test(file));
}

function load(buildFiles, format, defaultVariables = {}, includes = [],
              depth = '.', params, check = false, circularCheck = true,
              duplicateBasenameCheck = true) {
  /*
   * Loads one or more specified build files.
   * defaultVariables and includes will be copied before use.
   * Returns the generator for the specified format and the
   * data returned by loading the specified build files.
   */
  if (!params)
    params = {};

  if (format.indexOf('-')) {
    const s = format.split('-', 2);
    format = s[0];
    params['flavor'] = s[1];
  }

  // PORT: copy.copy()
  defaultVariables = JSON.parse(JSON.stringify(defaultVariables));

  /*
   * Default variables provided by this program and its modules should be
   * named WITH_CAPITAL_LETTERS to provide a distinct "best practice" namespace,
   * avoiding collisions with user and automatic variables.
   */
  defaultVariables['GENERATOR'] = format;
  defaultVariables['GENERATOR_FLAVOR'] = params['flavor'] || '';

  /* Format can be a custom JS file, or by default the name of a module
   * within gyp.generator.
   */

  let generator;
  if (/\.js/.test(format))
    generator = require(format);
  else
    generator = gyp.generator[format];

  /* These parameters are passed in order (as opposed to by key)
   * because ActivePython cannot handle key parameters to __import__.
   */
  Object.keys(generator.generatorDefaultVariables).forEach((key) => {
    const value = generator.generatorDefaultVariables[key];
    if (!defaultVariables[key])
      defaultVariables[key] = value;
  });

  /* Give the generator the opportunity to set additional variables based on
   * the params it will receive in the output phase.
   */
  if (generator.calculateVariables)
    generator.calculateVariables(defaultVariables, params);

  /* Give the generator the opportunity to set generator_input_info based on
   * the params it will receive in the output phase.
   */
  if (generator.calculateGeneratorInputInfo)
    generator.calculateGeneratorInputInfo(params);

  /* Fetch the generator specific info that gets fed to input, we use getattr
   * so we can default things and the generators only have to provide what
   * they need.
   */
  const generatorInputInfo = {
    'non_configuration_keys':
        generator.generatorAdditionalNonConfigurationKeys || [],
    'path_sections': generator.generatorAdditionalPathSections || [],
    'extra_sources_for_rules': generator.generatorExtraSourcesForRules || [],
    'generator_supports_multiple_toolsets':
        generator.generatorSupportsMultipleToolsets || false,
    'generator_wants_static_library_dependencies_adjusted':
        generator.generatorWantsStaticLibraryDependenciesAdjusted || true,
    'generator_wants_sorted_dependencies':
        generator.generatorWantsSortedDependencies || false,
    'generator_filelist_paths': generator.generatorFilelistPaths
  };

  // Process the input specific to this generator.
  const result = gyp.input.load(
      buildFiles, defaultVariables, includes.slice(),
      depth, generatorInputInfo, check, circularCheck,
      duplicateBasenameCheck,
      params['root_targets']);
  return [ generator ].concat(result);
}

function nameValueListToDict(nameValueList) {
  /*
   * Takes an array of strings of the form 'NAME=VALUE' and creates a dictionary
   * of the pairs.  If a string is simply NAME, then the value in the dictionary
   * is set to True.  If VALUE can be converted to an integer, it is.
   */
  const result = {};

  for (let i = 0; i < nameValueList.length; i++) {
    const item = nameValueList[i];
    const tokens = item.split('=', 2);
    if (tokens.length === 2) {
      // If we can make it an int, use that, otherwise, use the string.
      let tokenValue = tokens[1] | 0;
      if (tokenValue.toString() !== tokens[1])
        tokenValue = tokens[1];
      // Set the variable to the supplied value.
      result[tokens[0]] = tokenValue;
    } else {
      // No value supplied, treat it as a boolean and set it.
      result[tokens[0]] = true;
    }
  }
  return result;
}

function shlexEnv(envName) {
  let flags = process.env[envName];
  if (flags)
    flags = gyp.shlex.split(flags);
  return flags || [];
}

function RegeneratableOptionParser() {
  this.options = {};
  this.letters = {};
  this.yargs = { alias: { 'help': [ 'h' ] }, boolean: [] };
  this.usage = '';
  this.__regeneratableOptions = {};
}

RegeneratableOptionParser.prototype.addOption = function addOption(
    name, alias, config) {
  if (typeof alias === 'object') {
    config = alias;
    alias = undefined;
  }

  const envName = config.envName;
  if (config['dest'] && config.regenerate !== false) {
    const dest = config['dest'];

    // The path type is needed for regenerating, for optparse we can just treat
    // it as a string.
    const type = config['type'];
    if (type === 'path')
      config['type'] = 'string';

    this.__regeneratableOptions[dest] = {
      action: config['action'],
      type: type,
      envName: envName,
      opt: name
    };
  }

  if (!this.yargs.alias[name])
    this.yargs.alias[name] = [];
  if (alias)
    this.yargs.alias[name].push(alias);
  if (config['action'] === 'store_true' || config['action'] === 'store_false')
    this.yargs.boolean.push(name);

  this.options[name] = {
    alias: alias,
    dest: config['dest'],
    action: config['action'],
    default: config['default'],
    help: config['help'],
    metavar: config['metavar']
  };

  if (alias && /^[A-Z]$/.test(alias))
    this.letters[alias] = this.options[name];

  if (name && /^[A-Z]$/.test(name))
    this.letters[name] = this.options[name];
};

RegeneratableOptionParser.prototype.setUsage = function setUsage(usage) {
  this.usage = usage;
};

RegeneratableOptionParser.prototype.printHelp = function printHelp() {
  gyp.bindings.error(this.usage);
  let max = 0;

  Object.keys(this.options).forEach((name) => {
    const option = this.options[name];

    let desc = `  --${name}`;
    if (option.alias)
      desc += `, -${option.alias}`;
    max = Math.max(max, desc.length + 4);
  });

  Object.keys(this.options).forEach((name) => {
    const option = this.options[name];

    let desc = `  --${name}`;
    if (option.alias)
      desc += `, -${option.alias}`;

    while (desc.length < max)
      desc += ' ';

    desc += `${option.help}`;
    gyp.bindings.error(desc);
  });
  process.exit(0);
};

RegeneratableOptionParser.prototype.parseArgs = function parseArgs(args) {
  const res = {};

  // Initialize defaults
  Object.keys(this.options).forEach((name) => {
    if (name === 'help')
      return;

    const option = this.options[name];

    if (option.action === 'append' && !option.default)
      res[option.dest] = [];
    else
      res[option.dest] = option.default;
  });

  // parse -Dname=val, -Gname=val
  args = args.filter((arg) => {
    const match = arg.match(/^-([A-Z])(.*)$/);
    if (match === null)
      return true;

    const name = match[1];
    const option = this.letters[name];
    if (!option)
      return false;

    if (option.action !== 'append')
      throw new Error('Invalid letter action');

    res[option.dest].push(match[2]);

    return false;
  });

  // Parse args
  const parsed = argsParser(args, this.yargs);

  if (parsed.help) {
    this.printHelp();
    return;
  }

  Object.keys(parsed).forEach((name) => {
    const option = this.options[name];
    if (!option)
      return;

    const value = parsed[name];
    if (!option) {
      res[name] = value;
      return;
    }

    if (option.action === 'store' || !option.action)
      res[option.dest] = value;
    else if (option.action === 'store_true')
      res[option.dest] = value;
    else if (option.action === 'store_false')
      res[option.dest] = !value;
    else if (option.action === 'append')
      res[option.dest] = res[option.dest].concat(value);
    else
      throw new Error('Unknown action: ' + option.action);
  });

  res._regenerationMetadata = this.__regeneratableOptions;

  return {
    options: res,
    _: parsed._
  };
};

gyp.main = function main(args) {
  const myName = path.basename(args[0]);
  const cwd = process.cwd();

  // TODO(indutny): clean this up, and rewrite args parser
  const parser = new RegeneratableOptionParser();
  const usage = `usage: ${myName} [options ...] [build_file ...]`;
  parser.setUsage(usage);

  parser.addOption('build', { dest: 'configs', action: 'append',
                   help: 'configuration for build after project generation' });
  parser.addOption('check', { dest: 'check', action: 'store_true',
                   help: 'check format of gyp files' });
  parser.addOption('config-dir', { dest: 'config_dir', action: 'store',
                   envName: 'GYP_CONFIG_DIR',
                   help: 'The location of configuration files like ' +
                      'include.gypi.' });
  parser.addOption('debug', 'd', { dest: 'debug', metavar: 'DEBUGMODE',
                   action: 'append', default: [], help: 'turn on debuggin ' +
                       'mode for debugging GYP.  Supported modes are ' +
                       '"variables", "includes" and "general" or "all" for ' +
                       ' all of them.' });
  parser.addOption('D', { dest: 'defines', action: 'append', metavar: 'VAR=VAL',
                   envName: 'GYP_DEFINES',
                   help: 'sets variable VAR to value VAL' });
  parser.addOption('depth', { dest: 'depth', metavar: 'PATH', type: 'path',
                   help: 'set DEPTH gyp variable to a relative path to PATH' });
  parser.addOption('G', { dest: 'generator_flags', action: 'append',
                   default: [], metavar: 'FLAG=VAL',
                   envName: 'GYP_GENERATOR_FLAGS',
                   help: 'sets generator flag FLAG to VAL' });
  parser.addOption('generator-output', { dest: 'generator_output',
                   action: 'store', metavar: 'DIR', type: 'path',
                   envName: 'GYP_GENERATOR_OUTPUT',
                   help: 'puts generated build files under DIR' });
  parser.addOption('ignore-environment', { dest: 'use_environment',
                   action: 'store_false', default: true, regenerate: false,
                   help: 'do not read options from environment variables' });
  parser.addOption('include', 'I', { dest: 'includes', action: 'append',
                   metavar: 'INCLUDE', type: 'path',
                   help: 'files to include in all loaded .gyp files' });

  /* --no-circular-check disables the check for circular relationships between
   * .gyp files.  These relationships should not exist, but they've only been
   * observed to be harmful with the Xcode generator.  Chromium's .gyp files
   * currently have some circular relationships on non-Mac platforms, so this
   * option allows the strict behavior to be used on Macs and the lenient
   * behavior to be used elsewhere.
   * TODO(mark): Remove this option when http://crbug.com/35878 is fixed.
   */
  parser.addOption('no-circular-check', { dest: 'circular_check',
                   action: 'store_false', default: true, regenerate: false,
                   help: 'don\'t check for circular relationships between ' +
                         'files' });

  /* --no-duplicate-basename-check disables the check for duplicate basenames
   * in a static_library/shared_library project. Visual C++ 2008 generator
   * doesn't support this configuration. Libtool on Mac also generates warnings
   * when duplicate basenames are passed into Make generator on Mac.
   * TODO(yukawa): Remove this option when these legacy generators are
   * deprecated.
   */
  parser.addOption('no-duplicate-basename-check', {
    dest: 'duplicate_basename_check', action: 'store_false',
    default: true, regenerate: false,
    help: 'don\'t check for duplicate basenames' });
  parser.addOption('suffix', 'S', { dest: 'suffix', default: '',
                   help: 'suffix to add to generated files' });
  parser.addOption('toplevel-dir', { dest: 'toplevel_dir', action: 'store',
                   metavar: 'DIR', type: 'path',
                   help: 'directory to use as the root of the source tree' });
  parser.addOption('root-target', 'R', { dest: 'root_targets',
                   action: 'append', metavar: 'TARGET',
                   help: 'include only TARGET and its dependencies' });

  const r = parser.parseArgs(args.slice(1));
  const options = r.options;
  const buildFilesArg = r._;
  let buildFiles = buildFilesArg;

  let homeDotGyp;

  // Set up the configuration directory (defaults to ~/.gyp)
  if (!options.config_dir) {
    let home;
    if (options.use_environment) {
      homeDotGyp = process.env['GYP_CONFIG_DIR'];

      // PORT: os.path.expanduser()
      if (homeDotGyp)
        homeDotGyp = path.resolve(homeDotGyp);
    }

    if (!homeDotGyp) {
      const homeVars = [ 'HOME' ];
      if (process.platform === 'win32')
        homeVars.push('USERPROFILE');
      for (let i = 0; i < homeVars.length; i++) {
        const homeVar = homeVars[i];
        home = process.env[homeVar];
        if (home) {
          homeDotGyp = path.join(home, '.gyp');
          if (!fs.existsSync(homeDotGyp))
            homeDotGyp = undefined;
          else
            break;
        }
      }
    }
  } else {
    // PORT: os.path.expanduser()
    homeDotGyp = path.resolve(options.config_dir);
  }

  if (homeDotGyp && !fs.existsSync(homeDotGyp))
    homeDotGyp = undefined;

  if (!options.generator_output && options.use_environment) {
    const g = process.env['GYP_GENERATOR_OUTPUT'];
    if (g)
      options.generator_output = g;
  }

  options.debug.forEach((mode) => {
    gyp.debug[mode] = true;
  });

  // Do an extra check to avoid work when we're not debugging.
  if (gyp.debug[DEBUG_GENERAL]) {
    debugOutput(DEBUG_GENERAL, 'running with these options:');
    Object.keys(options).sort().forEach((option) => {
      const value = options[option];
      if (option[0] === '_')
        return;

      if (typeof value === 'string')
        debugOutput(DEBUG_GENERAL, `  ${option}: '${value}'`);
      else
        debugOutput(DEBUG_GENERAL, `  ${option}: %j`, value);
    });
  }

  if (!buildFiles || !buildFiles.length)
    buildFiles = findBuildFiles(cwd);
  if (!buildFiles || !buildFiles.length)
    throw new Error(usage + `\n\n${myName}: error: no build_file`);

  // If toplevel-dir is not set, we assume that depth is the root of our source
  // tree.
  if (!options.toplevel_dir)
    options.toplevel_dir = options.depth;

  // -D on the command line sets variable defaults - D isn't just for define,
  // it's for default.  Perhaps there should be a way to force (-F?) a
  // variable's value so that it can't be overridden by anything else.
  let defines = [];
  if (options.use_environment)
    defines = defines.concat(shlexEnv('GYP_DEFINES'));
  if (options.defines)
    defines = defines.concat(options.defines);
  const cmdlineDefaultVariables = nameValueListToDict(defines);
  if (gyp.debug[DEBUG_GENERAL]) {
    debugOutput(DEBUG_GENERAL, 'cmdline_default_variables: %j',
                cmdlineDefaultVariables);
  }

  // Set up includes
  let includes = [];

  // If ~/.gyp/include.gypi exists, it'll be forcibly included into every
  // .gyp file that's loaded, before anything else is included.
  if (homeDotGyp) {
    const defaultInclude = path.join(homeDotGyp, 'include.gypi');
    if (fs.existsSync(defaultInclude)) {
      gyp.bindings.log(`Using overrides found in ${defaultInclude}`);
      includes.push(defaultInclude);
    }
  }

  // Command-line --include files come after the default include.
  if (options.includes)
    includes = includes.concat(options.includes);

  // Generator flags should be prefixed with the target generator since they
  // are global across all generator runs.
  let genFlags = [];
  if (options.use_environment)
    genFlags = genFlags.concat(shlexEnv('GYP_GENERATOR_FLAGS'));
  if (options.generator_flags)
    genFlags = genFlags.concat(options.generator_flags);
  options.generator_flags = nameValueListToDict(genFlags);
  if (gyp.debug[DEBUG_GENERAL]) {
    debugOutput(DEBUG_GENERAL,
                'generator flags: %j', options.generator_flags);
  }

  // Generate ninja!
  const params = {
    options: options,
    build_files: buildFiles,
    cwd: cwd,
    build_files_arg: buildFilesArg,
    gyp_binary: args[0],
    home_dot_gyp: homeDotGyp,
    root_targets: options.root_targets,
    target_arch: cmdlineDefaultVariables['target_arch'] || ''
  };

  // Start with the default variables from the command line.
  const [ generator, flatList, targets, data ] = load(buildFiles, 'ninja',
      cmdlineDefaultVariables, includes, options.depth, params, options.check,
      options.circular_check, options.duplicate_basename_check);

  /* TODO(mark): Pass |data| for now because the generator needs a list of
   * build files that came in.  In the future, maybe it should just accept
   * a list, and not the whole data dict.
   * NOTE: flat_list is the flattened dependency graph specifying the order
   * that targets may be built.  Build systems that operate serially or that
   * need to have dependencies defined before dependents reference them should
   * generate targets in the order specified in flat_list.
   */
  generator.generateOutput(flatList, targets, data, params);

  if (options.configs.length !== 0) {
    let validConfigs = targets[flatList[0]]['configurations'];
    for (let i = 0; i < options.configs.length; i++) {
      const conf = options.configs[i];
      if (!validConfigs[conf])
        throw new Error(`Invalid config specified via --build: ${conf}`);
    }
    generator.performBuild(data, options.configs, params);
  }

  return 0;
};
