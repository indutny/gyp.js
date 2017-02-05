'use strict';
/* global describe it */

const assert = require('assert');

const win = require('../').platform.win;

describe('gyp.platform.win', () => {
  describe('adjustLibraries', () => {
    it('should be empty', () => {
      assert.deepEqual(win.adjustLibraries([]), []);
    });

    it('should remove prefix `-l`', () => {
      assert.deepEqual(
        win.adjustLibraries([ '-llib1.lib', 'lib2.lib' ]),
        [ 'lib1.lib', 'lib2.lib' ]);
    });

    it('should append suffix `.lib`', () => {
      assert.deepEqual(
        win.adjustLibraries([ '-llib1', 'lib2.lib', 'lib3.Lib' ]),
        [ 'lib1.lib', 'lib2.lib', 'lib3.Lib' ]);
    });

    it('should remove prefix `-l` and append suffix `.lib`', () => {
      assert.deepEqual(
        win.adjustLibraries([ 'lib1', '-llib2', '-llib3.lib', 'lib4.lib' ]),
        [ 'lib1.lib', 'lib2.lib', 'lib3.lib', 'lib4.lib' ]);
    });

    it('should preserve quotes', () => {
      assert.deepEqual(
        win.adjustLibraries([ '"some path/lib1"', '-l"lib2"',
                             '-l"lib3.lib"', '"lib4.lib"' ]),
        [ '"some path/lib1.lib"', '"lib2.lib"', '"lib3.lib"', '"lib4.lib"' ]);
    });
  });

  describe('targetFlags', () => {
    it('disable specific warnings', () => {
      const warnings = [1, 2, 3, 4];
      assert.deepEqual(win.targetFlags(
        { msvs_disabled_warnings: [] }).cflags, []);
      assert.deepEqual(win.targetFlags(
        { msvs_disabled_warnings: warnings }).cflags,
        [ '/wd1', '/wd2', '/wd3', '/wd4' ]);
    });

    it('compiler', () => {
      const compiler = {
        Optimization: 0,
        InlineFunctionExpansion: 2,
        DisableSpecificWarnings: [99, 100],
        StringPooling: true,
        EnableFiberSafeOptimizations: true,
        OmitFramePointers: true,
        EnableIntrinsicFunctions: true,
        FavorSizeOrSpeed: 2,
        FloatingPointModel: 0,
        WholeProgramOptimization: true,
        WarningLevel: 4,
        WarnAsError: true,
        CallingConvention: 0,
        DebugInformationFormat: 4,
        RuntimeTypeInfo: true,
        EnableFunctionLevelLinking: true,
        MinimalRebuild: true,
        BufferSecurityCheck: false,
        BasicRuntimeChecks: 1,
        RuntimeLibrary: 0,
        ExceptionHandling: 1,
        DefaultCharIsUnsigned: true,
        TreatWChar_tAsBuiltInType: true,
        EnablePREfast: true,
        AdditionalOptions: [ '/XXX', '/YYY', '/MP' ], // /MP should be removed
        EnableEnhancedInstructionSet: 5,
        ForcedIncludeFiles: [ 'file1.h', 'file2.h' ]
      };
      const cflags = [
        '/Od',
        '/Ob2',
        '/wd99', '/wd100',
        '/GF',
        '/GT',
        '/Oy',
        '/Oi',
        '/Os',
        '/fp:precise',
        '/GL',
        '/W4',
        '/WX',
        '/Gd',
        '/ZI',
        '/GR',
        '/Gy',
        '/Gm',
        '/GS-',
        '/RTCs',
        '/MT',
        '/EHsc',
        '/J',
        '/Zc:wchar_t',
        '/analyze',
        '/XXX', '/YYY',
        '/arch:AVX2',
        '/FIfile1.h', '/FIfile2.h',
        '/FS' // always added
      ];
      assert.deepEqual(win.targetFlags(
        { msvs_settings: { VCCLCompilerTool: compiler }}).cflags, cflags);
    });

    it('librarian', () => {
      const librarian = {
        LinkTimeCodeGeneration: true,
        TargetMachine: 1,
        OutputFile: 'output.lib',
        AdditionalOptions: [ '/XXX', '/YYY' ]
      };
      const libflags = [
        '/LTCG',
        '/MACHINE:X86',
        '/OUT:output.lib',
        '/XXX', '/YYY'
      ];
      assert.deepEqual(win.targetFlags({ type: 'static_library',
        msvs_settings: { VCLibrarianTool: librarian }}).ldflags, libflags);
    });

    it('linker', () => {
      const linker = {
        GenerateDebugInformation: true,
        TargetMachine: 17,
        DelayLoadDLLs: [ 'lib1.dll', 'lib2.dll' ],
        TreatLinkerWarningAsErrors: false,
        OutputFile: 'output.dll',
        ProgramDatabaseFile: 'data.pdb',
        ProfileGuidedDatabase: 'data.pgd',
        GenerateMapFile: true,
        MapFileName: 'data.map',
        MapExports: true,
        AdditionalOptions: [ '/XXX', '/YYY' ],
        MinimumRequiredVersion: 7,
        SubSystem: 2,
        StackReserveSize: 100,
        StackCommitSize: 200,
        TerminalServerAware: 1,
        LinkIncremental: 2,
        BaseAddress: 1000,
        FixedBaseAddress: 2,
        RandomizedBaseAddress: 1,
        DataExecutionPrevention: 2,
        OptimizeReferences: 2,
        ForceSymbolReferences: [ 'aa', 'zz' ],
        EnableCOMDATFolding: 2,
        LinkTimeCodeGeneration: 4,
        IgnoreDefaultLibraryNames: [ 'xxx.lib' ],
        ResourceOnlyDLL: true,
        EntryPointSymbol: 'main',
        Profile: true,
        LargeAddressAware: 2,
        AdditionalDependencies: [ 'my1.lib', 'my2.lib' ],
        ImageHasSafeExceptionHandlers: true
      };
      const ldflags = [
        '/DEBUG',
        '/MACHINE:X64',
        '/DELAYLOAD:lib1.dll', '/DELAYLOAD:lib2.dll',
        '/WX:NO',
        '/OUT:output.dll',
        '/PDB:data.pdb',
        '/PGD:data.pgd',
        '/MAP:data.map',
        '/MAPINFO:EXPORTS',
        '/XXX', '/YYY',
        '/SUBSYSTEM:WINDOWS,7',
        '/STACK:100,200',
        '/TSAWARE:NO',
        '/INCREMENTAL',
        '/BASE:1000',
        '/FIXED',
        '/DYNAMICBASE:NO',
        '/NXCOMPAT',
        '/OPT:REF',
        '/INCLUDE:aa', '/INCLUDE:zz',
        '/OPT:ICF',
        '/LTCG:PGUPDATE',
        '/NODEFAULTLIB:xxx.lib',
        '/NOENTRY',
        '/ENTRY:main',
        '/PROFILE',
        '/LARGEADDRESSAWARE',
        'my1.lib', 'my2.lib',
        '/SAFESEH'
      ];
      assert.deepEqual(win.targetFlags(
        { msvs_settings: { VCLinkerTool: linker }}).ldflags, ldflags);
    });

    it('assembler', () => {
      const assembler = {
        UseSafeExceptionHandlers: 'true'
      };

      const asmflags = [
        '/safeseh'
      ];
      assert.deepEqual(win.targetFlags(
        { msvs_settings: { MASM: assembler } }).asmflags, asmflags);
    });
  });

  describe('escapeDefine', () => {
    it('should escape %', () => {
      assert.equal(win.escapeDefine('%'), '"%%"');
    });

    it('should escape "', () => {
      assert.equal(win.escapeDefine('"'), '"\\""');
    });

    it('should escape \\"', () => {
      assert.equal(win.escapeDefine('\\"'), '"\\\\\\""');
    });
  });
});
