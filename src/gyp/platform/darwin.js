'use strict';

const darwin = exports;

darwin.compilerFlags = function compilerFlags(xc) {
  let cflags = xc.OTHER_CFLAGS || [];
  let cflags_c = [];
  let cflags_cc = [];
  let ldflags = xc.OTHER_LDFLAGS || [];

  cflags = cflags.concat(xc.WARNING_CFLAGS || []);

  if (xc.CLANG_WARN_CONSTANT_CONVERSION === 'YES')
    cflags.push('-Wconstant-conversion');
  if (xc.GCC_CHAR_IS_UNSIGNED_CHAR === 'YES')
    cflags.push('-funsigned-char');
  if (xc.GCC_CW_ASM_SYNTAX !== 'NO')
    cflags.push('-fasm-blocks');
  if (xc.GCC_OPTIMIZATION_LEVEL)
    cflags.push(`-O${xc.GCC_OPTIMIZATION_LEVEL}`);
  else
    cflags.push('-Os');
  if (xc.GCC_DYNAMIC_NO_PIC === 'YES')
    cflags.push('-mdynamic-no-pic');
  if (xc.ARCHS && xc.ARCHS.length === 1)
    cflags.push(`-arch ${xc.ARCHS[0]}`);
  else
    cflags.push('-arch i386');

  if (xc.GCC_C_LANGUAGE_STANDARD === 'ansi')
    cflags_c.push('-ansi');
  else if (xc.GCC_C_LANGUAGE_STANDARD)
    cflags_c.push(`-std=${xc.GCC_C_LANGUAGE_STANDARD}`);

  if (xc.CLANG_CXX_LANGUAGE_STANDARD)
    cflags_cc.push(`-std=${xc.CLANG_CXX_LANGUAGE_STANDARD}`);
  if (xc.GCC_ENABLE_CPP_EXCEPTIONS === 'NO')
    cflags_cc.push('-fno-exceptions');
  if (xc.GCC_ENABLE_CPP_RTTI === 'NO')
    cflags_cc.push('-fno-rtti');
  if (xc.GCC_THREADSAFE_STATICS === 'NO')
    cflags_cc.push('-fno-threadsafe-statics');
  if (xc.GCC_INLINES_ARE_PRIVATE_EXTERN === 'YES')
    cflags_cc.push('-fvisibility-inlines-hidden');

  if (xc.MACOSX_DEPLOYMENT_TARGET)
    cflags.push(`-mmacosx-version-min=${xc.MACOSX_DEPLOYMENT_TARGET}`);

  return { cflags, cflags_c, cflags_cc, ldflags };
};
