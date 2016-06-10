'use strict';

function GYPJSON(str) {
  this.str = str;
  this.off = 0;
}

GYPJSON.prototype.parse = function parse() {
  const res = this.parseOne();
  if (!this.ended())
    throw new Error(`Expected EOF, but found ${this.peek()}`);
  return res;
};

GYPJSON.prototype.pos = function pos() {
  const lines = this.str.split(/[\r\n]/g);
  let lineNum = 1;
  let columnNum = 0;
  let off = 0;
  lines.every((line, i) => {
    const nextOff = off + line.length + 1;
    if (nextOff <= this.off) {
      off = nextOff;
      return true;
    }

    lineNum = i + 1;
    columnNum = this.off - off + 1;
    return false;
  });

  return `${lineNum}:${columnNum}`;
};

GYPJSON.prototype.emptySpace = function emptySpace() {
  const start = this.off;
  while (/\s/.test(this.str[this.off]))
    this.off++;
  return this.off !== start;
};

GYPJSON.prototype.comment = function comment() {
  if (this.peek() !== '#')
    return false;

  this.skip();
  while (this.skip() !== '\n') {
    // no-op
  }
  return true;
};

GYPJSON.prototype.space = function space() {
  let change;
  do {
    change = this.emptySpace();
    change |= this.comment();
  } while (change);
};

GYPJSON.prototype.peek = function peek() {
  return this.str[this.off];
};

GYPJSON.prototype.ended = function ended() {
  return this.off >= this.str.length;
};

GYPJSON.prototype.skip = function skip() {
  if (this.ended())
    throw new Error('Unexpected end');
  return this.str[this.off++];
};

GYPJSON.prototype.expect = function expect(c) {
  const a = this.peek();
  if (a !== c)
    throw new Error(`Expected char: ${c}, but found ${a} at ${this.pos()}`);
  this.off++;
};

GYPJSON.prototype.parseOne = function parseOne() {
  let res;

  this.space();

  const c = this.peek();
  if (c === '{')
    res = this.parseObject();
  else if (c === '[')
    res = this.parseArray();
  else if (c === '"' || c === '\'')
    res = this.parseString();
  else if (c === '-' || 0x30 <= c.charCodeAt(0) && c.charCodeAt(0) <= 0x39)
    res = this.parseNumber();
  else
    throw new Error(`Unexpected char: ${c} at ${this.pos()}`);

  this.space();

  return res;
};

GYPJSON.prototype.parseObject = function parseObject() {
  const res = {};

  this.expect('{');
  this.space();
  if (this.peek() === '}') {
    this.skip();
    return res;
  }

  for (;;) {
    const key = this.parseString();
    this.space();
    this.expect(':');
    this.space();
    const value = this.parseOne();
    this.space();

    res[key] = value;

    const n = this.peek();
    if (n === ',') {
      this.skip();
      this.space();
    } else {
      this.expect('}');
      break;
    }

    // `,}`
    if (this.peek() === '}') {
      this.skip();
      return res;
    }
  }

  return res;
};

GYPJSON.prototype.parseString = function parseString() {
  const q = this.peek();
  if (q !== '"' && q !== '\'')
    throw new Error(`Expected ' or ", but found ${q} at ${this.pos()}`);
  this.skip();

  // TODO(indutny): optimize it with slices
  let res = '';
  for (;;) {
    const c = this.skip();
    if (c === q)
      break;

    if (c === '\\') {
      const n = this.skip();
      if (n === 'n')
        res += '\n';
      else if (n === 'r')
        res += '\r';
      else if (n === 't')
        res += '\t';
      else if (n === 'b')
        res += '\b';
      else if (n === 'f')
        res += '\f';
      else if (n === 'v')
        res += '\v';
      else
        res += n;
    } else if (c === q) {
      break;
    } else if (c === '\r' || c == '\n') {
      throw new Error(`Unexpected newline in a string at ${this.pos()}`);
    } else {
      res += c;
    }
  }

  return res;
};

GYPJSON.prototype.parseArray = function parseArray() {
  const res = [];

  this.expect('[');
  this.space();

  if (this.peek() === ']') {
    this.skip();
    return res;
  }

  for (;;) {
    res.push(this.parseOne());
    this.space();

    const n = this.peek();
    if (n === ',') {
      this.skip();
      this.space();
    } else {
      this.expect(']');
      break;
    }

    // `,]`
    if (this.peek() === ']') {
      this.skip();
      return res;
    }
  }

  return res;
};

GYPJSON.prototype.parseNumber = function parseNumber() {
  let res = '';
  while (!this.ended()) {
    const c = this.peek();
    if (!/[\d+\-\.e]/i.test(c))
      break;
    this.skip();
    res += c;
  }
  return JSON.parse(res);
};

function parseJSON(contents) {
  const g = new GYPJSON(contents);
  return g.parse(contents);
}
exports.parseJSON = parseJSON

function checkedParseJSON(contents) {
  /* Return the eval of a gyp file.
   *
   * The gyp file is restricted to dictionaries and lists only, and
   * repeated keys are not allowed.
   *
   * Note that this is slower than eval() is.
   */
  // TODO(indutny): enforce text above
  return parseJSON(contents);
}
exports.checkedParseJSON = checkedParseJSON;

function compileCondition(contents) {
  throw new Error('Not implemented');
}
exports.compileCondition = compileCondition;
