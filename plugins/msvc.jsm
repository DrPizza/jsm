{
	'kind'    : 'toolchain',
	'name'    : ['win32:msvc:*:x64:*','uwp:msvc:*:x64:*'],

	'defines': {
		'*:msvc:*:x64:*'    : ['X64'],
		'*:msvc:*:*:*'      : ['UNICODE', '_UNICODE', 'WIN32'],
		'*:msvc:*:*:debug'  : ['DEBUG', '_DEBUG'],
		'*:msvc:*:*:release': ['NDEBUG'],
		'*:msvc:static:*:*' : ['_LIB'],
		'*:msvc:dynamic:*:*': ['_DLL']
	},
	'compiler_name' : 'cl.exe',
	'compiler_flags': {
		'*:msvc:*:*:*'         : ['/nologo', '/guard:cf', '/sdl', '/diagnostics:caret', '/bigobj', '/W4', '/Wall', '/GF', '/Gm-', '/GS', '/Gy', '/EHsc', '/utf-8'],
		'*:msvc:*:*:debug'     : ['/Od', '/RTC1'],
		'*:msvc:*:*:release'   : ['/O2', '/Ob2', '/GL', '/MP', '/Gw'],
		'*:msvc/static:*:*:debug'   : ['/MTd'],
		'*:msvc/static:*:*:release' : ['/MT'],
		'*:msvc/dynamic:*:*:debug'  : ['/MDd'],
		'*:msvc/dynamic:*:*:release': ['/MD'],
		'*:msvc:static:*:*'    : ['/Z7'],
		'*:msvc:dynamic:*:*'   : ['/Zi'],
		'*:msvc:executable:*:*': ['/Zi']
	},
	// for each dir with source files in it, execute this:
	'compiler_command': {
		'win32:msvc:*:*:*': '${compiler} ${defines} ${includes} ${compiler-flags} /Fo${object-dir}%{relative-path} /c ${source}'
	},
	'compiler_output': {
		'*:msvc:*:*:*': [
			{'**/*.cpp': '**/*.obj'}, // src-dir/path/to/file.cpp -> object-dir/path/to/file.obj
			{'**/*.c'  : '**/*.obj'}
		],
		'win32:msvc:dynamic:*:*'   : [ { '': 'vc141.pdb' } ], // for files generated at the target level, rather than on a per-file basis
		'win32:msvc:executable:*:*': [ { '': 'vc141.pdb' } ]
	},

	'linker_name': 'link.exe',
	'linker_flags': {
		'*:msvc:*:*:*'       : ['/nologo', '/debug:full', '/guard:cf', '/Gy', '/nxcompat', '/dynamicbase', '/manifest'],
		'*:msvc:*:x64:*'     : ['/largeaddressaware', '/highentropyva'],
		'*:msvc:*:*:release' : ['/LTCG', '/incremental:no', '/opt:icf', '/opt:ref'],
		'*:msvc:dynamic:*:*' : ['/DLL']
	},
	'linker_command'  : {
		'win32:msvc:executable:*:*': '${linker} /libpath:${lib-directories} ${linker-flags} ${libs} ${objects} /PDB:${output-dir}${target-name}.pdb /out:${output-dir}${target-name}.exe',
		'win32:msvc:dynamic:*:*'   : '${linker} /libpath:${lib-directories} ${linker-flags} ${libs} ${objects} /PDB:${output-dir}${target-name}.pdb /out:${output-dir}${target-name}.dll /implib:${binary-dir}${target-name}.lib'
	},
	'linker_output'   : {
		'win32:msvc:executable:*:*': [ { '': '${target-name}.exe' } ],
		'win32:msvc:dynamic:*:*'   : [ { '': '${target-name}.dll' } ]
	},

//	maybe
//	'naming_rules': {
//		'object': '%{filename}.obj', // or '%{filename}.o'
//		'static': '%{filename}.lib', // or 'lib%{filename}.a'
//		'dynamic': '%{filename}.dll', // or 'lib%{filename}.so
//		'executable': '%{filename}.exe', // or '%{filename}'
//	}

	'archiver_name': 'lib.exe',
	'archiver_flags': {
		'*:msvc:*:*:*' : ['/nologo']
	},
	'archiver_command': {
		'win32:msvc:static:*:*': '${archiver} ${archiver-flags} ${objects} /out:${output-dir}${target-name}.lib'
	},
	'archiver_output': {
		'win32:msvc:static:*:*': [ { '': '${target-name}.lib' } ]
	}
}
