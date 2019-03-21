{
	'kind': 'workspace',
	'name': '//libcpuid',
	'imports': [],
	'targets': [
		{
			'kind'            : 'target',
			'name'            : 'libcpuid',
			'type'            : 'static',
			'namespace'       : 'cpuid',
			'exported_headers': [
				{ 'cpuid.hpp'   : 'include/cpuid/cpuid.hpp'   },
				{ 'suffixes.hpp': 'include/cpuid/suffixes.hpp'}
			],
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
						'providers': ['system', 'vcpkg' ]
					},
					{
						'kind'     : 'external',
						'name'     : 'fmt',
						'version'  : '5.3.0',
						'type'     : 'static',
						'providers': '*'
					}
				],
				'linux:*:*:*:*': [
					{
						'kind'     : 'external',
						'name'     : 'pthreads',
						'type'     : 'static',
						'providers': 'system'
					}
				],
			},
		},
	]
}
