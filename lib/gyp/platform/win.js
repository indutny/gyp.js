'use strict';

const gyp = require('../../gyp');
const fs = gyp.bindings.fs;
const path = gyp.bindings.path;
const process = gyp.bindings.process;

const win = exports;

win.ninjaRules = function ninjaRules(n, outDir, generatorFlags, params) {
  let envFile = win.genEnvironment(
      outDir,
      generatorFlags['msvs_version'] || 'auto',
      params['target_arch'] || 'ia32');
  if (envFile)
    envFile = ` -e ${envFile} `;
  else
    envFile = '';

  const ninjaWrap = `ninja -t msvc ${envFile}--`;

  n.rule('cc', {
    deps: 'msvc',
    // TODO(indutny): is /Fd$pdbname_c needed here?
    command: `${ninjaWrap} $cc /nologo /showIncludes /FC ` +
             '@$out.rsp /c $in /Fo$out',
    rspfile: '$out.rsp',
    rspfile_content: '$defines $includes $cflags $cflags_c',
    description: 'CC $out'
  });

  n.rule('cxx', {
    deps: 'msvc',
    // TODO(indutny): is /Fd$pdbname_c needed here?
    command: `${ninjaWrap} $cxx /nologo /showIncludes /FC ` +
             '@$out.rsp /c $in /Fo$out',
    rspfile: '$out.rsp',
    rspfile_content: '$defines $includes $cflags $cflags_cc',
    description: 'CXX $out'
  });

  n.rule('asm', {
    command: `${ninjaWrap} $asm @$out.rsp /nologo /c /Fo $out $in`,
    rspfile: '$out.rsp',
    rspfile_content: '$defines $includes $asmflags',
    description: 'ASM $out'
  });

  n.rule('link', {
    command: `${ninjaWrap} $ld /nologo /OUT:$out @$out.rsp`,
    rspfile: '$out.rsp',
    rspfile_content: '$in_newline $libs $ldflags',
    pool: 'link_pool',
    description: 'LINK $out'
  });

  n.rule('alink', {
    command: `${ninjaWrap} $ar /nologo /ignore:4221 /OUT:$out @$out.rsp`,
    rspfile: '$out.rsp',
    rspfile_content: '$in_newline $libs $arflags',
    pool: 'link_pool',
    description: 'ALINK $out'
  });

  n.rule('solink', {
    command: `${ninjaWrap} $ld /IMPLIB:$out.lib /nologo /DLL /OUT:$out ` +
             '@$out.rsp',
    rspfile: '$out.rsp',
    rspfile_content: '$in_newline $libs $ldflags',
    pool: 'link_pool',
    description: 'SOLINK $out'
  });

  n.rule('copy', {
    command: 'cmd /s /c "copy $in $out /Y /L"',
    description: 'COPY $out'
  });
};

win.adjustLibraries = function adjustLibraries(libs) {
  return libs.map(lib => {
    // remove -l prefix
    if (/^-l/.test(lib))
      lib = lib.slice(2);
    // append .lib suffix
    const quoted = /^".*"$/.test(lib);
    const suffix = quoted ? /\.lib"$/i : /\.lib$/i;
    if (!suffix.test(lib)) {
      lib = lib.slice(0, lib.length - (quoted | 0)) + '\.lib' +
            (quoted ? '"' : '');
    }
    return lib;
  });
};

function settingsWrapper(settings, flags) {
  return function(name, options) {
    options = options || {};
    const append = function(value) {
      if (value !== undefined) {
        switch (typeof options.map) {
        case 'function': value = options.map(value); break;
        case 'object':   value = options.map[value]; break;
        }
        if (value !== undefined && options.prefix)
          value = options.prefix + value;
        if (value)
          flags.push(value);
      }
    };
    let value = settings[name];
    if (value === undefined) value = options.defvalue;

    if (Array.isArray(value)) {
      value.forEach(append);
    } else {
      append(value);
    }
  };
}

