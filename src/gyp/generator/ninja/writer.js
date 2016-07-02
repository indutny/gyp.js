'use strict';

const gyp = require('../../../gyp');
const fs = gyp.bindings.fs;
const path = gyp.bindings.path;
const mkdirpSync = gyp.bindings.fs.mkdirpSync;

function Writer(filename) {
  this.filename = filename;
  this.contents = '';
  this.width = 78;
}
module.exports = Writer;

Writer.prototype.line = function line(text) {
  const pad = '    ';

  let w = this.width;
  while (text.length > w) {
    let i;
    for (i = w; i > 0; i--) {
      if (text[i] !== ' ')
        continue;

      if (w === this.width)
        w -= pad.length;
      else
        this.contents += pad;
      this.contents += text.slice(0, i) + ' $\n';
      text = text.slice(i + 1);
      break;
    }

    if (i > 0)
      continue;

    for (i = w + 1; i < text.length; i++) {
      if (text[i] !== ' ')
        continue;

      if (w === this.width)
        w -= pad.length;
      else
        this.contents += pad;
      this.contents += text.slice(0, i) + ' $\n';
      text = text.slice(i + 1);
      break;
    }

    if (i >= text.length)
      break;
  }
  if (w !== this.width)
    this.contents += pad;
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
  return value.replace(/[\$ :]/g,'$$$&');
};

Writer.prototype.declare = function declare(name, value) {
  this.line(`${name} = ${value}`);
};

Writer.prototype._dict = function _dict(kind, name, options) {
  this.line(`${kind} ${name}`);
  Object.keys(options).forEach((key) => {
    if (options[key] !== undefined && String(options[key]))
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

  if (options && options.implicitDeps && options.implicitDeps.length !== 0)
    line += ` | ${options.implicitDeps.map(this.escape).join(' ')}`;
  if (options && options.orderOnlyDeps && options.orderOnlyDeps.length !== 0)
    line += ` || ${options.orderOnlyDeps.map(this.escape).join(' ')}`;

  this.line(line);
  if (!options)
    return;
  Object.keys(options).forEach((key) => {
    if (key === 'implicitDeps' || key === 'orderOnlyDeps')
      return;
    if (options[key] !== undefined && String(options[key]))
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
  mkdirpSync(path.dirname(this.filename));
  fs.writeFileSync(this.filename, this.contents.trim() + '\n');
};
