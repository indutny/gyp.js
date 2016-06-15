'use strict';

const gyp = require('../../gyp');

const win = exports;

win.ninjaRules = function ninjaRules(n) {
  n.rule('cc', {
    deps: 'msvc',
    // TODO(indutny): is /Fd$pdbname_c needed here?
    command: 'ninja -t msvc -- $cc /nologo /showIncludes /FC ' +
             '@$out.rsp /c $in /Fo$out',
    rspfile: '$out.rsp',
    rspfile_content: '$defines $includes $cflags $cflags_c',
    description: 'CC $out'
  });

  n.rule('cxx', {
    deps: 'msvc',
    // TODO(indutny): is /Fd$pdbname_c needed here?
    command: 'ninja -t msvc -- $cxx /nologo /showIncludes /FC ' +
             '@$out.rsp /c $in /Fo$out',
    rspfile: '$out.rsp',
    rspfile_content: '$defines $includes $cflags $cflags_cc',
    description: 'CXX $out'
  });

  n.rule('asm', {
    command: '$asm $defines $includes $asmflags /c /Fo $out $in',
    description: 'ASM $out'
  });

  n.rule('link', {
    command: '$ld /nologo /OUT:$out @$out.rsp',
    rspfile: '$out.rsp',
    rspfile_content: '$in_newline $libs $ldflags',
    pool: 'link_pool',
    description: 'LINK $out'
  });

  n.rule('alink', {
    command: '$ar /nologo /ignore:4221 /OUT:$out @$out.rsp',
    rspfile: '$out.rsp',
    rspfile_content: '$in_newline $libs $arflags',
    pool: 'link_pool',
    description: 'ALINK $out'
  });

  n.rule('solink', {
    command: '$ld /nologo /DLL /OUT:$out @$out.rsp',
    rspfile: '$out.rsp',
    rspfile_content: '$in_newline $libs $ldflags',
    pool: 'link_pool',
    description: 'SOLINK $out'
  });
};

win.adjustLibraries = function adjustLibraries(libs) {
  return libs.map(lib => {
    // remove -l prefix
    if (lib.startsWith('-l'))
      lib = lib.substring(2);
    // append .lib suffix
    const quoted = lib.startsWith('"') && lib.endsWith('"')? '"' : '';
    const suffix = '.lib' + quoted;
    if (!lib.endsWith(suffix))
      lib = lib.substr(0, lib.length - !!quoted) + suffix;
    return lib
  });
}
