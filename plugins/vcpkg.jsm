[
	{
		'kind'      : 'properties',
		'vcpkg_root': 'c:/code/projects/vcpkg/'
	},
	{
		'kind': 'extension',
		'name': 'vcpkg',
		'language': 'javascript',
		'resolve': function(env /*: host_environment */, ext /*: external_dependency*/) {
			const path = require('path');
			const fs = require('fs');
			const vcpkg_root  = path.normalize(env.lookup('vcpkg.root'));
			let chosen_triple = env.lookup('vcpkg.triple');
			let dep_path      = vcpkg_root + 'packages' + path.sep + ext.name + '_' + chosen_triple;
			if(!fs.existsSync(dep_path)) {
				return null;
			}
			let control       = fs.readFileSync(dep_path + path.sep + 'CONTROL', {encoding: 'utf-8'}).split(/\n/);
			let provided_version = control.filter(line => {
				return /Version: /.test(line);
			}).map(line => {
				return line.replace(/Version: /, '');
			}).reduce((acc, current) => {
				return current;
			}, 'unknown-version');
			let version_filter = ext.version.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.?');
			if(provided_version.match(version_filter)) {
				let result = {};
				switch(ext.type) {
				case 'dynamic':
					result['bin'] = {
						'win32:msvc:*:x64:release': dep_path + path.sep + 'bin',
						'win32:msvc:*:x64:debug'  : dep_path + path.sep + 'debug' + path.sep + 'bin',
					};

				case 'static':
					result['lib'] = {
						'win32:msvc:*:x64:release': dep_path + path.sep + 'lib',
						'win32:msvc:*:x64:debug'  : dep_path + path.sep + 'debug' + path.sep + 'lib',
					};
				case 'header-only':
					result['headers'] = {
						'win32:msvc:*:x64:*': dep_path + path.sep + 'include',
					};
				}
				return result;
			} else {
				return null;
			}
		}
	}
]
