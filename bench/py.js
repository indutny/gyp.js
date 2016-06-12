'use strict';

const py = require('../').py;

function deep(depth) {
  if (depth === 0)
    return [ 1, 2, 3 ];
  return {
    a: deep(depth - 1),
    b: deep(depth - 1),
    c: deep(depth - 1)
  };
}

const obj = JSON.stringify(deep(5));

const COUNT = 1e3;

const start = +new Date;
for (let i = 0; i < COUNT; i++)
  py.parseJSON(obj);
const end = +new Date;

console.log('%d parseJSON ops/sec', COUNT / (end - start) * 1000);
