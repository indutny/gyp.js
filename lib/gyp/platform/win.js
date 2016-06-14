'use strict';

const gyp = require('../../gyp');
const process = gyp.bindings.process;
const path = gyp.bindings.path;
const fs = gyp.bindings.fs;
const globSync = gyp.bindings.globSync;
const execSync = gyp.bindings.execSync;
const spawnSync = gyp.bindings.spawnSync;

const win = exports;

function VisualStudioVersion(shortName, description, config) {
  this.shortName = shortName;
  this.description = description;
  this.config = config;
}

VisualStudioVersion.prototype._setupScriptInternal =
    function _setupScriptInternal(targetArch) {
  /* Returns a command (with arguments) to be used to set up the
   * environment.
   */
  // If WindowsSDKDir is set and SetEnv.Cmd exists then we are using the
  // depot_tools build tools and should run SetEnv.Cmd to set up the
  // environment. The check for WindowsSDKDir alone is not sufficient because
  // this is set by running vcvarsall.bat.
  const sdkDir = process.env['WindowsSDKDir'];
  let setupPath;
  if (sdkDir)
    setupPath = path.normalize(path.join(sdkDir, 'Bin/SetEnv.Cmd'));
  if (this.config.sdkBased && sdkDir && fs.existsSync(setupPath))
    return [ setupPath, '/' + targetArch ];

  // We don't use VC/vcvarsall.bat for x86 because vcvarsall calls
  // vcvars32, which it can only find if VS??COMNTOOLS is set, which it
  // isn't always.
  if (targetArch === 'x86') {
    if (this.shortName >= '2013' && !/e$/.test(this.shortName) &&
        (process.env['PROCESSOR_ARCHITECTURE'] === 'AMD64' ||
         process.env['PROCESSOR_ARCHITEW6432'] === 'AMD64')) {
      // VS2013 and later, non-Express have a x64-x86 cross that we want
      // to prefer.
      return [ path.normalize(
         path.join(this.config.path, 'VC/vcvarsall.bat')), 'amd64_x86' ];
    }

    // Otherwise, the standard x86 compiler.
    return [ path.normalize(
      path.join(this.config.path, 'Common7/Tools/vsvars32.bat')) ];
  } else {
    let arg = 'x86_amd64';
    // Use the 64-on-64 compiler if we're not using an express
    // edition and we're running on a 64bit OS.
    if (!/e$/.test(this.shortName) &&
        (process.env['PROCESSOR_ARCHITECTURE'] === 'AMD64' ||
         process.env['PROCESSOR_ARCHITEW6432'] === 'AMD64')) {
      arg = 'amd64'
    }
    return [ path.normalize(
        path.join(this.config.path, 'VC/vcvarsall.bat')), arg ];
  }
}

VisualStudioVersion.prototype.setupScript = function setupScript(targetArch) {
  const scriptData = this._setupScriptInternal(targetArch);
  const scriptPath = scriptData[0];
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`${scriptPath} is missing - make sure VC++ tools are ` +
                    `installed.`);
  }
  return scriptData;
};

