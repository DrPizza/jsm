import fs from 'fs';
import path from 'path';
import util from 'util';
import worker from 'worker_threads';
import _ from 'lodash';
var cerealizer = require('../../cerealizer/');

const ser = new cerealizer.cerealizer();

process.nextTick(() => {
	let all_classes =
	[
		archiver, compiler, dynamic_library, executable, extension, external_dependency, filespec, filtered_map, header_only, linker, quintet, static_library,
		target, target_reference, tool, toolchain, workspace, Map
	];
	all_classes.map(clazz => {
		ser.make_class_serializable(clazz);
	});
});

class workspace {
	name: string;
	import_names: filtered_map<string>;
	imports: filtered_map<any>;
	defaults: any;
	component_names: filtered_map<string>;
	components: filtered_map<workspace>;
	targets: filtered_map<target>;

	root_directory: string;
	jsm_directory: string;
	workspace_directory: string;
	target_quintet: quintet;

	toolchains: toolchain[];
	properties: any;
	extensions: extension[];
	
	parent?: workspace;

	known_targets: Map<string, target>;
	edges        : Map<string, string[]>;
	build_order  : string[];

	all_files: Map<string, any>;

	constructor(obj: any) {
		this.name            = obj.name;
		this.import_names    = wrap_in_filter<string>(obj.imports || []);
		this.imports         = wrap_in_filter<any>([]);

		this.defaults        = obj.defaults || {};
		this.component_names = wrap_in_filter<string>(obj.components || []);
		this.components      = wrap_in_filter<any>([]);
		this.targets         = wrap_in_filter<string>(obj.targets || []).transform_all_elements_sync(make_target);

		this.root_directory      = process.cwd();
		this.jsm_directory       = __dirname;
		this.workspace_directory = process.cwd();

		this.target_quintet = new quintet('*:*:*:*:*');

		this.toolchains = [];
		this.properties = {};
		this.extensions = [];

		this.known_targets = new Map<string, target>();
		this.edges         = new Map<string, string[]>();
		this.build_order   = [];

		this.all_files  = new Map<string, any>();
	}

	parse(o: any): any {
		if(!Array.isArray(o)) {
			o = [o];
		}
		const parsed = o.map((obj: any) => {
			switch(obj.kind) {
			case 'workspace':
				return new workspace(obj);
			case 'toolchain':
				return add_toolchain(this, obj);
			case 'properties':
				return add_properties(this, obj);
			case 'external':
				return new external_dependency(obj);
			case 'extension':
				return add_extension(this, obj);
			case undefined:
			default:
				return obj;
			}
		});
		return parsed;
	} 

	load_imports() {
		return this.import_names.transform_matching_elements<any>(this.target_quintet, (filename: string) => {
			return this.load_file(this.resolve_filename(filename));
		});
	}

	resolve_filename(pth: string): string {
		// 'file://foo.jsm' -> filename: root_directory      / 'foo.jsm'
		// 'foo.jsm'        -> filename: workspace_directory / 'foo.jsm'
		if(pth.substr(0, 7) == 'file://') {
			return path.normalize(this.root_directory + '/' + pth.substr(7));
		} else if(pth.substr(0, 10) == 'builtin://') {
			return path.normalize(this.jsm_directory + '/../' + pth.substr(10));
		} else {
			return path.normalize(this.workspace_directory + '/' + pth);
		}
	}

	load_file(filename: string): any {
		if(this.all_files.has(filename)) {
			return this.all_files.get(filename)!;
		} else {
			const obj = this.parse(eval('(' + fs.readFileSync(filename, {encoding: 'utf-8'}) + ')'));
			this.all_files.set(filename, obj);
			return obj;
		}
	}

	fix_physical_locations() {
		const chosen_components = this.components.matching_elements(this.target_quintet);
		chosen_components.map((comp: workspace) => {
			comp.targets.matching_elements(this.target_quintet).map((t: target) => {
				t.physical_location = comp.workspace_directory;
			});
			comp.fix_physical_locations();
		});
	}

	collect_known_targets() {
		const chosen_components = this.components.matching_elements(this.target_quintet);
		chosen_components.map((comp: workspace) => {
			comp.collect_known_targets();
			comp.targets.matching_elements(this.target_quintet).map((t: target) => {
				this.known_targets.set(comp.name + ':' + t.name, t);
			});
		});
	}

