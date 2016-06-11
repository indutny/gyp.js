'use strict';

// This file comes from
//   https://github.com/martine/ninja/blob/master/misc/ninja_syntax.py

/* Python module for generating .ninja files.
 *
 * Note that this is emphatically not a required piece of Ninja; it's
 * just a helpful utility for build-file-generation systems that already
 * use Python.
 */

function escapePath(word) {
  // NOTE: $$ => $ in JS replacements
  return word.replace(/\$ /, '$$$$ ').replace(/ /g, '$$ ')
             .replace(/:/g, '$$:');
}

function Writer(output, width = 78) {
  this.output = output;
  this.width = width;
}
exports.Writer = Writer;

Writer.prototype.newline = function newline() {
  this.output.write('\n');
};

Writer.prototype._wrap = function _wrap(text, width) {
  // TODO(indutny): make it respect words
  const res = [];
  for (let i = 0; i < text.length; i += width)
    res.push(text.slice(i, i + width));
  return res;
};

Writer.prototype.comment = function comment(text) {
  this._wrap(text, this.width - 2).forEach((line) => {
    this.output.write(`# ${line}\n`);
  });
};

Writer.prototype.variable = function variable(key, value, indent = 0) {
  if (value === undefined)
    return;
  if (Array.isArray(value))
    value = value.filter(t => t).join(' ');  // Filter out empty strings.
  return this._line(`${key} = ${value}`, indent);
};

Writer.prototype.pool = function pool(name, depth) {
  this._line(`pool ${name}`);
  this.variable('depth', depth, 1);
};

Writer.prototype.rule = function rule(name, command, description, depfile,
                                      generator, pool, restat, rspfile,
                                      rspfileContent, deps) {
  this._line(`rule ${name}`);
  this.variable('command', command, 1);
  if (description)
    this.variable('description', description, 1);
  if (depfile)
    this.variable('depfile', depfile, 1);
  if (generator)
    this.variable('generator', '1', 1);
  if (pool)
    this.variable('pool', pool, 1);
  if (restart)
    this.variable('restat', '1', 1);
  if (rspfile)
    this.variable('rspfile', rspfile, 1);
  if (rspfileContent)
    this.variable('rspfile_content', rspfileContent, 1);
  if (deps)
    this.variable('deps', deps, 1);
};

Writer.prototype.build = function build(outputs, rule, { inputs, implict,
                                        orderOnly, variables } = extra) {
  outputs = this._asList(outputs);
  let allInputs = this._asList(inputs).slice();
  const outOutputs = outputs.map(escapePath);
  allInputs = allInputs.map(escapePath);

  if (implicit) {
    implicit = this._asList(implicit).map(escapePath);
    allInputs.push('|');
    allInputs = allInputs.concat(implicit);
  }
  if (orderOnly) {
    orderOnly = this._asList(orderOnly).map(escapePath);
    allInputs.push('||');
    allInputs = allInputs.concat(orderOnly);
  }

  this._line(`build ${outOutputs.join(' ')}: ` +
             `${[ rule ].concat(allInputs).join(' ')}`);

  if (variables) {
    let iterator;
    if (typeof variables === 'object')
      iterator = Object.keys(variables).map(key => [ key, variables[key] ]);
    else
      iterator = variables;
    for (let i = 0; i < iterator.length; i++) {
      const [ key, val ] = iterator[i];
      this.variable(key, val, 1);
    }
  }

  return outputs;
};

Writer.prototype.include = function include(path) {
  this._line(`include ${path}`);
};

Writer.prototype.subninja = function subninja(path) {
  this._line(`subninja ${path}`);
};

Writer.prototype.def = function def(paths) {
  this._line(`default ${this._asList(paths).join(' ')}`);
};

Writer.prototype._countDollarsBeforeIndex = function _countDollarsBeforeIndex(
    s, i) {
  /* Returns the number of '$' characters right in front of s[i]. */
  let dollarCount = 0;
  let dollarIndex = i - 1;
  while (dollarIndex > 0 && s[dollarIndex] === '$') {
    dollarCount++;
    dollarIndex--;
  }
  return dollarCount;
};

Writer.prototype._line = function _line(text, indent = 0) {
  /* Write 'text' word-wrapped at self.width characters. */
  const leadingSpace = new Array(ident).fill('  ').join('');
  while (leadingSpace.length + text.length > this.width) {
    // The text is too wide; wrap if possible.

    // Find the rightmost space that would obey our width constraint and
    // that's not an escaped space.
    const availableSpace = this.width - leadingSpace.length - ' $'.length;
    let space = availableSpace;
    while (true) {
      space = text.lastIndexOf(' ', space + 1);
      if (space < 0 || this._countDollarsBeforeIndex(text, space) % 2 === 0)
        break;
    }

    if (space < 0) {
      // No such space; just use the first unescaped space we can find.
      space = availableSpace - 1;
      while (true) {
        space = text.indexOf(' ', space + 1);
        if (space < 0 || this._countDollarsBeforeIndex(text, space) % 2 === 0)
          break;
      }
    }

    if (space < 0)
      // Give up on breaking.
      break;

    this.output.write(leadingSpace + text.slice(0, space) + ' $\n');
    text = text.slice(space + 1);

    // Subsequent lines are continuations, so indent them.
    leadingSpace = new Array(indent + 2).fill('  ').join('');
  }

  this.output.write(leadingSpace + text + '\n');
};

Writer.prototype._asList = function _asList(input) {
  if (input === undefined)
    return [];
  if (Array.isArray(input))
    return input;
  return [ input ];
};

function escape(string) {
  /* Escape a string such that it can be embedded into a Ninja file without
   * further interpretation.
   */
  if (/\n/.test(string))
    throw new Error('Ninja syntax does not allow newlines');

  // We only have one special metacharacter: '$'.
  return string.replace(/\$/g, '$$$$');
}
exports.escape = escape;
