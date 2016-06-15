'use strict';

const assert = require('assert');

const win = require('../').platform.win;

describe('gyp.platform.win', () => {
  describe('adjustLibraries', () => {
    it('should be empty', () => {
      assert.deepEqual(win.adjustLibraries([]), []);
    });

    it('should remove prefix `-l`', () => {
      assert.deepEqual(win.adjustLibraries(['-llib1.lib', 'lib2.lib']), ['lib1.lib', 'lib2.lib']);
    });

    it('should append suffix `.lib`', () => {
      assert.deepEqual(win.adjustLibraries(['-llib1', 'lib2.lib']), ['lib1.lib', 'lib2.lib']);
    });

    it('should remove prefix `-l` and append suffix `.lib`', () => {
      assert.deepEqual(win.adjustLibraries(['lib1', '-llib2', '-llib3.lib', 'lib4.lib']),
        ['lib1.lib', 'lib2.lib', 'lib3.lib', 'lib4.lib']);
    });

    it('should preserve quotes', () => {
      assert.deepEqual(win.adjustLibraries(['"some path/lib1"', '-l"lib2"', '-l"lib3.lib"', '"lib4.lib"']),
        ['"some path/lib1.lib"', '"lib2.lib"', '"lib3.lib"', '"lib4.lib"']);
    });
  });
});
