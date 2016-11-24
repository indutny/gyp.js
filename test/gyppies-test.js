'use strict';
/* global describe it */
/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');
const ninja = require('ninja.js');
const spawnSync = require('child_process').spawnSync;

const rootDir = path.join(__dirname, '..');
const gyp = path.join(rootDir, 'bin', 'gyp');
const istanbul = path.join(rootDir, 'node_modules', '.bin', 'istanbul');
const istanbulCoverageDir = path.join(rootDir, 'coverage');
const istanbulArgs = [ istanbul, 'cover', '--root', rootDir, '--dir',
                       istanbulCoverageDir, '--report', 'none', '--print',
                       'none', '--include-pid' ];
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
    let argv = fs.existsSync(argvFile) ? require(argvFile) : [];
    argv = [ gyp ].concat(argv);
    if (process.env.running_under_istanbul)
      argv = istanbulArgs.concat(argv);

    let p = spawnSync(process.execPath, argv, spawnOpts);
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
