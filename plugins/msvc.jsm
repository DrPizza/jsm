{
	"kind"    : "toolchain",
	"name"    : "microsoft c/c++ optimizing compiler",
	"quintets": ["win32:msvc:*:x64:*","uwp:msvc:*:x64:*"],

	"compiler/cxx.defines": {
		"*:*:*:*:*"         : ["TEST_XXX_YYY_ZZZ=1234"],
		"*:msvc:*:x64:*"    : ["X64"],
		"*:msvc:*:*:*"      : ["UNICODE", "_UNICODE", "WIN32"],
		"*:msvc:*:*:debug"  : ["DEBUG", "_DEBUG"],
		"*:msvc:*:*:release": ["NDEBUG"],
		"*:msvc:static:*:*" : ["_LIB"],
		"*:msvc:dynamic:*:*": ["_DLL"]
	},
	"compiler/cxx.name" : "cl.exe",
	"compiler/cxx.flags": {
		"*:msvc:*:*:*"         : ["/nologo", "/guard:cf", "/sdl", "/diagnostics:caret", "/bigobj", "/W4", "/Wall", "/GF", "/Gm-", "/GS", "/Gy", "/EHsc", "/utf-8"],
		"*:msvc:*:*:debug"     : ["/Od", "/RTC1"],
		"*:msvc:*:*:release"   : ["/O2", "/Ob2", "/GL", "/MP", "/Gw"],
		"*:msvc/static:*:*:debug"   : ["/MTd"],
		"*:msvc/static:*:*:release" : ["/MT"],
		"*:msvc/dynamic:*:*:debug"  : ["/MDd"],
		"*:msvc/dynamic:*:*:release": ["/MD"],
		"*:msvc:static:*:*"    : ["/Z7"],
		"*:msvc:dynamic:*:*"   : ["/Zi"],
		"*:msvc:executable:*:*": ["/Zi"]
	},
	// for each dir with source files in it, execute this:
	"compiler/cxx.command": {
		"win32:msvc:*:*:*": "${compiler/cxx.name} /D${compiler/cxx.defines} /I${include.directories} ${compiler/cxx.flags} /Fo${object.directory}%{source.relative-path} /c ${source.name}"
	},
	"compiler/cxx.name_mapping": {
		"*:msvc:*:*:*": [
			{ "**/*.cpp": "**/*.obj" }, // src-dir/path/to/file.cpp -> object-dir/path/to/file.obj
			{ "**/*.c"  : "**/*.obj" }
		],
		"win32:msvc:dynamic:*:*"   : [ { "": "vc141.pdb" } ], // for files generated at the target level, rather than on a per-file basis
		"win32:msvc:executable:*:*": [ { "": "vc141.pdb" } ]
	},

	"linker.name": "link.exe",
	"linker.flags": {
		"*:msvc:*:*:*"       : ["/nologo", "/debug:full", "/guard:cf", "/Gy", "/nxcompat", "/dynamicbase", "/manifest"],
		"*:msvc:*:x64:*"     : ["/largeaddressaware", "/highentropyva"],
		"*:msvc:*:*:release" : ["/LTCG", "/incremental:no", "/opt:icf", "/opt:ref"],
		"*:msvc:dynamic:*:*" : ["/DLL"]
	},
	"linker.command"  : {
		"win32:msvc:executable:*:*": "${linker.name} /libpath:${lib.directories} ${linker.flags} ${lib.name} ${object.name} /PDB:${output-dir}${target-name}.pdb /out:${output.directory}${target.name}.exe",
		"win32:msvc:dynamic:*:*"   : "${linker.name} /libpath:${lib.directories} ${linker.flags} ${lib.name} ${object.name} /PDB:${output-dir}${target-name}.pdb /out:${output.directory}${target.name}.dll /implib:${output.directory}${target.name}.lib"
	},
	"linker.name_mapping"   : {
		"win32:msvc:executable:*:*": [ { "": "*.exe" } ],
		"win32:msvc:dynamic:*:*"   : [ { "": "*.dll" } ]
	},

//	maybe
//	"naming_rules": {
//		"object": "%{filename}.obj", // or "%{filename}.o"
//		"static": "${targetname}.lib", // or "lib${targetname}.a"
//		"dynamic": "${targetname}.dll", // or "lib${targetname}.so
//		"executable": "${targetname}.exe", // or "${targetname}"
//	}

	"archiver.name": "lib.exe",
	"archiver.flags": {
		"*:msvc:*:*:*" : ["/nologo"]
	},
	"archiver.command": {
		"win32:msvc:static:*:*": "${archiver.name} ${archiver.flags} ${object.name} /out:${output.directory}${target.name}.lib"
	},
	"archiver.name_mapping": {
		"win32:msvc:static:*:*": [ { "{$object.name}": "*.lib" } ]
	}
}
