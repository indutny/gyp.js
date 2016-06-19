'use strict';

function Base(str) {
  this.str = str;
  this.off = 0;
}

Base.prototype.pos = function pos() {
  const lines = this.str.split(/(\r\n|\r|\n)/g);
  let lineNum = 1;
  let columnNum = 0;
  let off = 0;
  lines.every((line, i) => {
    const nextOff = off + line.length;
    if (nextOff <= this.off) {
      off = nextOff;
      return true;
    }

    lineNum = (i >>> 1) + 1;
    columnNum = this.off - off;
    return false;
  });

  return `${lineNum}:${columnNum}`;
};
exports.Base = Base;

const SPACE = /\s/;

Base.prototype.emptySpace = function emptySpace() {
  const start = this.off;
  while (SPACE.test(this.str[this.off]))
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

  const c = this.peek().charCodeAt(0);
  if (c === 0x7b /* '{' */)
    res = this.parseObject();
  else if (c === 0x5b /* '[' */)
    res = this.parseArray();
  else if (c === 0x27 /* '\'' */ || c === 0x22 /* '"' */)
    res = this.parseString();
  else if (c === 0x2d /* '-' */ || 0x30 <= c && c <= 0x39)
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
      if (n === 'n') {
        res += '\n';
      } else if (n === 'r') {
        res += '\r';
      } else if (n === 't') {
        res += '\t';
      } else if (n === 'b') {
        res += '\b';
      } else if (n === 'f') {
        res += '\f';
      } else if (n === 'v') {
        res += '\v';
      } else if (n === '\r' && this.peek() === '\n') {
        // Windows-style newlines
        this.skip();
        res += '\r\n';
      } else {
        res += n;
      }
    } else if (c === q) {
      break;
    } else if (c === '\r' || c === '\n') {
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
exports.parseJSON = parseJSON;

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
    '^(?:' +
    '((?:not\\s+in|in|is not|is)(?=\\s|$)|==|!=|>=|<=|>|<)|' +  // priority 1
    '(not)|' +  // priority 2, XXX(indutny): it is a prefix!!!
    '(and)|' +  // priority 3
    '(or)' +  // priority 4
    ')');

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

    // .split()
    if (this.peek() === '.') {
      seed = this.parseMethod(seed);
      this.space();
    }

    // exp <op> exp
    const parsed = this.parseOp(priority);
    const op = parsed.op;
    if (!op)
      break;

    this.space();

    const right = this.parseOne(parsed.nextPriority);

    seed = { type: 'Binary', op: op, left: seed, right: right };
  }

  this.space();

  return seed;
};

Condition.prototype.parseUnary = function parseUnary(priority) {
  // <op> exp
  const parsed = this.parseOp(priority);
  const op = parsed.op;
  if (!op || op !== 'not')
    return this.parseIdOrLiteral();

  this.space();
  const nextPriority = parsed.nextPriority;
  return { type: 'Unary', op: op, argument: this.parseOne(nextPriority) };
};

Condition.prototype.parseIdOrLiteral = function parseOrLiteral() {
  const c = this.peek().charCodeAt(0);
  if (c === 0x7b /* '{' */)
    return { type: 'ObjectLiteral', value: this.parseObject() };
  else if (c === 0x5b /* '[' */)
    return { type: 'ArrayLiteral', value: this.parseArray() };
  else if (c === 0x27 /* '\'' */ || c === 0x22 /* '"' */ )
    return { type: 'Literal', value: this.parseString() };
  else if (c === 0x2d /* '-' */ || 0x30 <= c && c <= 0x39)
    return { type: 'Literal', value: this.parseNumber() };
  else if (0x61 <= c && c <= 0x7a /* a-z */ ||
           0x41 <= c && c <= 0x5a /* A-Z */ ||
           c === 0x5f /* '_' */) {
    return this.parseIdentifier();
  } else if (c === 0x28 /* '(' */)
    return this.parseTuple();
  else
    throw new Error(`Unexpected char ${c} at ${this.pos()}`);
};

Condition.prototype.parseMethod = function parseMethod(seed) {
  this.skip();
  this.space();
  const method = this.parseIdentifier();
  this.space();
  this.expect('(');
  this.space();
  this.expect(')');
  if (method.name !== 'split')
    throw new Error('`.split()` is the only supported method');

  return {
    type: 'Unary',
    op: 'split',
    argument: seed
  };
};

const ID_FIRST_LETTER = /[a-zA-Z_]/;
const ID_LETTER = /[\w_]/;

Condition.prototype.parseIdentifier = function parseIdentifier() {
  let res = this.skip();
  if (!ID_FIRST_LETTER.test(res))
    throw new Error('Invalid first character in Identifier');

  while (!this.ended()) {
    const c = this.peek();
    if (!ID_LETTER.test(c))
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
  else if (ast.type === 'Unary')
    return this.unary(ast);
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

const UNARY_SPACE = /\s+/g;

Interpreter.prototype.unary = function unary(ast) {
  const op = ast.op;
  const arg = this.run(ast.argument);

  if (op === 'split')
    return arg.split(UNARY_SPACE);

  throw new Error(`Unsupported unary op "${op}"`);
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