	resolve_dependencies() {
		const chosen_components = this.components.matching_elements(this.target_quintet);
		chosen_components.map((comp: workspace) => {
			comp.resolve_dependencies();

			comp.targets.matching_elements(this.target_quintet).map((t: target) => {
				t.depends.matching_elements(this.target_quintet).map((r: target_reference) => {
					const k = r.component_name + ':' + r.target_name;
					if(this.known_targets.has(k)) {
						r.target = this.known_targets.get(k)!;

						if(!this.edges.has(k)) {
							this.edges.set(k, []);
						}
						this.edges.get(k)!.push(comp.name + ':' + t.name);
					} else {
						throw `target ${t.name} depends on ${k} which could not be resolved`;
					}
				});
			});
		});
	}

	resolve_all_dependencies(): void {
		this.fix_physical_locations();
		this.collect_known_targets();
		this.resolve_dependencies();
	}

	determine_build_order() {
		this.known_targets.forEach((t: target, k: string) => {
			if(!this.edges.has(k)) {
				this.edges.set(k, [] as string[]);
			}
		});

		const visited  = new Set<string>();
		const visiting = new Set<string>();
		var visit :(n:string) => void;
		visit = (n: string) => {
			if(visiting.has(n)) {
				throw `${n} is part of a cyclic dependency`;
			}
			if(visited.has(n)) {
				return;
			}
			visited.add(n);
			visiting.add(n);
			this.edges.get(n)!.map(visit);
			visiting.delete(n);
			this.build_order = [n].concat(this.build_order);
		};
		this.edges.forEach((value: string[], key: string) => {
			visit(key);
		});
	}
	
	resolve_all_external_dependencies(): void { // TODO
	}

	async load_component(component: string): Promise<workspace> {
		const filename = path.normalize(this.resolve_filename(component));
		const response = await new Promise((resolve: (value:any) => void, reject: (err: any) => void) => {
			const wrk: worker.Worker = new worker.Worker(__filename, {
				workerData: {
					'filename': filename,
					'target'  : this.target_quintet.as_raw_string(),
					'parent_workspace' : ser.serialize(this)
				}
			} as worker.WorkerOptions);

			wrk.on('message', resolve);
			wrk.on('error', reject);
			wrk.on('exit', (code: number) => {
				if(code !== 0) {
					reject(new Error('worker stopped with exit code ${code}'));
				}
			});
		});
		// <runs the fragment just below the class>
		// propagate cached items back into the parent cache
		const ws: workspace = ser.deserialize(response);

		Object.keys(ws.all_files).map(name => {
			if(!this.all_files.has(name)) {
				this.all_files.set(name, ws.all_files.get(name));
				ws.all_files.delete(name);
			}
		});
		this.all_files.set(filename, ws);
		ws.all_files = this.all_files;
		ws.parent = this;
		return ws;
	}

	async load_components() {
		return await this.component_names.transform_matching_elements(this.target_quintet, async (elem: string) => {
			return await this.load_component(elem);
		});
	}
}

if(!worker.isMainThread) {
	process.nextTick(async () => {
		const ws = await load_workspace(worker.workerData.filename, worker.workerData.target, ser.deserialize(worker.workerData.parent_workspace));
		worker.parentPort!.postMessage(ser.serialize(ws));
	});
}

class filespec {
	inclusions: string[];
	exceptions: string[];

	constructor(inclusions: string[], exceptions: string[]) {
		this.inclusions = inclusions;
		this.exceptions = exceptions;
	}
}

Object.defineProperty(Array.prototype, 'except', { value: function(exceptions: string[]): filespec {
	return new filespec(this, exceptions);
} });

class quintet {
	platform     : string;
	toolchain    : string;
	type         : string;
	arch         : string;
	configuration: string;

	constructor(quin: string) {
		const parts = quin.toString().split(':');
		if(parts.length != 5) {
			throw new Error(`bad quintet: ${quin.toString()}`);
		}
		this.platform = parts[0];
		this.toolchain = parts[1];
		this.type = parts[2];
		this.arch = parts[3];
		this.configuration = parts[4];
	}

	match(rhs: quintet): boolean {
		const check = function(left: string, right: string) {
			return left === right || left == '*' || right == '*';
		}
		return check(this.platform, rhs.platform)
			&& check(this.toolchain, rhs.toolchain)
			&& check(this.type, rhs.type)
			&& check(this.arch, rhs.arch)
			&& check(this.configuration, rhs.configuration);
	}

	as_raw_string(): string {
		return [this.platform, this.toolchain, this.type, this.arch, this.configuration].join(':');
	}
}

class tool {
	executable: string;
	flags     : filtered_map<string>;
	command   : filtered_map<string>;
	output    : filtered_map<name_map>;

	constructor(executable: string, flags: any, command: any, output: any) {
		this.executable = executable;
		this.flags      = wrap_in_filter<string>(flags || []);
		this.command    = wrap_in_filter<string>(command || []);
		this.output     = wrap_in_filter<name_map>(output || []);
	}

