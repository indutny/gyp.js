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

function SettingsWrapper(settings, flags) {
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
  }
}

function expandMSBuildMacros(value) {
  //TODO: expand MSBuild macros
  return value;
}

function compilerFlags(compiler) {
  let cflags = [];
  if (compiler) {
    let cl = SettingsWrapper(compiler, cflags);
    cl('Optimization', {
      map: {'0': 'd', '1': '1', '2': '2', '3': 'x'},
      prefix: '/O', defvalue: '2' });
    cl('InlineFunctionExpansion', { prefix: '/Ob' });
    cl('DisableSpecificWarnings', { prefix: '/wd' });
    cl('StringPooling', { map: {'true': '/GF'} });
    cl('EnableFiberSafeOptimizations', { map: {'true': '/GT'} });
    cl('OmitFramePointers', {
      map: {'false': '-', 'true': ''}, prefix: '/Oy' })
    cl('EnableIntrinsicFunctions', {
      map: {'false': '-', 'true': ''}, prefix: '/Oi' })
    cl('FavorSizeOrSpeed', {
      map: {'1': 't', '2': 's'}, prefix: '/O' })
    cl('FloatingPointModel', {
      map: {'0': 'precise', '1': 'strict', '2': 'fast'},
      prefix: '/fp:', defvalue: '0' })
    cl('WholeProgramOptimization', { map: {'true': '/GL'} })
    cl('WarningLevel', { prefix: '/W' })
    cl('WarnAsError', { map: {'true': '/WX'} })
    cl('CallingConvention', {
      map: {'0': 'd', '1': 'r', '2': 'z', '3': 'v'},
      prefix: '/G' })
    cl('DebugInformationFormat', {
      map: {'1': '7', '3': 'i', '4': 'I'}, prefix: '/Z' })
    cl('RuntimeTypeInfo', { map: {'true': '/GR', 'false': '/GR-'} })
    cl('EnableFunctionLevelLinking', {
      map: {'true': '/Gy', 'false': '/Gy-'} })
    cl('MinimalRebuild', { map: {'true': '/Gm'} })
    cl('BufferSecurityCheck', { map: {'true': '/GS', 'false': '/GS-'} })
    cl('BasicRuntimeChecks', {
      map: {'1': 's', '2': 'u', '3': '1'}, prefix: '/RTC' })
    cl('RuntimeLibrary', {
      map: {'0': 'T', '1': 'Td', '2': 'D', '3': 'Dd'}, prefix: '/M' })
    cl('ExceptionHandling', { map: {'1': 'sc','2': 'a'}, prefix: '/EH' })
    cl('DefaultCharIsUnsigned', { map: {'true': '/J'} })
    cl('TreatWChar_tAsBuiltInType', {
      map: {'false': '-', 'true': ''}, prefix: '/Zc:wchar_t' })
    cl('EnablePREfast', { map: {'true': '/analyze'} })
    cl('AdditionalOptions')
    cl('EnableEnhancedInstructionSet', {
      map: {'1': 'SSE', '2': 'SSE2', '3': 'AVX', '4': 'IA32', '5': 'AVX2'},
      prefix: '/arch:' })
    cl('ForcedIncludeFiles', { prefix: '/FI'});
    // New flag required in 2013 to maintain previous PDB behavior.
    if (true) //TODO: (vs_version.short_name in ('2013', '2013e', '2015'))
      cflags.push('/FS');
    // ninja handles parallelism by itself, don't have the compiler do it too.
    cflags = cflags.filter(f => !f.startsWith('/MP'));
  }
  return cflags;
}

function librarianFlags(librarian) {
    let libflags = []
    if (librarian) {
      let lib = SettingsWrapper(librarian, libflags);
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
    let ld = SettingsWrapper(linker, ldflags);
    ld('GenerateDebugInformation', { map: {'true': '/DEBUG'} });
    ld('TargetMachine', {
      map: {'1': 'X86', '17': 'X64', '3': 'ARM'}, prefix: '/MACHINE:' });
    //TODO: ldflags = ldflags.concat(GetAdditionalLibraryDirectories(
    //        linker, config, gyp_to_build_path));
    ld('DelayLoadDLLs', { prefix: '/DELAYLOAD:' })
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
      prefix: '/SAFESEH', 
      /*TODO: defvalue: GetArch(config) === 'x86'? 'true' : undefined*/ });

    // If the base address is not specifically controlled,
    // DYNAMICBASE should be on by default.
    if (!ldflags.find(f => f.startsWith('/DYNAMICBASE')
      || f.startsWith('/FIXED'))) ldflags.push('/DYNAMICBASE');

    // If the NXCOMPAT flag has not been specified, default to on. Despite the
    // documentation that says this only defaults to on when the subsystem is
    // Vista or greater (which applies to the linker), the IDE defaults it on
    // unless it's explicitly off.
    if (!ldflags.find(f => f.startsWith('/NXCOMPAT')))
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

  cflags = cflags.concat(compilerFlags(settings.VCCLCompilerTool));
  cflags = cflags.concat(disabled_warnings.map(w => '/wd' + w))

  if (target.type === 'static_library') {
    ldflags = ldflags.concat(librarianFlags(settings.VCLibrarianTool));
  } else {
    ldflags = ldflags.concat(linkerFlags(settings.VCLinkerTool));
  }

  return { cflags, cflags_c, cflags_cc, ldflags };
};