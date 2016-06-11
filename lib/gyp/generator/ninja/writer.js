'use strict';

const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');

function Writer(filename) {
  this.filename = filename;
  this.contents = '';
}
module.exports = Writer;

Writer.prototype.line = function line(text) {
  // TODO(indutny): wrap
  this.contents += text + '\n';
};

Writer.prototype.section = function section(name) {
  this.line('');
  this.line('#');
  this.line(`# ${name} start`);
  this.line('#');
  this.line('');
};

Writer.prototype.sectionEnd = function sectionEnd(name) {
  this.line('');
  this.line('#');
  this.line(`# ${name} end`);
  this.line('#');
  this.line('');
};

Writer.prototype.escape = function escape(value) {
  // NOTE: $$ => $ in RegExp replacement
  return value.replace(/\$/g, '$$$$');
};

Writer.prototype.declare = function declare(name, value) {
  this.line(`${name} = ${value}`);
};

Writer.prototype._dict = function _dict(kind, name, options) {
  this.line(`${kind} ${name}`);
  Object.keys(options).forEach((key) => {
    this.line(`  ${key} = ${options[key]}`);
  });
};

Writer.prototype.pool = function pool(name, options) {
  this._dict('pool', name, options);
};

Writer.prototype.rule = function rule(name, options) {
  this._dict('rule', name, options);
};

Writer.prototype.build = function build(rule, outputs, inputs, options) {
  outputs = outputs.map(this.escape).join(' ');
  inputs = inputs.map(this.escape).join(' ');
  let line = `build ${outputs}: ${rule} ${inputs}`;

  if (options && options.orderOnlyDeps && options.orderOnlyDeps.length !== 0)
    line += ` || ${options.orderOnlyDeps.map(this.escape).join(' ')}`;

  this.line(line);
  if (!options)
    return;
  Object.keys(options).forEach((key) => {
    if (key !== 'orderOnlyDeps')
      this.line(`  ${key} = ${options[key]}`);
  });
};

Writer.prototype.subninja = function subninja(filename) {
  this.line(`subninja ${this.escape(filename)}`);
};

Writer.prototype.def = function def(name, targets) {
  this.line(`build ${name}: phony ${targets.map(this.escape).join(' ')}`);
  this.line(`default ${name}`);
};

Writer.prototype.finalize = function finalize() {
  mkdirp.sync(path.dirname(this.filename));
  fs.writeFileSync(this.filename, this.contents.trim() + '\n');
};