function expandMSBuildMacros(value) {
  //TODO: expand MSBuild macros
  return value;
}

function compilerFlags(compiler) {
  let cflags = [];
  if (compiler) {
    let cl = settingsWrapper(compiler, cflags);
    cl('Optimization', {
      map: {'0': 'd', '1': '1', '2': '2', '3': 'x'},
      prefix: '/O', defvalue: '2' });
    cl('InlineFunctionExpansion', { prefix: '/Ob' });
    cl('DisableSpecificWarnings', { prefix: '/wd' });
    cl('StringPooling', { map: {'true': '/GF'} });
    cl('EnableFiberSafeOptimizations', { map: {'true': '/GT'} });
    cl('OmitFramePointers', {
      map: {'false': '-', 'true': ''}, prefix: '/Oy' });
    cl('EnableIntrinsicFunctions', {
      map: {'false': '-', 'true': ''}, prefix: '/Oi' });
    cl('FavorSizeOrSpeed', {
      map: {'1': 't', '2': 's'}, prefix: '/O' });
    cl('FloatingPointModel', {
      map: {'0': 'precise', '1': 'strict', '2': 'fast'},
      prefix: '/fp:', defvalue: '0' });
    cl('WholeProgramOptimization', { map: {'true': '/GL'} });
    cl('WarningLevel', { prefix: '/W' });
    cl('WarnAsError', { map: {'true': '/WX'} });
    cl('CallingConvention', {
      map: {'0': 'd', '1': 'r', '2': 'z', '3': 'v'},
      prefix: '/G' });
    cl('DebugInformationFormat', {
      map: {'1': '7', '3': 'i', '4': 'I'}, prefix: '/Z' });
    cl('RuntimeTypeInfo', { map: {'true': '/GR', 'false': '/GR-'} });
    cl('EnableFunctionLevelLinking', {
      map: {'true': '/Gy', 'false': '/Gy-'} });
    cl('MinimalRebuild', { map: {'true': '/Gm'} });
    cl('BufferSecurityCheck', { map: {'true': '/GS', 'false': '/GS-'} });
    cl('BasicRuntimeChecks', {
      map: {'1': 's', '2': 'u', '3': '1'}, prefix: '/RTC' });
    cl('RuntimeLibrary', {
      map: {'0': 'T', '1': 'Td', '2': 'D', '3': 'Dd'}, prefix: '/M' });
    cl('ExceptionHandling', { map: {'1': 'sc','2': 'a'}, prefix: '/EH' });
    cl('DefaultCharIsUnsigned', { map: {'true': '/J'} });
    cl('TreatWChar_tAsBuiltInType', {
      map: {'false': '-', 'true': ''}, prefix: '/Zc:wchar_t' });
    cl('EnablePREfast', { map: {'true': '/analyze'} });
    cl('AdditionalOptions');
    cl('EnableEnhancedInstructionSet', {
      map: {'1': 'SSE', '2': 'SSE2', '3': 'AVX', '4': 'IA32', '5': 'AVX2'},
      prefix: '/arch:' });
    cl('ForcedIncludeFiles', { prefix: '/FI'});
    // New flag required in 2013 to maintain previous PDB behavior.
    //TODO: if (vs_version.short_name in ('2013', '2013e', '2015'))
    cflags.push('/FS');
    // ninja handles parallelism by itself, don't have the compiler do it too.
    cflags = cflags.filter(f => !/^\/MP/.test(f));
  }
  return cflags;
}

function assemblerFlags(compiler) {
  let asmflags = [];
  if (compiler) {
    if (compiler['UseSafeExceptionHandlers'] == 'true')
      asmflags.push('/safeseh');
  }
  return asmflags;
}

