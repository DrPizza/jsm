{
	'kind': 'workspace',
	'name': '//docopt',
	'imports': [],
	'targets': [
		{
			'kind'            : 'target',
			'name'            : 'docopt',
			'type'            : 'static',
			'namespace'       : 'docopt',
			'exported_headers': [ { 'docopt.hpp'  : 'include/docopt/docopt.hpp' } ],
			'headers'         : ['src/**/*.hpp'].except(['src/**/stdafx.hpp']),
			'srcs'            : ['src/**/*.cpp'].except(['src/**/stdafx.cpp']),
			'external_deps'   : {
				'*:*:*:*:*': [
					{
						'kind'     : 'external',
						'name'     : 'ms-gsl',
						'version'  : '*',
						'type'     : 'header-only',
						'providers': 'vcpkg'
					},
					{
						'kind'     : 'external',
						'name'     : 'boost-xpressive',
						'version'  : '1.69.0',
						'type'     : 'header-only',
						'providers': 'vcpkg'
					},
				],
			},
		},
	]
}
