'use strict';

const shlex = exports;

// TODO(indutny): fix it and improve
shlex.split = function split(str) {
  const res = [];

  let off = 0;
  let quotes = false;
  let acc = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];

    if (/\s/.test(c) && !quotes) {
      acc += str.slice(off, i);
      off = i + 1;

      if (acc.length !== 0) {
        res.push(acc);
        acc = '';
      }
    } else if (c === '\'' || c === '"') {
      acc += str.slice(off, i);
      off = i + 1;

      if (quotes === c)
        quotes = false;
      else
        quotes = c;
    } else if (c === '\\' && quotes !== '\'') {
      if (i + 1 >= str.length)
        throw new Error('Unmatched escape');
      acc += str.slice(off, i);
      off = i + 2;

      const n = str[++i];
      if (n === 'r')
        acc += '\r';
      else if (n === 'n')
        acc += '\n';
      else
        acc += n;
    }
  }
  if (quotes)
    throw new Error('Unmatched quotes');

  acc += str.slice(off);

  if (acc.length !== 0)
    res.push(acc);

  return res;
};
