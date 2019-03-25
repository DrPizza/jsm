{
	"kind": "workspace",
	"name": "//docopt",
	"imports": [],
	"targets": [
		{
			"kind"            : "target",
			"name"            : "docopt",
			"type"            : "static",
			"namespace"       : "docopt",
			"exported_headers": [ { "include/docopt/docopt.hpp": "docopt.hpp" } ],
			"headers"         : ["src/**/*.hpp"],
			"sources"         : ["src/**/*.cpp"],
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
						"providers": "vcpkg"
					}
				]
			}
		},
		{
			"kind"         : "target",
			"name"         : "docopt-test",
			"type"         : "executable",
			"headers"      : "test/src/**/*.hpp",
			"sources"      : "test/src/**/*.cpp",
			"depends": [
				"//docopt:docopt"
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
