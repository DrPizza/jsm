{
	"kind": "workspace",
	"imports": [],
	"targets": [
		{
			"kind"            : "target",
			"name"            : "libcpuid",
			"type"            : "static",
			"exports"         : {
				"headers": [
					{ "include/cpuid/cpuid.hpp"   : "cpuid/cpuid.hpp"   },
					{ "include/cpuid/suffixes.hpp": "cpuid/suffixes.hpp"}
				],
				"defines": [],
				"compiler_flags": [],
				"linker_flags": []
			},
			"headers"         : "src/**/*.hpp",
			"sources"         : {
				"*:*:*:*:*": [
					{
						"srcs"          : ["src/**/*.cpp"],
						"excludes"      : "src/**/stdafx.cpp",
						"compiler_flags": {
							"msvc:*:*:*:*": [ "/Yustdafx.hpp", "/Fplibcpuid.pch" ]
						}
					}
				],
				"*:msvc:*:*:*": [
					{
						"srcs"          : "src/**/stdafx.cpp",
						"compiler_flags": ["/Ycstdafx.hpp", "/Fplibcpuid.pch" ]
					}
				]
			},
			"external_deps"   : {
				"*:*:*:*:*": [
					{
						"kind"     : "external",
						"name"     : "ms-gsl",
						"version"  : "*",
						"type"     : "header-only",
						"providers": "vcpkg"
					},
					{
						"kind"     : "external",
						"name"     : "boost-xpressive",
						"version"  : "1.69.0",
						"type"     : "header-only",
						"providers": ["system", "vcpkg" ]
					},
					{
						"kind"     : "external",
						"name"     : "fmt",
						"version"  : "5.3.0",
						"type"     : "static",
						"providers": "*"
					}
				],
				"linux:*:*:*:*": [
					{
						"kind"     : "external",
						"name"     : "pthreads",
						"type"     : "static",
						"providers": "system"
					}
				]
			}
		},
		{
			"kind"         : "target",
			"name"         : "libcpuid-test",
			"type"         : "executable",
			"headers"      : "test/**/*.hpp",
			"sources"      : "test/**/*.cpp",
			"depends": [
				":libcpuid"
			],
			"external_deps": [ {
				"kind"   : "external",
				"name"   : "gtest",
				"version": "2019-01-04-1",
				"type"   : "static",
				"providers": "vcpkg"
			} ]
		}
	]
}
