import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import * as worker from 'worker_threads';
import * as os from 'os';

import * as yas from './serializer';
import logger from './logging';
import { filtered_map, wrap_in_filter, quintet, label, create_regular_object } from './core-types';
import { target, header_only, static_library, dynamic_library, executable } from './targets'
import { copy_tool, compiler, linker, archiver } from './tools';
import { build_step } from './build-steps';

export const default_build_file_name = 'build.jsm';

const the_serializer = yas.the_serializer;

@yas.serializable
export class workspace {
	name: label;

	all_files: Map<string, any>;
	import_names: filtered_map<string>;
	imports: filtered_map<any>;
	defaults: any;
	component_names: filtered_map<label>;
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

	known_targets: Map<string, target>;

	constructor(filename: string, obj: any) {
		this.name            = new label('//');
		this.import_names    = wrap_in_filter<string>(obj.imports || []);
		this.imports         = wrap_in_filter<any>([]);

		this.defaults        = obj.defaults || {};
		this.component_names = wrap_in_filter<string>(obj.components).transform_all_elements_sync(create_regular_object(label));
		this.components      = wrap_in_filter<workspace>([]);
		this.targets         = wrap_in_filter<target>(obj.targets || []).transform_all_elements_sync(make_target);

		this.root_directory      = process.cwd();
		this.jsm_directory       = __dirname;
		this.workspace_directory = path.dirname(filename);

		this.target_quintet = new quintet('*:*:*:*:*');

		this.toolchains = [];
		this.properties = {};
		this.extensions = [];

		this.parent = null;

		this.known_targets   = new Map<string, target>();
		this.edges           = new Map<target, target[]>();
		this.build_order     = [];

		this.all_files  = new Map<string, any>();
	
		this.targets.matching_elements(quintet.wildcard).forEach((t: target) => {
			t.parent = this;
			t.name.make_absolute(this);
		});
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

	parse(filename: string, o: any): any {
		if(!Array.isArray(o)) {
			o = [o];
		}
		const parsed = o.map((obj: any) => {
			switch(obj.kind) {
			case 'workspace':
				return new workspace(filename, obj);
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

	resolve_filename(lab: label ): string;
	resolve_filename(pth: string): string;
	resolve_filename(name: (label | string)): string {
		// 'file://foo.jsm'    -> filename: full_absolute_path  / 'foo.jsm'
		// 'builtin://foo.jsm' -> filename: jsm_directory       / 'foo.jsm'
		// '~/foo.jsm'         -> filename: home_directory      / 'foo.jsm'
		// '//foo.jsm'         -> filename: root_directory      / 'foo.jsm'
		// 'foo.jsm'           -> filename: workspace_directory / 'foo.jsm'
		if(typeof name === 'string') {
			if(name.startsWith('file://')) {
				return path.normalize(this.root_directory + path.sep + name.substr('file://'.length)); // TODO crack the URL properly
			} else if(name.startsWith('builtin://')) {
				return path.normalize(this.jsm_directory + path.sep + '..' + path.sep + name.substr('builtin://'.length));
			} else if(name.startsWith('~/')) {
				return path.normalize(os.homedir + path.sep  + name.substr('~/'.length));
			} else if(!name.startsWith(':') && !name.startsWith('//')) {
				return path.normalize(this.workspace_directory + path.sep + name);
			}
		}
		if(!(name instanceof label)) {
			name = new label(name);
		}
		const filename = name.filename === '' ? default_build_file_name : name.filename;
		const pth      = name.base     === '' ? this.workspace_directory : this.root_directory + path.sep + name.base;
		return path.normalize(pth + path.sep + filename);
	}

	load_file(filename: string): any {
		if(this.all_files.has(filename)) {
			return this.all_files.get(filename)!;
		} else {
			const obj = this.parse(filename, eval('(' + fs.readFileSync(filename, {encoding: 'utf-8'}) + ')'));
			this.all_files.set(filename, obj);
			return obj;
		}
	}

	resolve_dependencies(root: workspace, padding: string = '') {
		this.targets.matching_elements(root.target_quintet).map((t: target) => {
			t.depends.matching_elements(root.target_quintet).map((r: target_reference) => {
				const k = r.name.make_absolute(t.parent).toString();
				logger.verbose(`${padding}${t.name} depends on ${k}`);
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
			comp.resolve_dependencies(root, padding + '  ');
		});
	}

	resolve_all_internal_dependencies() {
		const root = this;
		let collect_known_targets = function(ws: workspace) {
			let targs = new Map<string, target>();
			ws.targets.matching_elements(root.target_quintet).map((t: target) => {
				targs.set(t.name.toString(), t);
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
			ws.targets.matching_elements(root.target_quintet).map((t: target) => {
				t.external_deps.matching_elements(root.target_quintet).map((e: external_dependency) => {
					logger.verbose(`${padding}${t.name} depends on ${e.name}`);
					if(e.resolution === null) {
						let provs = e.providers.matching_elements(root.target_quintet);
						provs.map((p: string) => {
							const key = `${p}::${e.name}::${e.version}`;
							if(cache.has(key)) {
								e.resolution = cache.get(key)!.resolution;
								logger.verbose(`${padding}    ${key} for ${t.name} resolved from cache`);
							} else {
								root.extensions.filter((ext: extension) => {
									return ext instanceof package_manager && ext.is_applicable(root.target_quintet);
								}).map((ext: extension) => {
									return ext as package_manager;
								}).forEach((pm: package_manager) => {
									if(!e.resolution && (pm.name == p || p == '*')) {
										let resolution = pm.resolve(host_env, e, root.target_quintet);
										if(resolution) {
											logger.verbose(`${padding}    ${key} for ${t.name} resolved by ${pm.name}`);
											e.resolution = new external_resolution(resolution);
										} else {
											logger.warn(`${padding}    ${key} for ${t.name} not resolved by ${pm.name}`);
										}
									}
								});
								if(e.resolution) {
									cache.set(key, e);
								} else {
									logger.warn(`${padding}    ${key} for ${t.name} was not fulfilled`);
								}
							}
						});
					}
				});
			});

			ws.components.matching_elements(ws.target_quintet).map((comp: workspace) => {
				resolve_externals(comp, padding + '  ');
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
			return `${value[1].name} has unresolved required external dependency ${value[2].name}::${value[2].version}`
			     + ` from ${value[2].providers.matching_elements(root.target_quintet)}`;
		}).join('\n');

		const warning_message = missing.filter((value: [workspace, target, external_dependency]) => {
			return value[2].optional == true;
		}).map((value: [workspace, target, external_dependency]) => {
			return `${value[1].name} has unresolved optional external dependency ${value[2].name}::${value[2].version}`
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

	async load_component(component: label): Promise<workspace> {
		const filename = path.normalize(this.resolve_filename(component));
		const { response, err } = await new Promise((resolve: (value:any) => void, reject: (err: any) => void) => {
			const wrk: worker.Worker = new worker.Worker(__filename, {
				workerData: {
					'filename': filename,
					'target'  : this.target_quintet.as_raw_string(),
					'parent_workspace' : the_serializer.serialize(this)
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
			throw the_serializer.deserialize(err);
		}

		// <runs the fragment just below the class>
		// propagate cached items back into the parent cache
		const ws: workspace = the_serializer.deserialize(response);

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
		return await this.component_names.transform_matching_elements(this.target_quintet, async (elem: label) => {
			return this.load_component(elem);
		});
	}
}

if(!worker.isMainThread) {
	process.nextTick(async () => {
		try {
			const ws = await load_workspace(worker.workerData.filename, worker.workerData.target, the_serializer.deserialize(worker.workerData.parent_workspace));
			worker.parentPort!.postMessage({ response: the_serializer.serialize(ws), err: null });
		} catch(e) {
			worker.parentPort!.postMessage({ response: null, err: the_serializer.serialize(e) });
		}
	});
}

@yas.serializable
export class extension {
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

@yas.serializable
export class custom_function extends extension {
	constructor(spec: any) {
		super(spec);
	}
}

@yas.serializable
export class package_manager extends extension {
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

export type file_pattern = string | RegExp;

@yas.serializable
export class source_spec {
	headers : filtered_map<file_pattern>;
	srcs    : filtered_map<file_pattern>;
	excludes: filtered_map<file_pattern>;
	defines : filtered_map<string>;
	flags   : filtered_map<string>;

	constructor(spec: any) {
		if(typeof spec === 'string' || spec instanceof RegExp) {
			spec = { 'srcs': [spec] };
		}

		let options = {
			headers: [],
			srcs: [],
			excludes: [],
			defines: [],
			flags: []
		};

		Object.assign(options, spec);
		this.headers  = wrap_in_filter<file_pattern>(Array.isArray(options.headers ) ? options.headers  : [options.headers ]);
		this.srcs     = wrap_in_filter<file_pattern>(Array.isArray(options.srcs    ) ? options.srcs     : [options.srcs    ]);
		this.excludes = wrap_in_filter<file_pattern>(Array.isArray(options.excludes) ? options.excludes : [options.excludes]);
		this.defines  = wrap_in_filter<string>      (Array.isArray(options.defines ) ? options.defines  : [options.defines ]);
		this.flags    = wrap_in_filter<string>      (Array.isArray(options.flags   ) ? options.flags    : [options.flags   ]);
	}
}

@yas.serializable
export class toolchain {
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

@yas.serializable
export class target_reference {
	name  : label;
	target: target | null;

	constructor(ref: string) {
		this.name   = new label(ref);
		this.target = null;
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

@yas.serializable
export class external_resolution {
	header_dir ?: filtered_map<string>;
	lib_dir    ?: filtered_map<string>;
	lib_files  ?: filtered_map<string>;
	bin_dir    ?: filtered_map<string>;
	bin_files  ?: filtered_map<string>;
	
	constructor(spec: any) {
		var options = {
			header_dir: [],
			lib_dir: [],
			lib_files: [],
			bin_dir: [],
			bin_files: []
		};
		Object.assign(options, spec);
		this.header_dir = wrap_in_filter<string>(options.header_dir);
		this.lib_dir = wrap_in_filter<string>(options.lib_dir);
		this.lib_files = wrap_in_filter<string>(options.lib_files);
		this.bin_dir = wrap_in_filter<string>(options.bin_dir);
		this.bin_files = wrap_in_filter<string>(options.bin_files);
	}
}

@yas.serializable
export class external_dependency {
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

async function load_workspace(absolute_file_name: string, target?: string, parent_workspace?: workspace) {
	logger.verbose(`loading workspace from file ${absolute_file_name}`);

	var ws = new workspace(absolute_file_name, { name: '', workspace_directory: path.dirname(absolute_file_name) });
	ws.all_files           = new Map<string, any>();
	if(parent_workspace) {
		ws.root_directory      = parent_workspace.root_directory;
		ws.jsm_directory       = parent_workspace.jsm_directory;
		ws.workspace_directory = path.dirname(absolute_file_name);
	} else {
		ws.root_directory      = path.dirname(absolute_file_name);
		ws.jsm_directory       = __dirname;
		ws.workspace_directory = path.dirname(absolute_file_name);
	}

	const loaded = ws.load_file(absolute_file_name);

	if(loaded == null || loaded[0] == null || !(loaded[0] instanceof workspace) || loaded.length != 1) {
		throw new Error('expected a single workspace definition');
	}

	const all_files = ws.all_files;
	ws = loaded[0];
	if(parent_workspace) {
		ws.root_directory      = parent_workspace.root_directory;
		ws.jsm_directory       = parent_workspace.jsm_directory;
		ws.workspace_directory = path.dirname(absolute_file_name);
		ws.name = new label('');
		ws.name.make_absolute(ws);
	}
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

export async function jsm(absolute_file_name: string, target?: string) {
	try {
		const ws = await load_workspace(absolute_file_name, target);

		ws.resolve_all_dependencies();
		let build_order   = ws.determine_build_order();
		logger.info(`build order: ${build_order.map(v => v.name.toString()).join(', ')}`);
		let build_steps = ws.generate_build_steps();
		
		build_steps.forEach((steps: build_step[]) => {
			console.log('----');
			steps.forEach((step: build_step) => {
				const inputs = Array.from(step.inputs_to_outputs.keys()).join(', ');
				const outputs = Array.from(step.outputs_to_inputs.keys()).join(', ');
				console.log(`${step.constructor.name} converting ${inputs} to ${outputs}`);
			});
		})

// console.log('after dependency resolution');
// console.log(util.inspect(ws, true, 12, true));

// 		console.log(ws.build_order);
//console.log(util.inspect(build_steps, true, 4, true));
//console.log(util.inspect(ws, true, 12, true));
// console.log(ser.serialize(ws));
		return ws;
	} catch(e) {
		logger.error(`exception: ${e}`);
		console.log(e.stack);
	}
}

@yas.serializable
abstract class artefact {
	name             !: string; // name of the primary output of a build step e.g. foo.obj, foo.exe
	liveness_metadata!: string; // TODO probably combined m-times of every (contributing?) .jsm
	target           !: target;
	
	constructor() {
		this.name = '';
		this.liveness_metadata = '';
		this.target = {} as any;
	}
}

// anything that isn't generated (e.g. input source/headers)
@yas.serializable
class original_artefact extends artefact {
	constructor() {
		super();
		
	}
}

@yas.serializable
class copy_artefact extends artefact {
	copier         !: copy_tool;
	explicit_input !: artefact;
	
	constructor() {
		super();
	}
}

@yas.serializable
class compiler_artefact extends artefact {
	source  !: source_spec;
	compiler!: compiler;
	
	// gathered through DEPENDS or similar
	discovered_inputs!: artefact[];
	// external headers + headers
	implicit_inputs!: artefact[];
	// the source file itself
	explicit_input!: artefact;
	// PDB, PCH, etc.
	implicit_outputs!: string[];
	
	constructor() {
		super();
	}
}

@yas.serializable
class linker_artefact extends artefact {
	linker!: linker;
	
	// obj files + lib files
	explicit_inputs!: artefact[];
	// exe or dll
	explicit_output!: artefact;
	// PDB, .lib for DLL, etc.
	implicit_outputs!: artefact[];
	
	constructor() {
		super();
	}
}
