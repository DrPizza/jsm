{
	"kind": "workspace",
	"targets": [
		{
			"kind"   : "target",
			"name"   : "cpuid",
			"type"   : "executable",
			"headers": "src/**/*.hpp",
			"sources": "src/**/*.cpp",
			"depends": [
				"//libcpuid",
				"//docopt"
			],
			"external_deps"   : {
				"*:*:*:*:*": [
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
			"kind"   : "target",
			"name"   : "cpuid-test",
			"type"   : "executable",
			"headers": [],
			"srcs"   : ["test/**/*.cpp"],
			"depends": [
				"//cpuid:cpuid"
			],
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
		}
	]
}