	generate_command(inputs: any) {
		return [''];
	}

	output_names(inputs: any) {
		return [''];
	}
}

class compiler extends tool {
	defines: filtered_map<string>;

	constructor(executable: string, flags: any, command: any, output: any, defines: any) {
		super(executable, flags, command, output);
		this.defines = wrap_in_filter<string>(defines);
	}
}

class linker extends tool {
	constructor(executable: string, flags: any, command: any, output: any) {
		super(executable, flags, command, output);
	}
}

class archiver extends tool {
	constructor(executable: string, flags: any, command: any, output: any) {
		super(executable, flags, command, output);
	}
}

class toolchain {
	name    : quintet[];
	compiler: compiler;
	linker  : linker;
	archiver: archiver;

	constructor(spec: any) {
		var options = {
			'name': '',

			'compiler_name': '',
			'compiler_flags': {},
			'compiler_command': {},
			'compiler_output': {},
			'defines': [] as any[],

			'linker_name': '',
			'linker_flags': {},
			'linker_command': {},
			'linker_output': {},

			'archiver_name': '',
			'archiver_flags': {},
			'archiver_command': {},
			'archiver_output': {},
		};
		Object.assign(options, spec);
		this.name = ((Array.isArray(options.name) ? options.name : [options.name]) as string[]).map((val: string) => new quintet(val)) ;

		this.compiler = new compiler(options.compiler_name, options.compiler_flags, options.compiler_command, options.compiler_output, options.defines);
		this.linker   = new linker  (options.linker_name  , options.linker_flags  , options.linker_command  , options.linker_output                   );
		this.archiver = new archiver(options.archiver_name, options.archiver_flags, options.archiver_command, options.archiver_output                 );
	}

	is_applicable(target_quintet: quintet) {
		return this.name.some(quin => target_quintet.match(quin));
	}
}

function add_toolchain(ws: workspace, obj: any) {
	var tc = new toolchain(obj);
	ws.toolchains.push(tc);
	return tc;
}

function add_properties(ws: workspace, obj: any) {
	return Object.assign(ws.properties, obj);
}

class target_reference {
	component_name: string;
	target_name   : string;
	target        : target | null;

	constructor(ref: string) {
		const parts = ref.split(':');
		this.component_name = parts[0];
		this.target_name    = parts[1];
		this.target = null;
	}
}

// class name_map {

// }

type name_map = object;

class target {
	name     : string;
	namespace: string;

	exported_headers  : filtered_map<name_map>;
	headers           : filtered_map<string | filespec>;
	srcs              : filtered_map<string | filespec>;
	depends           : filtered_map<target_reference>;
	external_deps     : filtered_map<external_dependency>;
	physical_location!: string;

	constructor(spec: any) {
		var options = {
			'name': '',
			'namespace': '',
			'exported_headers': [] as any[],
			'headers': [] as any[],
			'srcs' : [] as any[],
			'depends': [] as any[],
			'external_deps': [] as any[]
		};

		Object.assign(options, spec);
		
		this.name      = options.name;
		this.namespace = options.namespace;

		this.exported_headers = wrap_in_filter<name_map>(options.exported_headers);
		this.headers          = wrap_in_filter<string | filespec>(options.headers);
		this.srcs             = wrap_in_filter<string | filespec>(options.srcs);
		this.depends          = wrap_in_filter<string>(options.depends)      .transform_all_elements_sync(create_regular_object(target_reference   ));
		this.external_deps    = wrap_in_filter<string>(options.external_deps).transform_all_elements_sync(create_regular_object(external_dependency));

//		this.physical_location = location;
	}
}

class executable extends target {
	constructor(spec: any) {
		super(spec);
	}
}

class dynamic_library extends target {
	constructor(spec: any) {
		super(spec);
	}
}

class static_library extends target {
	constructor(spec: any) {
		super(spec);
	}
}

class header_only extends target {
	constructor(spec: any) {
		super(spec);
	}
}

function make_target(obj: any): target {
	switch(obj.type) {
	case 'executable':
		return new executable(obj);
	case 'dynamic':
		return new dynamic_library(obj);
	case 'static':
		return new static_library(obj);
	case 'header_only':
		return new header_only(obj);
	default:
		throw `unknown target type ${obj.type}`;
	}
}

class extension {
	name   : string;
	resolve: string; //(ext: external_dependency) => any;

	constructor(spec: any) {
		this.name    = spec.name;
		this.resolve = spec.resolve.toString();
	}
}

