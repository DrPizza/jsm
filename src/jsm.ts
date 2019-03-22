import fs from 'fs';
import path from 'path';
import util from 'util';
import worker from 'worker_threads';
import _ from 'lodash';
var cerealizer = require('../../cerealizer/');

const ser = new cerealizer.cerealizer();

Object.defineProperty(Array.prototype, 'unique', {
	value: function<T>(compare?: (a: T, b: T) => number, fuse?: (a: T, b: T) => T): Array<T> {
		compare = compare || function (l: T, r: T) {
			return l < r ? -1
			     : l > r ?  1
			     :          0;
		};
		fuse = fuse || function(l: T, r: T) {
			return l;
		};
		let limit = this.length;
		for(let i = 0; i < limit - 1; ) {
			if(0 == compare(this[i], this[i + 1])) {
				this[i] = fuse(this[i], this[i + 1]);
				this.splice(i + 1, 1);
				--limit;
			} else {
				++i;
			}
		}
		return this;
	}
});

process.nextTick(() => {
	let all_classes =
	[
		archiver, compiler, dynamic_library, executable, extension, external_dependency, filespec, filtered_map, header_only, linker, quintet_part, quintet,
		static_library, target, target_reference, tool, toolchain, workspace, Map
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

	known_targets  : Map<string, target>;
	known_externals: Map<string, external_dependency>;
	edges          : Map<string, string[]>;
	build_order    : string[];

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

		this.known_targets   = new Map<string, target>();
		this.known_externals = new Map<string, external_dependency>();
		this.edges           = new Map<string, string[]>();
		this.build_order     = [];

		this.all_files  = new Map<string, any>();
	}

	calculate_default_target() {
		// TODO platform dependent
		let platform      = this.defaults.platform || 'win32';
		let toolchain     = this.defaults.toolchain || 'msvc/static';
		let type          = '*';
		let architecture  = this.defaults.architecture || 'x64';
		let configuration = this.defaults.configuration || 'debug';
		
		return new quintet(`${platform}:${toolchain}:${type}:${architecture}:${configuration}`);
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
		let targs = new Map<string, target>();
		const chosen_components = this.components.matching_elements(this.target_quintet);
		chosen_components.map((comp: workspace) => {
			for(let targ of comp.collect_known_targets()) {
				targs.set(targ[0], targ[1]);
			}
			comp.targets.matching_elements(this.target_quintet).map((t: target) => {
				targs.set(comp.name + ':' + t.name, t);
			});
		});
		return targs;
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
		this.known_targets = this.collect_known_targets();
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
	
	collect_external_dependencies() {
		let exts = new Map<string, external_dependency>();
		const chosen_components = this.components.matching_elements(this.target_quintet);
		chosen_components.map((comp: workspace) => {
			for(let ext of comp.collect_external_dependencies()) {
				exts.set(ext[0], ext[1]);
			}
			comp.targets.matching_elements(this.target_quintet).map((t: target) => {
				t.external_deps.matching_elements(this.target_quintet).map((e: external_dependency) => {
					const key = `${e.name}::${e.version}`;
					if(!exts.has(key)) {
						exts.set(key, e);
					} else {
						const existing = exts.get(key)!;
						existing.providers.merge(e.providers);
						e.providers = existing.providers;
						exts.delete(key);
						exts.set(key, existing);
					}
				});
			});
		});
		return exts;
	}
	
	resolve_all_external_dependencies(): void {
		this.known_externals = this.collect_external_dependencies();
		
		let host_env = {
			lookup: (s: string, dflt?: string) => {
				switch(s) {
				case 'target':
					return this.target_quintet.as_raw_string();
				default:
					if(this.properties.hasOwnProperty(s)) {
						return this.properties[s];
					} else if(dflt) {
						return dflt;
					} else {
						throw new Error(`could not find property ${s}`);
					}
				}
			}
		};
		
		this.known_externals.forEach((dep: external_dependency) => {
			const provs = dep.providers.matching_elements(this.target_quintet);
			this.extensions.forEach((ext: extension) => {
				if(provs.some((prov: string) => { return prov == ext.name || prov == '*'; })) {
					let resolution = ext.resolve(host_env, dep, this.target_quintet);
					if(resolution) {
						dep.resolution = Object.assign(new external_resolution(), resolution);
					}
				}
			});
		});
		let missing : string[] = [];
		this.known_externals.forEach((dep: external_dependency) => {
			if(dep.resolution === null) {
				if(!dep.optional) {
					missing.push(`${dep.name}::${dep.version}`);
				}
			}
		});
		if(missing.length > 0) {
			throw new Error(`unresolved dependencies: ${missing}`);
		}
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
		return this.component_names.transform_matching_elements(this.target_quintet, async (elem: string) => {
			return this.load_component(elem);
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

class quintet_part {
	major: string;
	minor: string;
	parts: string[];
	
	constructor(part: string) {
		this.parts = part.split('/');
		if(this.parts.length > 2) {
			throw new Error(`bad quintet fragment: ${part}`);
		}
		this.major = this.parts[0];
		this.minor = this.parts.length == 2 ? this.parts[1] : '*';
	}
	
	match(rhs: quintet_part) : boolean {
		if(this.major == '*' || rhs.major == '*') {
			return true;
		}
		if(this.major == rhs.major) {
			if(this.minor == '*' || rhs.minor == '*') {
				return true;
			}
			return this.minor == rhs.minor;
		}
		return false;
	}
	
	as_raw_string(): string {
		return this.parts.join('/');
	}
	
	toString() : string { return this.as_raw_string(); }
	
	static compare(l: quintet_part, r: quintet_part) : number {
		const sl = l.as_raw_string(), sr = r.as_raw_string();
		return sl < sr ? -1
		     : sl > sr ?  1
		     :            0;
	}
}

class quintet {
	platform     : quintet_part;
	toolchain    : quintet_part;
	type         : quintet_part;
	arch         : quintet_part;
	configuration: quintet_part;
	parts        : quintet_part[];

	constructor(quin: string) {
		let raw_parts = quin.toString().split(':');
		if(raw_parts.length != 5) {
			throw new Error(`bad quintet: ${quin.toString()}`);
		}
		this.parts = raw_parts.map((p: string) => {
			return new quintet_part(p);
		});
		this.platform      = this.parts[0];
		this.toolchain     = this.parts[1];
		this.type          = this.parts[2];
		this.arch          = this.parts[3];
		this.configuration = this.parts[4];
	}

	match(rhs: quintet): boolean {
		for(let i = 0; i < 5; ++i) {
			if(!this.parts[i].match(rhs.parts[i])) {
				return false;
			}
		}
		return true;
	}

	as_raw_string(): string {
		return this.parts.map((p: quintet_part) => { return p.as_raw_string(); }).join(':');
	}
	
	toString() : string { return this.as_raw_string(); }
	
	static compare(l: quintet, r: quintet) : number {
		for(let i = 0; i < 5; ++i) {
			let cmp = quintet_part.compare(l.parts[i], r.parts[i]);
			if(cmp != 0) {
				return cmp;
			}
		}
		return 0;
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
	language: string;
	// TODO: different types of extension that offer different verbs
	resolve: (env: any, ext: external_dependency, target: quintet) => any;

	constructor(spec: any) {
		this.name     = spec.name;
		this.language = spec.language || 'javascript';
		this.resolve  = spec.resolve;
	}
}

function add_extension(ws: workspace, obj: any) {
	var ext = new extension(obj);
	ws.extensions.push(ext);
	return ext;
}

class external_resolution {
	headers?: filtered_map<string>;
	lib?: filtered_map<string>;
	bin?: filtered_map<string>;
}

class external_dependency {
	name      : string;
	version   : string;
	type      : string;
	providers : filtered_map<string>;
	optional  : boolean;
	resolution: external_resolution | null;

	constructor(spec: any) {
		this.name       = spec.name;
		this.version    = spec.version;
		this.type       = spec.type;
		this.optional   = (spec.optional === undefined) ? false : spec.optional;
		this.providers  = wrap_in_filter<string>(spec.providers);
		this.resolution = null;
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
	
	static merge<V>(a: filtered_map<V>, b: filtered_map<V>): filtered_map<V> {
		return new filtered_map<V>(a.entries()).merge(b);
	}

	constructor(...args: any) {
		super(...args);
	}

	merge(b: filtered_map<V>) {
		let comparison = (l: [quintet, V[]], r: [quintet, V[]]) : number => {
			return quintet.compare(l[0], r[0]);
		};
		let fuse = (l: [quintet, V[]], r: [quintet, V[]]) : V[] => {
			//@ts-ignore
			return [l[0], [...l[1], ...r[1]].sort().unique()];
		};
		// @ts-ignore
		let combined = [...this, ...b].sort(comparison).unique(comparison, fuse);
		this.clear();
		combined.forEach((value: [quintet, V[]]) => {
			this.set(value[0], value[1]);
		});
		return this;
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
	if(typeof obj === 'string' || obj instanceof filespec) {
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

async function load_workspace(absolute_file_name: string, target?: string, parent_workspace?: workspace) {
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
	
	const all_files = ws.all_files;
	ws = loaded[0];
	ws.all_files = all_files;
	
	ws.target_quintet = target ? new quintet(target) : ws.calculate_default_target();
	ws.imports = await ws.load_imports();
	ws.components = await ws.load_components();
	return ws;
}

module.exports.jsm = async function(absolute_file_name: string, target?: string) {
	try {
		const ws = await load_workspace(absolute_file_name, target);

		ws.resolve_all_dependencies();
		ws.determine_build_order();
		ws.resolve_all_external_dependencies();

// console.log('after dependency resolution');
// console.log(util.inspect(ws, false, 12, true));

		console.log(ws.build_order);
		console.log(ws.known_externals);
		return ws;
	} catch(e) {
		console.log(`exception: ${e}`);
		console.log(e.stack);
		return null;
	}
}
