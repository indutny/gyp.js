'use strict';

function Base(str) {
  this.str = str;
  this.off = 0;
}

Base.prototype.pos = function pos() {
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

Base.prototype.emptySpace = function emptySpace() {
  const start = this.off;
  while (/\s/.test(this.str[this.off]))
    this.off++;
  return this.off !== start;
};

Base.prototype.peek = function peek() {
  return this.str[this.off];
};

Base.prototype.ended = function ended() {
  return this.off >= this.str.length;
};

Base.prototype.skip = function skip() {
  if (this.ended())
    throw new Error('Unexpected end');
  return this.str[this.off++];
};

Base.prototype.expect = function expect(c) {
  const a = this.peek();
  if (a !== c)
    throw new Error(`Expected char: ${c}, but found ${a} at ${this.pos()}`);
  this.off++;
};

Base.prototype.parse = function parse() {
  let res;
  try {
    res = this.parseOne();
  } catch (e) {
    // Reduce the error stack
    throw new Error(e.message);
  }
  if (!this.ended())
    throw new Error(`Expected EOF, but found ${this.peek()}`);
  return res;
};

function GYPJSON(str) {
  Base.call(this, str);
}
GYPJSON.prototype = Object.create(Base.prototype);

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

  this.space();

  // '123' '123'
  if (this.peek() === '\'' || this.peek() === '"')
    res += this.parseString();

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

// Precendence
const MAX_PRIORITY = 4;

// NOTE: This is only a small subset, but should be enough
// TODO(indutny): consider expanding this, if needed
const PRIORITY_RE = new RegExp(
    `^(?:` +
    `((?:not\\s+in|in|is not|is)(?=\\s|$)|==|!=|>=|<=|>|<)|` +  // priority 1
    `(not)|` +  // priority 2, XXX(indutny): it is a prefix!!!
    `(and)|` +  // priority 3
    `(or)` +  // priority 4
    `)`);

function Condition(str) {
  GYPJSON.call(this, str);
}
Condition.prototype = Object.create(GYPJSON.prototype);

Condition.prototype.parseOne = function parseOne(priority) {
  if (!priority)
    priority = MAX_PRIORITY;
  this.space();

  let seed = this.parseUnary(priority);

  while (!this.ended()) {
    this.space();

    // exp <op> exp
    const { op, nextPriority } = this.parseOp(priority);
    if (!op)
      break;

    this.space();

    const right = this.parseOne(nextPriority);

    seed = { type: 'Binary', op: op, left: seed, right: right };
  }

  this.space();

  return seed;
};

Condition.prototype.parseUnary = function parseUnary(priority) {
  // <op> exp
  const { op, nextPriority } = this.parseOp(priority);
  if (!op || op !== 'not')
    return this.parseIdOrLiteral();

  this.space();
  return { type: 'Unary', op: op, argument: this.parseOne(nextPriority) };
};

Condition.prototype.parseIdOrLiteral = function parseOrLiteral() {
  const c = this.peek();
  if (c === '{')
    return { type: 'ObjectLiteral', value: this.parseObject() };
  else if (c === '[')
    return { type: 'ArrayLiteral', value: this.parseArray() };
  else if (c === '\'' || c === '"')
    return { type: 'Literal', value: this.parseString() };
  else if (c === '-' || 0x30 <= c.charCodeAt(0) && c.charCodeAt(0) <= 0x39)
    return { type: 'Literal', value: this.parseNumber() };
  else if (/[a-zA-Z_]/.test(c))
    return this.parseIdentifier();
  else if (c === '(')
    return this.parseTuple();
  else
    throw new Error(`Unexpected char ${c} at ${this.pos()}`);
};

Condition.prototype.parseIdentifier = function parseIdentifier() {
  let res = this.skip();
  while (!this.ended()) {
    const c = this.peek();
    if (!/[\w_]/.test(c))
      break;
    this.skip();
    res += c;
  }
  return { type: 'Identifier', name: res };
};

Condition.prototype.parseTuple = function parseTuple() {
  const res = [];

  this.expect('(');
  this.space();

  for (;;) {
    res.push(this.parseOne(MAX_PRIORITY));

    if (this.peek() === ',') {
      this.skip();
      continue;
    } else {
      this.expect(')');
      break;
    }
  }

  if (res.length === 1)
    return res[0];

  return { type: 'Tuple', values: res };
};

Condition.prototype.parseOp = function parseOp(priority) {
  const part = this.str.slice(this.off);
  const match = part.match(PRIORITY_RE);
  if (match === null)
    return false;

  let nextPriority = 0;
  for (let i = priority; i >= 1; i--) {
    if (match[i] !== undefined) {
      nextPriority = i;
      break;
    }
  }
  if (nextPriority === 0)
    return false;

  this.off += match[nextPriority].length;

  return { op: match[nextPriority], nextPriority: nextPriority };
};

function parseCondition(contents) {
  const c = new Condition(contents);
  return c.parse();
}
exports.parseCondition = parseCondition;

function Interpreter(scope) {
  this.scope = scope;
}

Interpreter.prototype.run = function run(ast) {
  if (ast.type === 'Identifier')
    return this.load(ast);
  else if (ast.type === 'Literal')
    return ast.value;
  else if (ast.type === 'ObjectLiteral')
    return this.object(ast);
  else if (ast.type === 'ArrayLiteral')
    return this.array(ast);
  else if (ast.type === 'Tuple')
    return this.tuple(ast);
  else if (ast.type === 'Binary')
    return this.binary(ast);
  else
    throw new Error(`Unknown AST node type: ${ast.type}`);
};

Interpreter.prototype.load = function load(id) {
  if (!this.scope.hasOwnProperty(id.name))
    throw new Error(`Undefined variable ${id.name}`);
  return this.scope[id.name];
};

Interpreter.prototype.tuple = function tuple(ast) {
  return ast.values.map(value => this.run(value));
};

Interpreter.prototype.object = function object(ast) {
  const res = {};
  Object.keys(ast.value).forEach(key => res[key] = this.run(ast.value[key]));
  return res;
};

Interpreter.prototype.array = function array(ast) {
  return ast.value.map(value => this.run(value));
};

Interpreter.prototype.binary = function binary(ast) {
  const op = ast.op;
  const left = this.run(ast.left);

  // Lazy evaluation for logic
  if (op === 'and' && !left)
    return left;
  else if (op === 'or' && left)
    return left;

  const right = this.run(ast.right);

  if (op === '==')
    return left === right;
  else if (op === '!=')
    return left !== right;
  else if (op === '>=')
    return left >= right;
  else if (op === '<=')
    return left <= right;
  else if (op === '>')
    return left > right;
  else if (op === '<')
    return left < right;
  else if (op === 'in')
    return right.indexOf(left) !== -1;
  else if (op === 'not in')
    return right.indexOf(left) === -1;
  else if (op === 'and')
    return right;
  else if (op === 'or')
    return right;

  throw new Error(`Unsupported binary op "${op}"`);
};

exports.interpret = function interpret(ast, scope) {
  const i = new Interpreter(scope);
  try {
    return i.run(ast);
  } catch (e) {
    // Strip `stack`
    throw new Error(e.message);
  }
};

function compileCondition(contents) {
  const ast = parseCondition(contents);

  return function(scope) {
    return exports.interpret(ast, scope);
  };
}
exports.compileCondition = compileCondition;