function librarianFlags(librarian) {
  let libflags = [];
  if (librarian) {
    let lib = settingsWrapper(librarian, libflags);
      //TODO: libflags = libflags.concat(GetAdditionalLibraryDirectories(
      //       librarian, config, gyp_to_build_path));
    lib('LinkTimeCodeGeneration', { map: {'true': '/LTCG'} });
    lib('TargetMachine', {
      map: {'1': 'X86', '17': 'X64', '3': 'ARM'}, prefix: '/MACHINE:' });
    lib('OutputFile', { prefix: '/OUT:', map: expandMSBuildMacros });
    lib('AdditionalOptions');
  }
  return libflags;
}

function linkerFlags(linker) {
  let ldflags = [];
  if (linker) {
    let ld = settingsWrapper(linker, ldflags);
    ld('GenerateDebugInformation', { map: {'true': '/DEBUG'} });
    ld('TargetMachine', {
      map: {'1': 'X86', '17': 'X64', '3': 'ARM'}, prefix: '/MACHINE:' });
    //TODO: ldflags = ldflags.concat(GetAdditionalLibraryDirectories(
    //        linker, config, gyp_to_build_path));
    ld('DelayLoadDLLs', { prefix: '/DELAYLOAD:' });
    ld('TreatLinkerWarningAsErrors', {
      map: {'true': '', 'false': ':NO'}, prefix: '/WX' });
    ld('OutputFile', { map: expandMSBuildMacros, prefix: '/OUT:' });
    if (linker.GenerateDebugInformation) {
      ld('ProgramDatabaseFile', { map: expandMSBuildMacros, prefix: '/PDB:' });
    }
    ld('ProfileGuidedDatabase', { map: expandMSBuildMacros, prefix: '/PGD:' });
    let map_file = linker.MapFileName || '';
    if (map_file) map_file = ':' + expandMSBuildMacros(map_file);
    ld('GenerateMapFile', { map: {'true': '/MAP' + map_file} });
    ld('MapExports', { map: {'true': '/MAPINFO:EXPORTS'} });
    ld('AdditionalOptions');

    let minimum_required_version = linker.MinimumRequiredVersion || '';
    if (minimum_required_version)
      minimum_required_version = ',' + minimum_required_version;
    ld('SubSystem', {
      map: {'1': 'CONSOLE' + minimum_required_version,
            '2': 'WINDOWS' + minimum_required_version },
      prefix: '/SUBSYSTEM:' });

    let stack_reserve_size = linker.StackReserveSize || '';
    if (stack_reserve_size) {
      let stack_commit_size = linker.StackCommitSize || '';
      if (stack_commit_size) stack_commit_size = ',' + stack_commit_size;
      ldflags.push('/STACK' + stack_reserve_size + stack_commit_size);
    }

    ld('TerminalServerAware', {
      map: {'1': ':NO', '2': ''}, prefix: '/TSAWARE' });
    ld('LinkIncremental', {
      map: {'1': ':NO', '2': ''}, prefix: '/INCREMENTAL' });
    ld('BaseAddress', { prefix: '/BASE:' });
    ld('FixedBaseAddress', {
      map: {'1': ':NO', '2': ''}, prefix: '/FIXED' });
    ld('RandomizedBaseAddress', {
      map: {'1': ':NO', '2': ''}, prefix: '/DYNAMICBASE' });
    ld('DataExecutionPrevention', {
      map: {'1': ':NO', '2': ''}, prefix: '/NXCOMPAT' });
    ld('OptimizeReferences', {
      map: {'1': 'NOREF', '2': 'REF'}, prefix: '/OPT:' });
    ld('ForceSymbolReferences', { prefix: '/INCLUDE:' });
    ld('EnableCOMDATFolding', {
      map: {'1': 'NOICF', '2': 'ICF'}, prefix: '/OPT:' });
    ld('LinkTimeCodeGeneration', {
      map: {'1': '', '2': ':PGINSTRUMENT',
            '3': ':PGOPTIMIZE', '4': ':PGUPDATE'},
      prefix: '/LTCG' });
    ld('IgnoreDefaultLibraryNames', { prefix: '/NODEFAULTLIB:' });
    ld('ResourceOnlyDLL', { map: {'true': '/NOENTRY'} });
    ld('EntryPointSymbol', { prefix: '/ENTRY:' });
    ld('Profile', { map: {'true': '/PROFILE'} });
    ld('LargeAddressAware', {
      map: {'1': ':NO', '2': ''}, prefix: '/LARGEADDRESSAWARE' });
    ld('AdditionalDependencies');
    ld('ImageHasSafeExceptionHandlers', {
      map: {'false': ':NO', 'true': ''},
      prefix: '/SAFESEH'
      /*TODO: defvalue: GetArch(config) === 'x86'? 'true' : undefined*/
    });

    // If the base address is not specifically controlled,
    // DYNAMICBASE should be on by default.
    if (!ldflags.find(f => /^\/(DYNAMICBASE|FIXED)/.test(f)))
      ldflags.push('/DYNAMICBASE');

    // If the NXCOMPAT flag has not been specified, default to on. Despite the
    // documentation that says this only defaults to on when the subsystem is
    // Vista or greater (which applies to the linker), the IDE defaults it on
    // unless it's explicitly off.
    if (!ldflags.find(f => /^\/NXCOMPAT/.test(f)))
      ldflags.push('/NXCOMPAT');

    /* TODO:
    const have_def_file = ldflags.find(f => f.startsWith('/DEF:'));
    manifest_flags, intermediate_manifest, manifest_files =
        self._GetLdManifestFlags(config, manifest_base_name, gyp_to_build_path,
                                 is_executable and not have_def_file, build_dir);
    ldflags = ldflags.concat(manifest_flags);
    */
  }
  return ldflags;
}

