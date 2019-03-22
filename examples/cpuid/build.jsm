{
	'kind': 'workspace',
	'name': '//cpuid-master',
	'imports': [
		'builtin://defaults.jsm',
		'builtin://plugins/msvc.jsm',
		'builtin://plugins/vcpkg.jsm',
		'file://vcpkg.properties.jsm'
	],
	'defaults': {
		'kind': 'properties',
		'configuration': 'debug',
		'architecture': 'x64',
		'targets': ['cpuid'],

		'defines': {
			'*:*:*:*:*': ['CPUID_VERSION=1'],
		},
		'compiler_flags': {
			'*:*:*:*:*'          : [],
			'*:msvc:*:*:*'       : [
				'/experimental:external', '/external:anglebrackets', '/external:templates-', '/external:W0',
				'/std:c++latest', '/permissive-', '/Zc:wchar_t', '/Zc:forScope', '/Zc:inline', '/Zc:rvalueCast',
				'/Zc:strictStrings', '/Zc:throwingNew', '/Zc:externConstexpr', '/Zc:__cplusplus', '/EHsc', '/GR',
				'/volatile:iso'
			],
			'*:msvc:*:*:debug'   : [],
			'*:msvc:*:*:release' : ['/Oi', '/Ot', '/arch:AVX2', '/Qpar'],
			'*:clang:*:*:*'      : ['-Wall', '-stdlib=libc++', '-std=gnu++2a'],
			'*:clang:*:*:debug'  : ['-g'],
			'*:clang:*:*:release': ['-O3', '-march=native'],
		},
	},
	'components': [
		'file://libcpuid/build.jsm',
		'file://docopt/build.jsm',
		'file://cpuid/build.jsm'
	]
}
