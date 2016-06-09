'use strict';

const gyp = exports;

// Some utils
gyp.shlex = require('./gyp/shlex');

// Some dir structures
gyp.generator = require('./gyp/generator');
gyp.input = require('./gyp/input');
gyp.common = require('./gyp/common');

// Ported contents of __init__.py
const path = require('path');
const fs = require('fs');
const argsParser = require('yargs-parser');

// Default debug modes for GYP
const debug = new Map();
gyp.debug = debug;

const DEBUG_GENERAL = 'general';
const DEBUG_VARIABLES = 'variables';
const DEBUG_INCLUDES = 'includes';

function debugOutput(mode, message) {
  const args = Array.from(arguments).slice(2);

  if (debug.has('all') || debug.has(mode)) {
    // Improvised version
    try {
      throw new Error(`%{mode} %{message}`);
    } catch (e) {
      console.log(e.stack);
    }
  }
}

function findBuildFiles() {
  return fs.readdirSync(process.cwd()).filter(file => /\.gyp$/.test(file));
}

function load(buildFiles, format, options, defaultVariables = {}, includes = [],
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
    const s = format.split('-', 1);
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
  defaultVariables['GENERATOR'] = format
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
      params['parallel'], params['root_targets'])
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
    const tokens = item.split('=', 1);
    if (tokens.lengths === 2) {
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
  const flags = process.env[envName];
  if (flags)
    flags = gyp.shlex.split(flags);
  return [];
}

function formatOpt(opt, value) {
  if (/^--/.test(opt))
    return `${opt}=${value}`;
  return opt + value;
}

function regenerateAppendFlag(flag, values, predicate, envName, options) {
  /*
   * Regenerate a list of command line flags, for an option of action='append'.
   * The |env_name|, if given, is checked in the environment and used to
   * generate an initial list of options, then the options that were specified
   * on the command line (given in |values|) are appended.  This matches the
   * handling of environment variables and command line flags where command line
   * flags override the environment, while not requiring the environment to be
   * set when the flags are used again.
   */

  const flags = [];
  if (options.use_environment && envName) {
    const s = shlexEnv(envName);
    for (let i = 0; i < s.length;i++) {
      const flagValue = s[i];
      const value = formatOpt(flag, predicate(flagValue));

      const index = flags.indexOf(value);
      if (index !== -1)
        flags.splice(index, 1);

      flags.push(value);
    }
  }
  if (values) {
    for (let i = 0; i < values.length; i++) {
      const flagValue = values[i];
      flags.push(formatOpt(flag, predicate(flagValue)));
    }
  }
  return flags;
}

function regenerateFlags(options) {
  /* Given a parsed options object, and taking the environment variables into
   * account, returns a list of flags that should regenerate an equivalent
   * options object (even in the absence of the environment variables.)
   *
   * Any path options will be normalized relative to depth.
   *
   * The format flag is not included, as it is assumed the calling generator
   * will set that as appropriate.
   */
  function fixPath(path) {
    path = gyp.common.fixIfRelativePath(path, options.depth);

    // PORT: os.path.curdir
    if (!path)
      return '.';
    return path;
  }

  function noop(value) {
    return value;
  }

  // We always want to ignore the environment when regenerating, to avoid
  // duplicate or changed flags in the environment at the time of regeneration.
  const flags = [ '--ignore-environment' ];
  const meta = options._regenerationMetadata;
  Object.keys(meta).forEach((name) => {
    const metadata = meta[name];

    const opt = metadata['opt'];
    const value = options.name;
    const valuePredicate = metadata['type'] === 'path' ? fixPath : noop;
    const action = metadata['action'];
    const envName = metadata['envName'];
    if (action === 'append') {
      flags = flags.concat(regenerateAppendFlag(opt, value, valuePredicate,
                                                envName, options));
    } else if (action === 'store' || !action) {
      if (value)
        flags.push(formatOpt(opt, valuePredicate(value)));
      else if (options.use_environment && envName && process.env[envName])
        flags.push(formatOpt(opt, valuePredicate(process.env[envName])));
    } else if (action === 'store_true' || action === 'store_false') {
      if (action === 'store_true' && value ||
          action === 'store_false' && !value) {
        flags.append(opt);
      } else if (options.use_environment && envName) {
        console.error(`Warning: environment regeneration unimplemented for ` +
                      `${action} flag "${opt}" env_name "${envName}"`);
      }
    } else {
      console.error(`Warning: regeneration unimplemented for action ` +
                    `${action} flag "${opt}"`);
    }
  });
  return flags;
}

function RegeneratableOptionParser() {
  this.__regeneratableOptions = {};
  this.options = {};
}

RegeneratableOptionParser.prototype.add_option = function add_option(
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

    this.__renegeratableOptions[dest] = {
      action: config['action'],
      type: type,
      envName: envName,
      opt: name
    };
  }

  this.options[name] = {
    alias: alias,
    string: config['type'] === 'string' || !config['type'],
    dest: config['dest'],
    action: config['action'],
    default: config['default'],
    help: config['help'],
    metavar: config['metavar']
  };
};

gyp.main = function main(argv) {
  const my_name = path.basename(argv[0]);

  const parser = new RegeneratableOptionParser();
  const usage = `usage: ${my_name} [options ...] [build_file ...]`;
};