win.targetFlags = function targetFlags(target) {
  const settings = target.msvs_settings || {};
  const disabled_warnings = target.msvs_disabled_warnings || [];

  let cflags = [];
  let cflags_c = [];
  let cflags_cc = [];
  let ldflags = [];
  let asmflags = [];

  cflags = cflags.concat(compilerFlags(settings.VCCLCompilerTool));
  cflags = cflags.concat(disabled_warnings.map(w => '/wd' + w));

  if (target.type === 'static_library') {
    ldflags = ldflags.concat(librarianFlags(settings.VCLibrarianTool));
  } else {
    ldflags = ldflags.concat(linkerFlags(settings.VCLinkerTool));
  }

  asmflags = asmflags.concat(assemblerFlags(settings.MASM));

  return { cflags, cflags_c, cflags_cc, ldflags, asmflags };
};

// def QuoteForRspFile(arg):
win.escapeDefine = function escapeDefine(arg) {
  /* Quote a command line argument so that it appears as one argument when
   * processed via cmd.exe and parsed by CommandLineToArgvW (as is typical for
   * Windows programs).
   *
   * See http://goo.gl/cuFbX and http://goo.gl/dhPnp including the comment
   * threads. This is actually the quoting rules for CommandLineToArgvW, not
   * for the shell, because the shell doesn't do anything in Windows. This
   * works more or less because most programs (including the compiler, etc.)
   * use that function to handle command line arguments.
   *
   * For a literal quote, CommandLineToArgvW requires 2n+1 backslashes
   * preceding it, and results in n backslashes + the quote. So we substitute
   * in 2* what we match, +1 more, plus the quote.
   */

  /(\\\\*)"/g;
  arg = arg.replace(/(\\*)"/g, (all, group) => {
    return group + group + '\\"';
  });

  // %'s also need to be doubled otherwise they're interpreted as batch
  // positional arguments. Also make sure to escape the % so that they're
  // passed literally through escaping so they can be singled to just the
  // original %. Otherwise, trying to pass the literal representation that
  // looks like an environment variable to the shell (e.g. %PATH%) would fail.
  arg = arg.replace(/%/g, '%%');

  // These commands are used in rsp files, so no escaping for the shell (via ^)
  // is necessary.

  // Finally, wrap the whole thing in quotes so that the above quote rule
  // applies and whitespace isn't a word break.
  return '"' + arg + '"';
};

