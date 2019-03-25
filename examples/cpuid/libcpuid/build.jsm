{
	"kind": "workspace",
	"name": "//libcpuid",
	"imports": [],
	"targets": [
		{
			"kind"            : "target",
			"name"            : "libcpuid",
			"type"            : "static",
			"namespace"       : "cpuid",
			"exported_headers": [
				{ "include/cpuid/cpuid.hpp"   : "cpuid.hpp"   },
				{ "include/cpuid/suffixes.hpp": "suffixes.hpp"}
			],
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
				"//libcpuid:libcpuid"
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