win.ninjaRules = function ninjaRules(n) {
  n.rule('cc', {
    deps: 'msvc',
    // TODO(indutny): is /Fd$pdbname_c needed here?
    command: 'ninja -t msvc -e $arch -- $cc /nologo /showIncludes /FC ' +
             '@$out.rsp /c $in /Fo$out',
    rspfile: '$out.rsp',
    rspfile_content: '$defines $includes $cflags $cflags_c',
    description: 'CC $out'
  });

  n.rule('cxx', {
    deps: 'msvc',
    // TODO(indutny): is /Fd$pdbname_c needed here?
    command: 'ninja -t msvc -e $arch -- $cxx /nologo /showIncludes /FC ' +
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

function _createVersion(name, tpath, sdkBased = false) {
  /* Sets up MSVS project generation.
   *
   * Setup is based off the GYP_MSVS_VERSION environment variable or whatever is
   * autodetected if GYP_MSVS_VERSION is not explicitly specified. If a version
   * is passed in that doesn't match a value in versions python will throw a
   * error.
   */
  if (tpath)
    tpath = path.normalize(tpath);

  const versions = {
    '2015': new VisualStudioVersion('2015', 'Visual Studio 2015', {
      solutionVersion: '12.00',
      projectVersion: '14.0',
      flatSln: false,
      usesVcxproj: true,
      path: tpath,
      sdkBased: sdkBased,
      default_toolset: 'v140'
    }),
    '2013': new VisualStudioVersion('2013', 'Visual Studio 2013', {
      solutionVersion: '13.00',
      projectVersion: '12.0',
      flatSln: false,
      usesVcxproj: true,
      path: tpath,
      sdkBased: sdkBased,
      default_toolset: 'v120'
    }),
    '2013e': new VisualStudioVersion('2013e', 'Visual Studio 2013', {
      solutionVersion: '13.00',
      projectVersion: '12.0',
      flatSln: true,
      usesVcxproj: true,
      path: tpath,
      sdkBased: sdkBased,
      default_toolset: 'v120'
    }),
    '2012': new VisualStudioVersion('2012', 'Visual Studio 2012', {
      solutionVersion: '12.00',
      projectVersion: '4.0',
      flatSln: false,
      usesVcxproj: true,
      path: tpath,
      sdkBased: sdkBased,
      default_toolset: 'v110'
    }),
    '2012e': new VisualStudioVersion('2012e', 'Visual Studio 2012', {
      solutionVersion: '12.00',
      projectVersion: '4.0',
      flatSln: true,
      usesVcxproj: true,
      path: tpath,
      sdkBased: sdkBased,
      default_toolset: 'v110'
    }),
    '2010': new VisualStudioVersion('2010', 'Visual Studio 2010', {
      solutionVersion: '11.00',
      projectVersion: '4.0',
      flatSln: false,
      usesVcxproj: true,
      path: tpath,
      sdkBased: sdkBased
    }),
    '2010e': new VisualStudioVersion('2010e', 'Visual C++ Express 2010', {
      solutionVersion: '11.00',
      projectVersion: '4.0',
      flatSln: true,
      usesVcxproj: true,
      path: tpath,
      sdkBased: sdkBased
    }),
    '2008': new VisualStudioVersion('2008', 'Visual Studio 2008', {
      solutionVersion: '10.00',
      projectVersion: '9.00',
      flatSln: false,
      usesVcxproj: false,
      path: tpath,
      sdkBased: sdkBased
    }),
    '2008e': new VisualStudioVersion('2008e', 'Visual Studio 2008', {
      solutionVersion: '10.00',
      projectVersion: '9.00',
      flatSln: true,
      usesVcxproj: false,
      path: tpath,
      sdkBased: sdkBased
    }),
    '2005': new VisualStudioVersion('2005', 'Visual Studio 2005', {
      solutionVersion: '9.00',
      projectVersion: '8.00',
      flatSln: false,
      usesVcxproj: false,
      path: tpath,
      sdkBased: sdkBased
    }),
    '2005e': new VisualStudioVersion('2005e', 'Visual Studio 2005', {
      solutionVersion: '9.00',
      projectVersion: '8.00',
      flatSln: true,
      usesVcxproj: false,
      path: tpath,
      sdkBased: sdkBased
    }),
  };
  return versions[name];
}

function _convertToCygpath(path) {
  // TODO(indutny): Convert to cygwin path if we are using cygwin.
  return path;
}

function _registryQueryBase(sysdir, key, value) {
  /* Use reg.exe to read a particular key.
   *
   * While ideally we might use the win32 module, we would like gyp to be
   * python neutral, so for instance cygwin python lacks this module.
   *
   * Arguments:
   *   sysdir: The system subdirectory to attempt to launch reg.exe from.
   *   key: The registry key to read from.
   *   value: The particular value to read.
   * Return:
   *   stdout from reg.exe, or None for failure.
   */
  // Setup params to pass to and attempt to launch reg.exe
  const cmd = [ path.join(process.env['WINDIR'] || '',
                          sysdir,
                          'reg.exe'),
                'query', key]
  if (value)
    cmd.push('/v', value);

  const p = spawnSync(cmd[0], cmd.slice(1));
  // Obtain the stdout from reg.exe, reading to the end so p.returncode is valid
  // Note that the error text may be in [1] in some cases
  const text = p.stdout.toString();
  // Check return code from reg.exe; officially 0==success and 1==error
  if (p.status !== 0)
    return undefined;
  return text;
}

function _registryQuery(key, value) {
  /* Use reg.exe to read a particular key through _RegistryQueryBase.
   *
   * First tries to launch from %WinDir%\Sysnative to avoid WoW64 redirection. If
   * that fails, it falls back to System32.  Sysnative is available on Vista and
   * up and available on Windows Server 2003 and XP through KB patch 942589. Note
   * that Sysnative will always fail if using 64-bit python due to it being a
   * virtual directory and System32 will work correctly in the first place.
   *
   * KB 942589 - http://support.microsoft.com/kb/942589/en-us.
   *
   * Arguments:
   *  key: The registry key.
   *  value: The particular registry value to read (optional).
   * Return:
   *   stdout from reg.exe, or None for failure.
   */
  let text;
  try {
    text = _registryQueryBase('Sysnative', key, value);
  } catch (e) {
    text = _registryQueryBase('System32', key, value);
  }
  return text;
}

function _detectVisualStudioVersions(versionsToCheck, forceExpress) {
  /* Collect the list of installed visual studio versions.
   *
   * Returns:
   *   A list of visual studio versions installed in descending order of
   *   usage preference.
   *   Base this on the registry and a quick check if devenv.exe exists.
   *   Only versions 8-10 are considered.
   *   Possibilities are:
   *     2005(e) - Visual Studio 2005 (8)
   *     2008(e) - Visual Studio 2008 (9)
   *     2010(e) - Visual Studio 2010 (10)
   *     2012(e) - Visual Studio 2012 (11)
   *     2013(e) - Visual Studio 2013 (12)
   *     2015    - Visual Studio 2015 (14)
   *   Where (e) is e for express editions of MSVS and blank otherwise.
   */
  const versionToYear = {
      '8.0': '2005',
      '9.0': '2008',
      '10.0': '2010',
      '11.0': '2012',
      '12.0': '2013',
      '14.0': '2015'
  };
  const versions = [];
  versionsToCheck.forEach((version) => {
    // Old method of searching for which VS version is installed
    // We don't use the 2010-encouraged-way because we also want to get the
    // path to the binaries, which it doesn't offer.
    let keys = [
      `HKLM\\Software\\Microsoft\\VisualStudio\\${version}`,
      `HKLM\\Software\\Wow6432Node\\Microsoft\\VisualStudio\\${version}`,
      `HKLM\\Software\\Microsoft\\VCExpress\\${version}`,
      `HKLM\\Software\\Wow6432Node\\Microsoft\\VCExpress\\${version}`
    ];
    keys.forEach((key) => {
      let tpath = _registryQuery(key, 'InstallDir')
      if (!tpath)
        return;

      tpath = _convertToCygpath(tpath);
      // Check for full.
      const fullPath = path.join(path, 'devenv.exe')
      const expressPath = path.join(path, '*express.exe')
      if (!forceExpress && fs.existsSync(fullPath)) {
        // Add this one.
        versions.push(_createVersion(versionToYear[version],
            path.join(path, '..', '..')));
        // Check for express.
      } else if (globSync(expressPath).length !== 0) {
        // Add this one.
        versions.push(_createVersion(versionToYear[version] + 'e',
            path.join(path, '..', '..')));
      }
    });

    // The old method above does not work when only SDK is installed.
    keys = [
      'HKLM\\Software\\Microsoft\\VisualStudio\\SxS\\VC7',
      'HKLM\\Software\\Wow6432Node\\Microsoft\\VisualStudio\\SxS\\VC7'
    ];
    keys.forEach((key) => {
      let tpath = _registryQuery(key, version)
      if (!tpath)
        return;
      tpath = _convertToCygpath(tpath);
      if (version !== '14.0') {
        // There is no Express edition for 2015.
        versions.push(_createVersion(versionToYear[version] + 'e',
            path.join(tpath, '..'), true));
      }
    });
  });

  return versions;
}

function selectVisualStudioVersion(version = 'auto', allowFallback = true) {
  /* Select which version of Visual Studio projects to generate.
   *
   * Arguments:
   *   version: Hook to allow caller to force a particular version (vs auto).
   * Returns:
   *   An object representing a visual studio project format version.
   */
  // In auto mode, check environment variable for override.
  if (version === 'auto')
    version = process.env['GYP_MSVS_VERSION'] || 'auto';

  const versionMap = {
    'auto': [ '14.0', '12.0', '10.0', '9.0', '8.0', '11.0' ],
    '2005': [ '8.0' ],
    '2005e': [ '8.0' ],
    '2008': [ '9.0' ],
    '2008e': [ '9.0' ],
    '2010': [ '10.0' ],
    '2010e': [ '10.0' ],
    '2012': [ '11.0' ],
    '2012e': [ '11.0' ],
    '2013': [ '12.0' ],
    '2013e': [ '12.0' ],
    '2015': [ '14.0' ]
  }
  const overridePath = process.env['GYP_MSVS_OVERRIDE_PATH'];
  if (overridePath) {
    const msvsVersion = process.env['GYP_MSVS_VERSION'];
    if (!msvsVersion) {
      throw new Error('GYP_MSVS_OVERRIDE_PATH requires GYP_MSVS_VERSION to ' +
                      'be set to a particular version (e.g. 2010e).');
    }
    return _createVersion(msvsVersion, overridePath, true);
  }

  version = String(version);
  const versions = _detectVisualStudioVersions(versionMap[version],
                                               /e/.test(version));
  if (versions.length === 0) {
    if (!allowFallback)
      throw new Error('Could not locate Visual Studio installation.');
    if (version === 'auto')
      // Default to 2005 if we couldn't find anything
      return _createVersion('2005')
    else
      return _createVersion(version);
  }

  return versions[0];
}

let vsVersion;
function getVSVersion(flags) {
  if (vsVersion)
    return vsVersion;
  vsVersion = selectVisualStudioVersion(flags['msvs_version'] || 'auto', false);
  return vsVersion;
}
win.getVSVersion = getVSVersion;

function _extractImportantEnvironment(outputOfSet) {
  /* Extracts environment variables required for the toolchain to run from
   * a textual dump output by the cmd.exe 'set' command.
   */
  const envvarsToSave = [
      'goma_.*', // TODO(scottmg): This is ugly, but needed for goma.
      'include',
      'lib',
      'libpath',
      'path',
      'pathext',
      'systemroot',
      'temp',
      'tmp'
  ];
  const env = {};
  // This occasionally happens and leads to misleading SYSTEMROOT error messages
  // if not caught here.
  if (!/=/.test(outputOfSet))
    throw new Error(`Invalid output_of_set. Value is:\n${outputOfSet}`);

  const lines = output_of_set.split(/\r\n|\r|\n/g);
  lines.forEach((line) => {
    envvarsToSave.some((envvar) => {
      if (line.toLowerCase().indexOf(envvar + '=') !== -1) {
        const [ v, setting ] = line.split('=', 2);
        env[v.toUpperCase()] = setting;
        return true;
      }
      return false;
    });
  });

  [ 'SYSTEMROOT', 'TEMP', 'TMP' ].forEach((required) => {
    if (!env[required]) {
      throw new Error(`Environment variable ${required} ` +
                      `required to be set to valid path`);
    }
  });

  return env;
}

function _formatAsEnvironmentBlock(envvarDict) {
  /* Format as an 'environment block' directly suitable for CreateProcess.
   * Briefly this is a list of key=value\0, terminated by an additional \0. See
   * CreateProcess documentation for more details.
   */
  let block = '';
  let nul = '\0';
  Object.keys(envvarDict).forEach((key) => {
    const value = envvarDict[key];
    block += key + '=' + value + nul;
  });
  block += nul;
  return block;
}

function _extractCLPath(outputOfWhere) {
  /* Gets the path to cl.exe based on the output of calling the environment
   * setup batch file, followed by the equivalent of `where`.
   */
  // Take the first line, as that's the first found in the PATH.
  const lines = outputOfWhere.trim().split(/\r\n|\r|\n/g);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^LOC:/.test(line))
      return line.slice(4).trim();
  }
}

// PORT: def GenerateEnvironmentFiles()
win.genEnvFiles = function genEnvFiles(outDir, flags) {
  /* It's not sufficient to have the absolute path to the compiler, linker,
   * etc. on Windows, as those tools rely on .dlls being in the PATH. We also
   * need to support both x86 and x64 compilers within the same build (to
   * support msvs_target_platform hackery). Different architectures require a
   * different compiler binary, and different supporting environment variables
   * (INCLUDE, LIB, LIBPATH). So, we extract the environment here, wrap all
   * invocations of compiler tools (cl, link, lib, rc, midl, etc.) via
   * win_tool.py which sets up the environment, and then we do not prefix the
   * compiler with an absolute path, instead preferring something like "cl.exe"
   * in the rule which will then run whichever the environment setup has put in
   * the path. When the following procedure to generate environment files does
   * not meet your requirement (e.g. for custom toolchains), you can pass
   * "-G ninja_use_custom_environment_files" to the gyp to suppress file
   * generation and use custom environment files prepared by yourself.
   */

  const archs = [ 'x86', 'x64' ];
  const vs = getVSVersion(flags);
  const clPaths = {};
  archs.forEach((arch) => {
    // Extract environment variables for subprocesses.
    let args = vs.setupScript(arch);
    args.push('&&', 'set');
    args = args.join(' ');
    // TODO(indutny): redirect stderr to stdout
    const variables = execSync(args);
    const env = _extractImportantEnvironment(variables)
    const envBlock = _formatAsEnvironmentBlock(env);

    fs.writeFileSync(path.join(outDir, 'environment.' + arch), envBlock);

    // Find cl.exe location for this architecture.
    args = vs.setupScript(arch);
    args.push('&&',
              'for', '%i', 'in', '(cl.exe)', 'do', '@echo', 'LOC:%~$PATH:i');
    args = args.join(' ');
    const output = execSync(args);
    clPaths[arch] = _extractCLPath(output);
  });
  return clPaths;
};
