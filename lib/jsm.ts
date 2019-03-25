import fs from 'fs';
import path from 'path';
import util from 'util';
import worker from 'worker_threads';
import winston from 'winston';
import glob from 'fast-glob';
import * as yaserializer from 'yaserializer';

function get_call_location(): any {
	var stacklist = (new Error()).stack!.split('\n').slice(3).filter((value: string) => {
		return !value.includes('node_modules') && !value.includes('(internal/') && !value.includes('(events.js');
	});
	
	// stack trace format:
	// https://github.com/v8/v8/wiki/Stack%20Trace%20API
	// do not remove the regex expresses to outside of this method (due to a BUG in node.js)
	var stackReg = /at\s+(.*)\s+\((.*):(\d*):(\d*)\)/gi
	var stackReg2 = /at\s+()(.*):(\d*):(\d*)/gi

	var s = stacklist[0]
	var sp = stackReg.exec(s) || stackReg2.exec(s)

	if (sp && sp.length === 5) {
		return {
			method: sp[1],
			relativePath: path.relative(__dirname, sp[2]),
			line: sp[3],
			pos: sp[4],
			file: path.basename(sp[2]),
			stack: stacklist.join('\n')
		}
	}
}

const handler = {
	get (target: winston.Logger, p: PropertyKey, receiver: any): any {
		const levels = Reflect.get(target, 'levels');
		const fn_names = Array.from(Object.keys(levels));
		if(typeof p === 'string') {
			const call_info = get_call_location();
			const filename = `${call_info['file']}:${call_info['line']}:${call_info['pos']}`;
			const fn = call_info['method'];
			const tid = worker.threadId;
			if(fn_names.includes(p)) {
				return function(message: string) {
					if(message === '') { return '' };
					return (Reflect.get(target, 'log', receiver) as Function).apply(target, [{ message: message, level: String(p), filename: filename, func: fn, tid: tid }]);
				}
			} else if(p == 'log') {
				return function(entry: winston.LogEntry) {
					if(entry.message === '') { return '' };
					entry.filename = filename;
					entry.func = fn;
					entry.tid = tid;
					return (Reflect.get(target, p) as Function).apply(target, [entry]);
				}
			}
		}
		return Reflect.get(target, p, receiver);
	}
};

const logger = new Proxy(winston.createLogger({
	transports: [
		new winston.transports.Console({
			level: 'silly',
			format: winston.format.combine(
				winston.format.colorize({ all: true }),
				winston.format.prettyPrint({ colorize: true }),
				winston.format.timestamp(),
				winston.format.printf((info) => {
					const limit = 120;
					const escape = '\x1b['
					const lines : string[] = []
					const colour_on  = info.message.substring(info.message.indexOf(escape)    , info.message.indexOf('m', info.message.indexOf    (escape)) + 1);
					const colour_off = info.message.substring(info.message.lastIndexOf(escape), info.message.indexOf('m', info.message.lastIndexOf(escape)) + 1);
					info.message = info.message.substring(colour_on.length, info.message.length - colour_off.length);
					const indent_width = info.message.trimRight().length - info.message.trim().length;
					
					lines.push(info.message.substr(0, limit));
					info.message = info.message.substr(limit);
					while(info.message.length > (limit - indent_width)) {
						lines.push(info.message.substr(0, limit - indent_width));
						info.message = info.message.substr(limit - indent_width);
					}
					if(info.message.trim() !== '') {
						lines.push(info.message);
					}
					
					const head           = `[` + `${info.level}`.padStart(18) + ' ]' + ` ${info.timestamp}: `;
					const tail           = ` (at ${info.filename} (${info.tid}:${info.func}))`;
					const left_padding   = ' '.repeat(head.length - colour_on.length - colour_off.length);
					const right_padding  = ' '.repeat(tail.length);
					const indent_padding = ' '.repeat(indent_width);
					
					lines[0] = head + colour_on + lines[0].padEnd(120) + colour_off + tail;
					for(let i = 1; i < lines.length; ++i) {
						lines[i] = left_padding + indent_padding + colour_on + lines[i].padEnd(limit) + colour_off + right_padding;
					}
					return lines.join('\n');
				})
			)
		}),
		new winston.transports.File({
			filename: 'jsm.log',
			level: 'info',
			format: winston.format.combine(
				winston.format.colorize({ level: false }),
				winston.format.prettyPrint({ colorize: false }),
				winston.format.timestamp(),
				winston.format.printf((info) => {
					return `${info.level} ${info.timestamp}: ${info.message} (at ${info.filename} (${info.tid}:${info.func}))`;
				}),
			)
		})
	]
}), handler);