function add_extension(ws: workspace, obj: any) {
	var ext = new extension(obj);
	ws.extensions.push(ext);
	return ext;
}

class external_dependency {
	name   : string;
	version: string;
	type   : string;

	constructor(spec: any) {
		this.name    = spec.name;
		this.version = spec.version;
		this.type    = spec.type;
	}
}

function create_regular_object(clazz: Function) {
	return function(elem: string) {
		return Reflect.construct(clazz, [elem]);
	}
}

class filtered_map<V> extends Map<quintet, V[]> {
	static make<V>(spec: {[s:string]: V[]}) {
		return new filtered_map<V>(Array.from(Object.entries(spec)).map((value: [string, V[]]) => {
			return [new quintet(value[0]), value[1]] as [quintet, V[]];
		}));
	}

	constructor(...args: any) {
		super(...args);
	}

	matching_elements(quin: quintet): V[] {
		return Array.from(this.keys()).filter((pattern: quintet) => {
			return quin.match(pattern);
		}).map((value: quintet) => {
			return this.get(value)!;
		}).flat();
	}

	async transform_matching_elements<U>(quin: quintet, fn: (elem: V) => Promise<U>) {
		let updated = new filtered_map<U>();
		
		await Promise.all(Array.from(this.keys()).filter((pattern: quintet) => {
			return quin.match(pattern);
		}).map(async (pattern: quintet) => {
			const updates = await Promise.all(this.get(pattern)!.map(fn));
			updated.set(pattern, updates);
		}));
		return updated;
	}

	async transform_all_elements<U>(fn: (elem: V) => Promise<U>) {
		return await this.transform_matching_elements(new quintet('*:*:*:*:*'), fn);
	}
	
	transform_matching_elements_sync<U>(quin: quintet, fn: (elem: V) => U): filtered_map<U> {
		let updated = new filtered_map<U>();
		
		Array.from(this.keys()).filter((pattern: quintet) => {
			return quin.match(pattern);
		}).map((pattern: quintet) => {
			const updates = this.get(pattern)!.map(fn);
			updated.set(pattern, updates);
		});
		return updated;
	}

	transform_all_elements_sync<U>(fn: (elem: V) => U): filtered_map<U> {
		return this.transform_matching_elements_sync(new quintet('*:*:*:*:*'), fn);
	}
}

function wrap_in_filter<V>(obj: any): filtered_map<V> {
	if(obj === undefined) {
		obj = {
			'*:*:*:*:*': []
		};
	}
	if(obj instanceof filespec) {
		obj = [obj];
	}
	if(Array.isArray(obj)) {
		obj = {
			'*:*:*:*:*': obj
		};
	}
	for(let prop in obj) {
		if(!Array.isArray(obj[prop])) {
			obj[prop] = [obj[prop]];
		}
	}
	return filtered_map.make<V>(obj);
}

async function load_workspace(absolute_file_name: string, target: string, parent_workspace?: workspace) {
	var ws = new workspace({ 'name': '' });
	ws.all_files           = new Map<string, any>();
	if(parent_workspace) {
		ws.root_directory = parent_workspace.root_directory;
		ws.jsm_directory  = parent_workspace.jsm_directory;
		ws.workspace_directory = path.dirname(absolute_file_name);
	} else {
		ws.root_directory      = process.cwd();
		ws.jsm_directory       = __dirname;
		ws.workspace_directory = process.cwd();
	}

	const loaded = ws.load_file(absolute_file_name);
	
	if(loaded == null || loaded[0] == null || !(loaded[0] instanceof workspace) || loaded.length != 1) {
		throw new Error('expected a single workspace definition');
	}
	if(parent_workspace) {
		_.merge(ws, loaded[0]);
		ws.workspace_directory = path.dirname(absolute_file_name);
	} else {
		const all_files = ws.all_files;
		ws = loaded[0];
		if(ws == null) {
			throw new Error('expected a single workspace definition');
		}
		ws.all_files = all_files;
		ws.target_quintet = new quintet(target);
	}
	ws.imports = await ws.load_imports();
	ws.components = await ws.load_components();
	return ws;
}

module.exports.jsm = async function(absolute_file_name: string, target: string) {
	try {
		const ws = await load_workspace(absolute_file_name, target);
		
		ws.resolve_all_dependencies();
		ws.determine_build_order();
		ws.resolve_all_external_dependencies();

		// console.log(util.inspect(ws.known_targets, false, 4, true));
		console.log(util.inspect(ws, false, 4, true));
		console.log(ws.build_order);
		return ws;
	} catch(e) {
		console.log(`exception: ${e}`);
		console.log(e.stack);
		return null;
	}
}
