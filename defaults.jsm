{
	'kind'          : 'properties',
	'configurations': ['debug', 'release'],
	'architectures' : ['x86', 'x64'],
	'object.directory': '//obj/${architecture}/${configuration}/%{target-name}/',
	'output.directory': '//bin/${architecture}/${configuration}/%{target-name}/'
}
