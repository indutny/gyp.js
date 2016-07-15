'use strict';
/* global describe it */
/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');
const ninja = require('ninja.js');
const spawnSync = require('child_process').spawnSync;

const gyp = path.join(__dirname, '..', 'bin', 'gyp');
const gyppiesDir = path.join(__dirname, 'gyppies');
const tests = fs.readdirSync(gyppiesDir);

function build(name) {
  it(`should build ${name}`, function(cb) {
    this.timeout(15000);

    const folder = path.join(gyppiesDir, name);
    rimraf.sync(path.join(folder, 'out'));

    const stdio = [ null, null, 'inherit' ];
    const spawnOpts = { stdio: stdio, cwd: folder };

    const argvFile = path.join(folder, 'argv.json');
    const argv = fs.existsSync(argvFile) ? require(argvFile) : [];

    let p = spawnSync(process.execPath, [ gyp ].concat(argv), spawnOpts);
    if (p.status !== 0 && p.stdout)
      console.error(p.stdout.toString());
    if (p.error)
      throw p.error;
    assert.equal(p.status, 0, `cd ${name} && gyp failed`);

    const ninjaArgs = [
      'node', 'ninja', '-C', path.join(folder, 'out', 'Default') ];
    ninja.cli.run(ninjaArgs, {
    }, (err) => {
      if (err)
        return cb(err);

      // Compiled test
      let test = path.join(folder, 'out', 'Default', 'test');
      if (fs.existsSync(test)) {
        p = spawnSync(test, [], {
          stdio: stdio,
          cwd: path.join(folder, 'out', 'Default')
        });
        if (p.status !== 0 && p.stdout)
          console.error(p.stdout.toString());
        if (p.error)
          return cb(p.error);
        assert.equal(p.status, 0, `test ${name}`);
      }

      // JavaScript test
      test = path.join(folder, 'test.js');
      if (fs.existsSync(test))
        require(test)(path.join(folder, 'out', 'Default'));

      cb(null);
    });
  });
}

describe('gyppies', () => {
  tests.forEach(build);
});