// PORT of vcbuild.bat from libuv/node.js
win.detectVersion = function detectVersion() {
  throw new Error('No known Visual Studio version found, sorry!');
};

const IMPORTANT_VARS =
    /^(include|lib|libpath|path|pathext|systemroot|temp|tmp)=(.*)$/i;

function formatEnvBlock(lines) {
  let res = '';
  lines.forEach((line) => {
    const match = line.match(IMPORTANT_VARS);
    if (match === null)
      return;

    res += match[1].toUpperCase() + '=' + match[2] + '\0';
  });
  return res;
}

win.getMSVSVersion = function getMSVSVersion(version) {
  const env = process.env;

  if (!version)
    version = env['GYP_MSVS_VERSION'] || 'auto';

  // Try to find a MSVS installation
  if (version === 'auto' && env['VS140COMNTOOLS'] || version === '2015')
    return '2015';
  if (version === 'auto' && env['VS120COMNTOOLS'] || version === '2013')
    return '2013';
  if (version === 'auto' && env['VS100COMNTOOLS'] || version === '2010')
    return '2010';

  return 'auto';
};

win.getOSBits = function getOSBits() {
  const env = process.env;

  // PROCESSOR_ARCHITEW6432 - is a system arch
  // PROCESSOR_ARCHITECTURE - is a session arch
  const hostArch = env['PROCESSOR_ARCHITEW6432'] ||
                   env['PROCESSOR_ARCHITECTURE'];
  if (hostArch === 'AMD64')
    return 64;
  else
    return 32;
};

win.genEnvironment = function genEnvironment(outDir, version, arch) {
  const env = process.env;
  let tools;

  // Try to find a MSVS installation
  if (version === 'auto' && env['VS140COMNTOOLS'] || version === '2015') {
    version = '2015';
    tools =  path.join(env.VS140COMNTOOLS, '..', '..');
  }
  if (version === 'auto' && env['VS120COMNTOOLS'] || version === '2013') {
    version = '2013';
    tools =  path.join(env.VS120COMNTOOLS, '..', '..');
  }
  // TODO(indutny): more versions?
  if (version === 'auto' && env['VS100COMNTOOLS'] || version === '2010') {
    version = '2010';
    tools =  path.join(env.VS120COMNTOOLS, '..', '..');
  }
  // TODO(indutny): does it work with MSVS Express?

  if (version === 'auto') {
    gyp.bindings.error('No Visual Studio found. When building - please ' +
                       'run `ninja` from the MSVS console');
    return;
  }

  // NOTE: Largely inspired by MSVSVersion.py
  const bits = win.getOSBits();

  let vcvars;
  // TODO(indutny): proper escape for the .bat file
  if (arch === 'ia32') {
    if (bits === 64)
      vcvars = '"' + path.join(tools, 'VC', 'vcvarsall.bat') + '" amd64_x86';
    else
      vcvars = '"' + path.join(tools, 'Common7', 'Tools', 'vsvars32.bat') + '"';
  } else if (arch === 'x64') {
    let arg;
    if (bits === 64)
      arg = 'amd64';
    else
      arg = 'x86_amd64';
    vcvars = '"' + path.join(tools, 'VC', 'vcvarsall.bat') + '" ' + arg;
  } else {
    throw new Error(`Arch: '${arch}' is not supported on windows`);
  }

  let lines;
  try {
    lines = gyp.bindings.execSync(`${vcvars} & set`, { env: {} }).toString()
        .split(/\r\n/g);
  } catch (e) {
    gyp.bindings.error(e.message);
    return;
  }

  const envBlock = formatEnvBlock(lines);
  const envFile = 'environment.' + arch;

  fs.writeFileSync(path.join(outDir, envFile),
                   envBlock);

  return envFile;
};