util.inspect.defaultOptions.compact = true;
util.inspect.defaultOptions.depth = 2;
util.inspect.defaultOptions.breakLength = 135;
util.inspect.defaultOptions.showHidden = true;
util.inspect.defaultOptions.colors = true;

function unique<T>(arr: T[], compare?: (a: T, b: T) => number, fuse?: (a: T, b: T) => T) : T[] {
	compare = compare || function (l: T, r: T) {
		return l < r ? -1
			 : l > r ?  1
			 :          0;
	};
	fuse = fuse || function(l: T, r: T) {
		return l;
	};
	let limit = arr.length;
	for(let i = 0; i < limit - 1; ) {
		if(0 == compare(arr[i], arr[i + 1])) {
			arr[i] = fuse(arr[i], arr[i + 1]);
			arr.splice(i + 1, 1);
			--limit;
		} else {
			++i;
		}
	}
	return arr;
}

const ser = new yaserializer.yaserializer();

@yaserializer.serializable
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
	
	parent: workspace | null;

	edges          : Map<target, target[]>;
	build_order    : target[];

	all_files: Map<string, any>;
	known_targets: Map<string, target>;

	constructor(obj: any) {
		this.name            = obj.name;
		this.import_names    = wrap_in_filter<string>(obj.imports || []);
		this.imports         = wrap_in_filter<any>([]);

		this.defaults        = obj.defaults || {};
		this.component_names = wrap_in_filter<string>(obj.components || []);
		this.components      = wrap_in_filter<workspace>([]);
		this.targets         = wrap_in_filter<target>(obj.targets || []).transform_all_elements_sync(make_target);
		this.targets.matching_elements(quintet.wildcard).forEach((t: target) => { t.parent = this; });

		this.root_directory      = process.cwd();
		this.jsm_directory       = __dirname;
		this.workspace_directory = process.cwd();

		this.target_quintet = new quintet('*:*:*:*:*');

		this.toolchains = [];
		this.properties = {};
		this.extensions = [];

		this.parent = null;

		this.known_targets   = new Map<string, target>();
		this.edges           = new Map<target, target[]>();
		this.build_order     = [];

		this.all_files  = new Map<string, any>();
	}

	calculate_default_target() {
		// TODO platform dependent
		let platform      = this.defaults.platform      || 'win32';
		let toolchain     = this.defaults.toolchain     || 'msvc/static';
		let type          = '*';
		let architecture  = this.defaults.architecture  || 'x64';
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

	resolve_dependencies(root: workspace, padding: string = '') {
		logger.verbose(`${padding}resolving internal dependencies for component ${this.name}`);
		
		this.targets.matching_elements(root.target_quintet).map((t: target) => {
			t.depends.matching_elements(root.target_quintet).map((r: target_reference) => {
				const k = r.component_name + ':' + r.target_name;
				logger.verbose(`${padding}  ${t.name} depends on ${k}`);
				if(root.known_targets.has(k)) {
					logger.verbose(`${padding}    found suitable build target for ${k}`);
					r.target = root.known_targets.get(k)!;

					if(!root.edges.has(r.target)) {
						root.edges.set(r.target, []);
					}
					root.edges.get(r.target)!.push(t);
				} else {
					throw new Error(`target ${t.name} depends on ${k} which could not be resolved`);
				}
			});
		});
		
		this.components.matching_elements(root.target_quintet).map((comp: workspace) => {
			comp.resolve_dependencies(root, padding + '    ');
		});
	}

	resolve_all_internal_dependencies() {
		const root = this;
		let collect_known_targets = function(ws: workspace) {
			let targs = new Map<string, target>();
			ws.targets.matching_elements(root.target_quintet).map((t: target) => {
				targs.set(ws.name + ':' + t.name, t);
			});
		
			ws.components.matching_elements(root.target_quintet).map((comp: workspace) => {
				for(let targ of collect_known_targets(comp)) {
					targs.set(targ[0], targ[1]);
				}
			});
			return targs;
		}
	
		this.known_targets = collect_known_targets(this);
		this.resolve_dependencies(this);
	}
	
	resolve_all_dependencies() {
		this.resolve_all_internal_dependencies();
		this.resolve_all_external_dependencies();
	}

	determine_build_order() {
		this.known_targets.forEach((t: target, k: string) => {
			if(!this.edges.has(t)) {
				this.edges.set(t, []);
			}
		});

		const visited  = new Set<target>();
		const visiting = new Set<target>();
		var visit : (n:target) => void;
		visit = (n: target) => {
			if(visiting.has(n)) {
				throw new Error(`${n} is part of a cyclic dependency`);
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
		this.edges.forEach((value: target[], key: target) => {
			visit(key);
		});
		return this.build_order;
	}
	
	resolve_all_external_dependencies(): void {
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
		
		let cache = new Map<string, external_dependency>();
		let root = this;
		const resolve_externals = function(ws: workspace, padding : string = '') {
			logger.verbose(`${padding}resolving external dependencies for component ${ws.name}`);
			
			ws.targets.matching_elements(root.target_quintet).map((t: target) => {
				t.external_deps.matching_elements(root.target_quintet).map((e: external_dependency) => {
					logger.verbose(`${padding}  ${t.name} depends on ${e.name}`);
					if(e.resolution === null) {
						let provs = e.providers.matching_elements(root.target_quintet);
						provs.map((p: string) => {
							const key = `${p}::${e.name}::${e.version}`;
							if(cache.has(key)) {
								e.resolution = cache.get(key)!.resolution;
								logger.verbose(`${padding}    ${key} for ${t.name} in ${ws.name} resolved from cache`);
							} else {
								root.extensions.filter((ext: extension) => {
									return ext instanceof package_manager && ext.is_applicable(root.target_quintet);
								}).map((ext: extension) => {
									return ext as package_manager;
								}).forEach((pm: package_manager) => {
									if(!e.resolution && (pm.name == p || p == '*')) {
										let resolution = pm.resolve(host_env, e, root.target_quintet);
										if(resolution) {
											logger.verbose(`${padding}    ${key} for ${t.name} in ${ws.name} resolved by ${pm.name}`);
											e.resolution = Object.assign(new external_resolution(), resolution);
										} else {
											logger.warn(`${padding}    ${key} for ${t.name} in ${ws.name} not resolved by ${pm.name}`);
										}
									}
								});
								if(e.resolution) {
									cache.set(key, e);
								} else {
									logger.warn(`${padding}    ${key} for ${t.name} in ${ws.name} was not fulfilled`);
								}
							}
						});
					}
				});
			});
			
			ws.components.matching_elements(ws.target_quintet).map((comp: workspace) => {
				resolve_externals(comp, padding + '    ');
			});
		}
		resolve_externals(root);
		
		let missing : [workspace, target, external_dependency][] = [];
		const find_unfilled_externals = function(ws: workspace) {
			const chosen_components = ws.components.matching_elements(ws.target_quintet);
			chosen_components.map((comp: workspace) => {
				find_unfilled_externals(comp);
				comp.targets.matching_elements(root.target_quintet).map((t: target) => {
					t.external_deps.matching_elements(root.target_quintet).map((e: external_dependency) => {
						if(e.resolution === null) {
							missing.push([comp, t, e]);
						}
					});
				});
			});
		};
		find_unfilled_externals(root);
		
		const error_message = missing.filter((value: [workspace, target, external_dependency]) => {
			return value[2].optional == false;
		}).map((value: [workspace, target, external_dependency]) => {
			return `${value[0].name}/${value[1].name} has unresolved required external dependency ${value[2].name}::${value[2].version}`
			     + ` from ${value[2].providers.matching_elements(root.target_quintet)}`;
		}).join('\n');
		
		const warning_message = missing.filter((value: [workspace, target, external_dependency]) => {
			return value[2].optional == true;
		}).map((value: [workspace, target, external_dependency]) => {
			return `${value[0].name}/${value[1].name} has unresolved optional external dependency ${value[2].name}::${value[2].version}`
			     + ` from ${value[2].providers.matching_elements(root.target_quintet)}`;
		}).join('\n');
	
		if(warning_message !== '') {
			logger.warn(warning_message);
		}

		if(error_message !== '') {
			logger.error(error_message);
			throw new Error(error_message);
		}
	}

	generate_build_steps(): build_step[][] {
		return this.build_order.map((t: target) => {
			return t.calculate_build_steps(this.target_quintet);
		});
	}

	async load_component(component: string): Promise<workspace> {
		const filename = path.normalize(this.resolve_filename(component));
		const { response, err } = await new Promise((resolve: (value:any) => void, reject: (err: any) => void) => {
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
		if(err) {
			throw ser.deserialize(err);
		}
		
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
			return this.load_component(elem);
		});
	}
}

if(!worker.isMainThread) {
	process.nextTick(async () => {
		try {
			const ws = await load_workspace(worker.workerData.filename, worker.workerData.target, ser.deserialize(worker.workerData.parent_workspace));
			worker.parentPort!.postMessage({ response: ser.serialize(ws), err: null });
		} catch(e) {
			worker.parentPort!.postMessage({ response: null, err: ser.serialize(e) });
		}
	});
}

class quintet_part {
	major: string;
	minor: string;
	parts: string[];
	
	constructor(part: string) {
		this.parts = part.split('/');
		if(this.parts.length > 2) {
			throw new Error(`bad quintet fragment: ${part}`);
		}
		this.parts = this.parts.map((value: string) => { return value.trim(); });
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

@yaserializer.serializable
class quintet {
	parts        : quintet_part[];

	constructor(quin: string) {
		let raw_parts = quin.toString().split(':');
		if(raw_parts.length != 5) {
			throw new Error(`bad quintet: ${quin.toString()}`);
		}
		this.parts = raw_parts.map((p: string) => {
			return new quintet_part(p);
		});
	}

	@yaserializer.unserializable
	get platform      () { return this.parts[0]; }
	@yaserializer.unserializable
	get toolchain     () { return this.parts[1]; }
	@yaserializer.unserializable
	get type          () { return this.parts[2]; }
	@yaserializer.unserializable
	get arch          () { return this.parts[3]; }
	@yaserializer.unserializable
	get configuration () { return this.parts[4]; }

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
	
	get [Symbol.toStringTag]() {
		return this.as_raw_string();
	}
	
	[util.inspect.custom](depth: number, options: any) {
		return this.as_raw_string();
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

	@yaserializer.serializer
	static serialize(q: quintet) {
		return [ q.as_raw_string(), false];
	}
	
	@yaserializer.deserializer
	static deserialize(structured: quintet, destructured: any) {
		let q = new quintet(destructured as string);
		structured.parts = q.parts;
		return false;
	}

	static wildcard : quintet = new quintet('*:*:*:*:*');
}

@yaserializer.serializable
class tool {
	generate_command(target_quintet: quintet, inputs: any) {
		return [] as glob_result[];
	}
}

@yaserializer.serializable
class copy_tool extends tool {
	constructor() {
		super();
	}
}

@yaserializer.serializable
class build_tool extends tool {
	executable  : string;
	flags       : filtered_map<string>;
	command     : filtered_map<string>;
	name_mapping: filtered_map<name_map>;

	constructor(executable: string, flags: any, command: any, name_mapping: any) {
		super();
		this.executable   = executable;
		this.flags        = wrap_in_filter<string>(flags || []);
		this.command      = wrap_in_filter<string>(command || []);
		this.name_mapping = wrap_in_filter<name_map>(name_mapping || []);
	}

	generate_output_names(target_quintet: quintet, inputs: glob_result[]) {
		return inputs;
	}
}

@yaserializer.serializable
class compiler extends build_tool {
	defines: filtered_map<string>;

	constructor(executable: string, flags: any, command: any, output: any, defines: any) {
		super(executable, flags, command, output);
		this.defines = wrap_in_filter<string>(defines);
	}
}

@yaserializer.serializable
class linker extends build_tool {
	constructor(executable: string, flags: any, command: any, output: any) {
		super(executable, flags, command, output);
	}
}

@yaserializer.serializable
class archiver extends build_tool {
	constructor(executable: string, flags: any, command: any, output: any) {
		super(executable, flags, command, output);
	}
}

@yaserializer.serializable
class extension {
	name   : string;
	quintets: quintet[];
	language: string;
	// TODO: different types of extension that offer different verbs

	constructor(spec: any) {
		this.name     = spec.name;
		
		let options = {
			language: 'javascript',
			quintets: [],
		};
		Object.assign(options, spec);
		
		this.quintets = ((Array.isArray(options.quintets) ? options.quintets : [options.quintets]) as string[]).map((val: string) => new quintet(val)) ;
		this.language = options.language;
	}
	
	is_applicable(target_quintet: quintet) {
		return this.quintets.some(quin => target_quintet.match(quin));
	}
}

@yaserializer.serializable
class custom_function extends extension {
	constructor(spec: any) {
		super(spec);
	}
}

@yaserializer.serializable
class package_manager extends extension {
	constructor(spec: any) {
		super(spec);
		this.resolve  = spec.resolve;
	}

	resolve: (env: any, ext: external_dependency, target: quintet) => any;
}

function add_extension(ws: workspace, obj: any) {
	switch(obj.type) {
		case 'package-manager':
			{
				const ext = new package_manager(obj);
				ws.extensions.push(ext);
				return ext;
			}
		default:
			throw new Error(`unknown extension type ${obj.type}`);
		}
}

type file_pattern = string | RegExp;

@yaserializer.serializable
class source_spec {
	srcs    : filtered_map<file_pattern>;
	excludes: filtered_map<file_pattern>;
	defines : filtered_map<string>;
	flags   : filtered_map<string>;
	
	constructor(spec: any) {
		if(typeof spec === 'string' || spec instanceof RegExp) {
			spec = { 'srcs': [spec] };
		}
		
		let options = {
			srcs: [],
			excludes: [],
			defines: [],
			flags: []
		};
		
		Object.assign(options, spec);
		this.srcs     = wrap_in_filter<file_pattern>(Array.isArray(options.srcs) ? options.srcs : [options.srcs]);
		this.excludes = wrap_in_filter<file_pattern>(Array.isArray(options.excludes) ? options.excludes : [options.excludes]);
		this.defines  = wrap_in_filter<string>(Array.isArray(options.defines) ? options.defines : [options.defines]);
		this.flags    = wrap_in_filter<string>(Array.isArray(options.flags) ? options.flags : [options.flags]);
	}
}

@yaserializer.serializable
class toolchain {
	name    : string;
	quintets: quintet[];
	compiler: compiler;
	linker  : linker;
	archiver: archiver;

	constructor(spec: any) {
		var options = {
			'name': '',
			'quintets': [],

			'compiler_name': '',
			'compiler_flags': {},
			'compiler_command': {},
			'compiler_name_mapping': {},
			'defines': [],

			'linker_name': '',
			'linker_flags': {},
			'linker_command': {},
			'linker_name_mapping': {},

			'archiver_name': '',
			'archiver_flags': {},
			'archiver_command': {},
			'archiver_name_mapping': {},
		};
		Object.assign(options, spec);
		
		this.name     = options.name;
		this.quintets = ((Array.isArray(options.quintets) ? options.quintets : [options.quintets]) as string[]).map((val: string) => new quintet(val)) ;

		this.compiler = new compiler(options.compiler_name, options.compiler_flags, options.compiler_command, options.compiler_name_mapping, options.defines);
		this.linker   = new linker  (options.linker_name  , options.linker_flags  , options.linker_command  , options.linker_name_mapping                   );
		this.archiver = new archiver(options.archiver_name, options.archiver_flags, options.archiver_command, options.archiver_name_mapping                 );
	}

	is_applicable(target_quintet: quintet) {
		return this.quintets.some(quin => target_quintet.match(quin));
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

@yaserializer.serializable
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

interface glob_result extends fs.Stats {
	path: string;
	depth: number;
}

interface tool_invocation {
	target: target;
	
	command: string;
	
	implicit_inputs: glob_result[];
	explicit_inputs: glob_result[];
	
	explicit_outputs: glob_result[];
	implicit_outputs: glob_result[];
}

interface build_tool_invocation extends tool_invocation {
	toolchain: toolchain;
	
	defines: string[];
	flags  : string[];
}

interface build_step {
	target: target;
	tool: tool;
	
	invocations: tool_invocation[];
}

@yaserializer.serializable
class target {
	name     : string;
	namespace: string;

	exported_headers  : filtered_map<name_map>;
	headers           : filtered_map<string>;
	sources           : filtered_map<source_spec>;
	depends           : filtered_map<target_reference>;
	external_deps     : filtered_map<external_dependency>;
	parent           !: workspace;

	constructor(spec: any) {
		var options = {
			'name': '',
			'namespace': '',
			'exported_headers': [] as any[],
			'headers': [] as any[],
			'sources' : [] as any[],
			'depends': [] as any[],
			'external_deps': [] as any[]
		};

		Object.assign(options, spec);
		
		this.name      = options.name;
		this.namespace = options.namespace;

		this.exported_headers = wrap_in_filter<name_map>(options.exported_headers);
		this.headers          = wrap_in_filter<string>(options.headers);
		this.sources          = wrap_in_filter<string>(options.sources)      .transform_all_elements_sync(create_regular_object(source_spec));
		this.depends          = wrap_in_filter<string>(options.depends)      .transform_all_elements_sync(create_regular_object(target_reference   ));
		this.external_deps    = wrap_in_filter<string>(options.external_deps).transform_all_elements_sync(create_regular_object(external_dependency));
	}
	
	pick_toolchain(q: quintet) {
		let recurse = (ws: workspace): (toolchain | null) => {
			let candidates = ws.toolchains.filter((tc: toolchain) => {
				return tc.is_applicable(q);
			});
			
			if(candidates.length !== 0) {
				return candidates[0];
			}

			if(ws.parent != null) {
				return recurse(ws.parent);
			} else {
				return null;
			}
		};
		let tc = recurse(this.parent);
		if(!tc) {
			throw new Error(`no viable tolchain found for ${this.name} with target ${q}`)
		}
		logger.verbose(`using ${tc.name} for ${this.parent.name}/${this.name}`);
		return tc;
	}
	
	calculate_build_steps(target_quintet: quintet): build_step[] {
		return [];
	}
}

@yaserializer.serializable
class header_only extends target {
	constructor(spec: any) {
		super(spec);
	}

	calculate_dependent_headers(target_quintet: quintet) {
		const inclusions = this.headers.matching_elements(target_quintet).map((value: file_pattern) => {
			if(typeof value !== 'string') {
				throw new Error('TODO: implement regexp patterns');
			} else {
				return value;
			}
		});
		const options = {
			'cwd': this.parent.workspace_directory,
			'stats': true,
			'matchBase': true
		};
		return glob.sync<glob_result>(inclusions, options);
	}
	
	calculate_header_copy_step(target_quintet: quintet): build_step {
		const inputs = this.exported_headers.matching_elements(target_quintet).map((value: name_map) => {
			return Object.entries(value);
		});
		console.log(inputs);
		const options = {
			'cwd': this.parent.workspace_directory,
			'stats': true,
			'matchBase': true
		};
		//return glob.sync<glob_result>(inclusions, options);
		
		return {
			'target'     : this,
			'tool'       : new copy_tool(),
			'invocations': [
				{
					'target': this,
					'command': 'copy some files',
					'implicit_inputs': this.calculate_dependent_headers(target_quintet),
					'explicit_inputs': [],
					'explicit_outputs': [],
					'implicit_outputs': []
				}
			]
		};
	}

	calculate_build_steps(target_quintet: quintet): build_step[] {
		let steps = super.calculate_build_steps(target_quintet);
		steps.push(this.calculate_header_copy_step(target_quintet));
		return steps;
	}
}

@yaserializer.serializable
class compiled_target extends header_only {
	constructor(spec: any) {
		super(spec);
	}

	calculate_source_groups(target_quintet: quintet, spec: source_spec) {
		const inclusions = spec.srcs.matching_elements(target_quintet).map((value: file_pattern) => {
			if(typeof value !== 'string') {
				throw new Error('TODO: implement regexp patterns');
			} else {
				return value;
			}
		});
		const exclusions = spec.excludes.matching_elements(target_quintet).map((value: file_pattern) => {
			if(typeof value !== 'string') {
				throw new Error('TODO: implement regexp patterns');
			} else {
				return value;
			}
		});
		const options = {
			'cwd': this.parent.workspace_directory,
			'stats': true,
			'matchBase': true,
			'ignore': exclusions
		};
		return glob.sync<glob_result>(inclusions, options);
	}
	
	calculate_compile_step(target_quintet: quintet, chosen_toolchain: toolchain): build_step {
		const dependent_headers = this.calculate_dependent_headers(target_quintet);
		return {
			'target'     : this,
			'tool'       : chosen_toolchain.compiler,
			'invocations': this.sources.matching_elements(target_quintet).map((spec: source_spec): build_tool_invocation => {
				const groups = this.calculate_source_groups(target_quintet, spec);
				return {
					'target'          : this,
					'toolchain'       : chosen_toolchain,
					'defines'         : spec.defines.matching_elements(target_quintet),
					'flags'           : spec.flags  .matching_elements(target_quintet),
					'command'         : '',
					'implicit_inputs' : dependent_headers,
					'explicit_inputs' : groups,
					'explicit_outputs': chosen_toolchain.compiler.generate_output_names(target_quintet, groups),
					'implicit_outputs': chosen_toolchain.compiler.generate_output_names(target_quintet, [])
				}
			}),
		};
	}

	calculate_build_steps(target_quintet: quintet): build_step[] {
		const steps = super.calculate_build_steps(target_quintet);
		const chosen_toolchain = this.pick_toolchain(target_quintet);
		const compile_step = this.calculate_compile_step(target_quintet, chosen_toolchain);
		logger.silly(`  files to build: ${compile_step.invocations.map(value => { return value.explicit_inputs.map(gr => { return gr.path;  });}).flat().join(', ')}`);
		logger.silly(`  timestamps    : ${compile_step.invocations.map(value => { return value.explicit_inputs.map(gr => { return gr.mtime; });}).flat().join(', ')}`);
		steps.push(compile_step);
		return steps;
	}
}

@yaserializer.serializable
class linked_target extends compiled_target {
	constructor(spec: any) {
		super(spec);
	}

	calculate_link_step(target_quintet: quintet, chosen_toolchain: toolchain) {
		return {
			'target'     : this,
			'tool'       : chosen_toolchain.linker,
			'invocations': []
		};
	}

	calculate_build_steps(target_quintet: quintet): build_step[] {
		const steps = super.calculate_build_steps(target_quintet);
		const chosen_toolchain = this.pick_toolchain(target_quintet);
		steps.push(this.calculate_link_step(target_quintet, chosen_toolchain));
		return steps;
	}
}

@yaserializer.serializable
class executable extends linked_target {
	constructor(spec: any) {
		super(spec);
	}
}

@yaserializer.serializable
class dynamic_library extends linked_target {
	constructor(spec: any) {
		super(spec);
	}
}

@yaserializer.serializable
class static_library extends compiled_target {
	constructor(spec: any) {
		super(spec);
	}

	calculate_archiver_step(target_quintet: quintet, chosen_toolchain: toolchain){
		return {
			'target'     : this,
			'tool'       : chosen_toolchain.archiver,
			'invocations': []
		};

	}

	calculate_build_steps(target_quintet: quintet): build_step[] {
		const steps = super.calculate_build_steps(target_quintet);
		const chosen_toolchain = this.pick_toolchain(target_quintet);
		steps.push(this.calculate_archiver_step(target_quintet, chosen_toolchain));
		return steps;
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
		throw new Error(`unknown target type ${obj.type}`);
	}
}

@yaserializer.serializable
class external_resolution {
	headers?: filtered_map<string>;
	lib    ?: filtered_map<string>;
	bin    ?: filtered_map<string>;
}

@yaserializer.serializable
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

@yaserializer.serializable
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
		let fuse = (l: [quintet, V[]], r: [quintet, V[]]) : [quintet, V[]] => {
			return [l[0], unique([...l[1], ...r[1]].sort())];
		};
		
		let combined = unique([...this, ...b].sort(comparison), comparison, fuse);
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
		return await this.transform_matching_elements(quintet.wildcard, fn);
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
		return this.transform_matching_elements_sync(quintet.wildcard, fn);
	}
}

function wrap_in_filter<V>(obj: any): filtered_map<V> {
	if(obj === undefined) {
		obj = {
			[quintet.wildcard.as_raw_string()]: []
		};
	}
	if(typeof obj === 'string' || obj instanceof RegExp) {
		obj = [obj];
	}
	if(Array.isArray(obj)) {
		obj = {
			[quintet.wildcard.as_raw_string()]: obj
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
	logger.verbose(`loading workspace from file ${absolute_file_name}`);

	var ws = new workspace({ 'name': '' });
	ws.all_files           = new Map<string, any>();
	if(parent_workspace) {
		ws.root_directory      = parent_workspace.root_directory;
		ws.jsm_directory       = parent_workspace.jsm_directory;
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
	ws.workspace_directory = path.dirname(absolute_file_name);
	ws.all_files = all_files;
	if(!parent_workspace) {
		ws.target_quintet = target ? new quintet(target) : ws.calculate_default_target();
		logger.verbose(`target quintet detected as: ${ws.target_quintet}`)
	} else {
		ws.target_quintet = parent_workspace.target_quintet;
	}
	
	ws.imports = await ws.load_imports();
	ws.components = await ws.load_components();
	return ws;
}

module.exports.jsm = async function(absolute_file_name: string, target?: string) {
	try {
		const ws = await load_workspace(absolute_file_name, target);

		ws.resolve_all_dependencies();
		let build_order   = ws.determine_build_order();
		logger.info(`build order: ${build_order.map(v => v.parent.name + '/' + v.name).join(', ')}`);
		let build_steps = ws.generate_build_steps();
		console.log(util.inspect(build_steps));
// console.log('after dependency resolution');
// console.log(util.inspect(ws, true, 12, true));

// 		console.log(ws.build_order);

// console.log(util.inspect(ws, true, 12, true));
// console.log(ser.serialize(ws));
		return ws;
	} catch(e) {
		logger.error(`exception: ${e}`);
		console.log(e.stack);
	}
}
