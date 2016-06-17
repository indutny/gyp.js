'use strict';
/* global describe it */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const spawnSync = require('child_process').spawnSync;

const gyp = path.join(__dirname, '..', 'bin', 'gyp');
const ninja = process.env.NINJA || 'ninja';
const gyppiesDir = path.join(__dirname, 'gyppies');
const tests = fs.readdirSync(gyppiesDir);

function build(name) {
  it(`should build ${name}`, () => {
    const folder = path.join(gyppiesDir, name);

    const stdio = [ null, null, 'inherit' ];
    const spawnOpts = { stdio: stdio, cwd: folder };

    let p = spawnSync(gyp, [], spawnOpts);
    assert.equal(p.status, 0, `cd ${name} && gyp failed`);

    p = spawnSync(ninja, [ '-C', path.join('out', 'Default') ], spawnOpts);
    assert.equal(p.status, 0, `ninja ${name}`);

    // Compiled test
    let test = path.join(folder, 'out/Default/test');
    if (fs.existsSync(test)) {
      p = spawnSync(test, [], spawnOpts);
      assert.equal(p.status, 0, `test ${name}`);
    }

    // JavaScript test
    test = path.join(folder, 'test.js');
    if (fs.existsSync(test))
      require(test)(path.join(folder, 'out', 'Default'));
  });
}

describe('gyppies', () => {
  tests.forEach(build);
});
