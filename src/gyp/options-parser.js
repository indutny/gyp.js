'use strict';

const argsParser = require('yargs-parser');

const gyp = require('../gyp');

function OptionsParser() {
  this.options = {};
  this.letters = {};
  this.yargs = { alias: { 'help': [ 'h' ] }, boolean: [] };
  this.usage = '';
  this.__regeneratableOptions = {};
}
module.exports = OptionsParser;

OptionsParser.prototype.addOption = function addOption(name, alias, config) {
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

OptionsParser.prototype.setUsage = function setUsage(usage) {
  this.usage = usage;
};

OptionsParser.prototype.printHelp = function printHelp() {
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
  gyp.bindings.process.exit(0);
};

OptionsParser.prototype.parseArgs = function parseArgs(args) {
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
