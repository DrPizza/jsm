{
	"kind": "extension",
	"type": "package-manager",
	"name": "vcpkg",
	"quintets": ["*:*:*:*:*"],
	"language": "javascript",
	"required_properties": [
		"vcpkg.root",
		"vcpkg.triple"
	],
	"resolve": function(host /*: host_environment */, ext /*: external_dependency*/) {
		const path = require("path");
		const fs = require("fs");
		const semver = require("semver");
		const fg = require("fast-glob");
		const vcpkg_root  = path.normalize(host.lookup("vcpkg.root"));
		let chosen_triple = host.lookup("vcpkg.triple", "x64-windows-static"); // TODO calculate default triple from chosen target
		let dep_path      = vcpkg_root + "packages" + path.sep + ext.name + "_" + chosen_triple;
		if(!fs.existsSync(dep_path)) {
			return null;
		}
		let control          = fs.readFileSync(dep_path + path.sep + "CONTROL", {encoding: "utf-8"}).split(/\n/);
		let provided_version = control.filter(line => {
			return /Version: /.test(line);
		}).map(line => {
			return line.replace(/Version: /, "");
		}).reduce((acc, current) => {
			return current;
		}, "unknown-version");
		
		let version_filter = ext.version.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".?");
		if(semver.validRange(ext.version) && semver.valid(provided_version)) {
			if(!semver.satisfies(provided_version, ext.version)) {
				return null;
			}
		} else if(!provided_version.match(version_filter)) {
			return null;
		}
		
		let result = {};
		switch(ext.type) {
		case "dynamic":
			{
				result["bin.directory"] = {
					"win32:msvc:*:x64:release": [ dep_path + path.sep + "bin" + path.sep],
					"win32:msvc:*:x64:debug"  : [ dep_path + path.sep + "debug" + path.sep + "bin" + path.sep],
				};
				let release_files = fg.sync("*.dll", { cwd: result["bin.directory"]["win32:msvc:*:x64:release"][0] });
				let debug_files   = fg.sync("*.dll", { cwd: result["bin.directory"]["win32:msvc:*:x64:debug"  ][0] });
				result["bin.files"] = {
					"win32:msvc:*:*:release": release_files,
					"win32:msvc:*:*:debug"  : debug_files,
				};
			}
		case "static":
			{
				result["lib.directory"] = {
					"win32:msvc:*:x64:release": [ dep_path + path.sep + "lib" + path.sep],
					"win32:msvc:*:x64:debug"  : [ dep_path + path.sep + "debug" + path.sep + "lib" + path.sep],
				};
				let release_files = fg.sync("*.lib", { cwd: result["lib.directory"]["win32:msvc:*:x64:release"][0] });
				let debug_files   = fg.sync("*.lib", { cwd: result["lib.directory"]["win32:msvc:*:x64:debug"  ][0] });
				result["lib.files"] = {
					"win32:msvc:*:*:release": release_files,
					"win32:msvc:*:*:debug"  : debug_files  ,
				};
			}
		case "header-only":
			result["header.directory"] = {
				"win32:msvc:*:x64:*": [ dep_path + path.sep + "include" ],
			};
		}
		return result;
	}
}
