{
	'kind'          : 'properties',
	'configurations': ['debug', 'release'],
	'architectures' : ['x86', 'x64'],
	'paths': {
		'object_directory': '//obj/${architecture}/${configuration}/%{target-name}/',
		'output_directory': '//bin/${architecture}/${configuration}/%{target-name}/'
	}
}
