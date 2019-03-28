{
	"kind": "extension",
	"type": "package-manager",
	"name": "vcpkg",
	"quintets": ["*:*:*:*:*"],
	"language": "javascript",
	"resolve": function(host /*: host_environment */, ext /*: external_dependency*/) {
		const path = require("path");
		const fs = require("fs");
//		const fg = require("fg");
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
		if(provided_version.match(version_filter)) {
			let result = {};
			switch(ext.type) {
			case "dynamic":
				result["bin_dir"] = {
					"win32:msvc:*:x64:release": [ dep_path + path.sep + "bin" + path.sep],
					"win32:msvc:*:x64:debug"  : [ dep_path + path.sep + "debug" + path.sep + "bin" + path.sep],
				};
				result["bin_files"] = {
					"win32:msvc:*:*:*": [ "*.dll" ],
				};
			case "static":
				result["lib_dir"] = {
					"win32:msvc:*:x64:release": [ dep_path + path.sep + "lib" + path.sep],
					"win32:msvc:*:x64:debug"  : [ dep_path + path.sep + "debug" + path.sep + "lib" + path.sep],
				};
				result["lib_files"] = {
					"win32:msvc:*:*:*": [ "*.lib" ],
				};
			case "header-only":
				result["header_dir"] = {
					"win32:msvc:*:x64:*": [ dep_path + path.sep + "include" ],
				};
			}
			return result;
		} else {
			return null;
		}
	}
}
