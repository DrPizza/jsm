import * as path from 'path';

import * as yas from './serializer';
import * as fg from 'fast-glob';
import * as mm from 'micromatch';
import logger from './logging';
import { source_spec, target_reference, external_dependency, workspace, toolchain, file_pattern } from './jsm';
import { filtered_map, wrap_in_filter, quintet, quintet_part, create_regular_object, name_map, label} from './core-types';
import { build_tool, linker } from './tools';
import { build_step, copy_files_step, compile_files_step, link_objects_step, archive_objects_step } from './build-steps';

export function calculate_renames(inputs: string[], mappings: name_map[]) {
	// there must be a better way...
	let outputs = new name_map();
	mappings.map((mapping: name_map) => {
		Array.from(mapping.values()).forEach((pair: [string[], string[]]) => {
			pair[0].forEach((original_name: string) => {
				let template_in = original_name;
				let generated = pair[1];
				if(!Array.isArray(generated)) {
					generated = [generated];
				}
				generated.map((template_out: string) => {
					if(template_in === '' && inputs.length === 0) {
						if(outputs.has(template_in)) {
							outputs.get(template_in)![1].push(...generated);
						} else {
							outputs.set(template_in, [[template_in], generated]);
						}
						return outputs;
					}
					let in_pattern = false;
					let pattern_start = 0;
					let pattern_end = 0;
					let parts_in = [] as [number, number][];
					let parts_out = [] as [number, number][];
					for(let i = 0; i < template_in.length; ++i) {
						if(template_in[i] === '*') {
							if(!in_pattern) {
								pattern_start = i;
								in_pattern = true;
							}
						} else if(in_pattern) {
							pattern_end = i;
							parts_in.push([pattern_start, pattern_end]);
							in_pattern = false;
						}
					}
					for(let i = 0; i < template_out.length; ++i) {
						if(template_out[i] === '*') {
							if(!in_pattern) {
								pattern_start = i;
								in_pattern = true;
							}
						} else {
							if(in_pattern) {
								pattern_end = i;
								parts_out.push([pattern_start, pattern_end]);
								in_pattern = false;
							}
						}
					}
					for(let k = 0; k < inputs.length; ++k) {
						let cap = mm.capture(template_in, inputs[k]);
						if(cap !== null) {
							let result = '';
							let j = 0;
							for(let i = 0; i < cap.length && i < parts_in.length && i < parts_out.length; ++i) {
								if(parts_in [i][1] - parts_in [i][0]
								== parts_out[i][1] - parts_out[i][0]) {
									result += template_out.substring(j, parts_out[i][0]) + cap[i];
									j = parts_out[i][1];
								} else {
									throw new Error(`don't know how to map filename ${inputs[k]} using mapping ${template_in} => ${template_out}`);
								}
							}
							result += template_out.substring(j);
							if(outputs.has(inputs[k])) {
								outputs.get(inputs[k])![1].push(result);
							} else {
								outputs.set(inputs[k], [[inputs[k]],  [result]]);
							}
						}
					}
				});
			});
		});
	});
	return outputs;
}

function build_reverse_mapping(forward: name_map) {
	let reverse = new name_map();
	Array.from(forward.values()).forEach((values: [string[], string[]]) => {
		values[1].forEach((output_name: string) => {
			if(reverse.has(output_name)) {
				reverse.get(output_name)![1].push(...values[0]);
			} else {
				reverse.set(output_name, [[output_name], values[0]]);
			}
		})
	});
	return reverse;
}

@yas.serializable
export class export_spec {
	headers: filtered_map<name_map>;
	defines: filtered_map<string>;
	compiler_flags: filtered_map<string>;
	linker_flags: filtered_map<string>;
	
	constructor(spec: any) {
		let options = {
			'headers': [],
			'defines': [],
			'compiler_flags': [],
			'linker_flags': [],
		}
		Object.assign(options, spec);
		
		this.headers = wrap_in_filter<object>(options.headers).transform_all_elements_sync((elem: object) => { 
			return new name_map(Object.entries(elem).map((value: [string, any]) => {
				return [value[0], [[value[0]], Array.isArray(value[1]) ? value[1] : [value[1]]]];
			}));
		});
		this.defines = wrap_in_filter<string>(options.defines);
		this.compiler_flags = wrap_in_filter<string>(options.compiler_flags);
		this.linker_flags = wrap_in_filter<string>(options.linker_flags);
	}
}

@yas.serializable
export abstract class target {
	name     : label;

	exports       : filtered_map<export_spec>;
	headers       : filtered_map<string>;
	sources       : filtered_map<source_spec>;
	excludes      : filtered_map<string>;
	depends       : filtered_map<target_reference>;
	external_deps : filtered_map<external_dependency>;
	parent       !: workspace;
	
	build_steps   : build_step[];

	constructor(spec: any) {
		var options = {
			'name': '',
			'exports': [] as any[],
			'headers': [] as any[],
			'sources' : [] as any[],
			'excludes' : [] as any[],
			'depends': [] as any[],
			'external_deps': [] as any[]
		};

		Object.assign(options, spec);

		this.name      = new label(options.name.indexOf(':') !== -1 ? options.name : ':' + options.name);
		
		this.exports          = wrap_in_filter<string>(options.exports      ).transform_all_elements_sync(create_regular_object(export_spec        ));
		this.headers          = wrap_in_filter<string>(options.headers      );
		this.sources          = wrap_in_filter<string>(options.sources      ).transform_all_elements_sync(create_regular_object(source_spec        ));
		this.excludes         = wrap_in_filter<string>(options.excludes     );
		this.depends          = wrap_in_filter<string>(options.depends      ).transform_all_elements_sync(create_regular_object(target_reference   ));
		this.external_deps    = wrap_in_filter<string>(options.external_deps).transform_all_elements_sync(create_regular_object(external_dependency));
		
		this.build_steps = [];
	}

	abstract get_specific_quintet(q: quintet): quintet;

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
		logger.verbose(`using ${tc.name} for ${this.name}`);
		return tc;
	}

	do_calculate_build_steps(target_quintet: quintet, tc: toolchain): build_step[] {
		this.build_steps = [];
		return this.build_steps;
	}

	calculate_build_steps(target_quintet: quintet): build_step[] {
		const specific = this.get_specific_quintet(target_quintet);
		const tc = this.pick_toolchain(specific);
		return this.do_calculate_build_steps(specific, tc);
	}
}

@yas.serializable
export class header_only extends target {
	defines: filtered_map<string>;

	constructor(spec: any) {
		super(spec);
		var options = {
			'defines': [] as any[]
		};
		Object.assign(options, spec);
		
		this.defines = wrap_in_filter<string>(options.defines);
	}

	get_specific_quintet(q: quintet) {
		let my_quintet = new quintet(q.as_raw_string());
		my_quintet.type = new quintet_part('header-only');
		return my_quintet;
	}

	copy_exported_headers_step(target_quintet: quintet): build_step {
		const mappings = this.exports.matching_elements(target_quintet).map(((exps: export_spec) => {
			return exps.headers.matching_elements(target_quintet);
		})).flat();
		const inputs = mappings.map((value: name_map) => {
			return Array.from(value.keys());
		}).flat();
		const options = {
			'cwd': this.parent.workspace_directory,
			'matchBase': true
		};
		const inputs_to_outputs = calculate_renames(fg.sync<string>(inputs, options), mappings);
		const outputs_to_inputs = build_reverse_mapping(inputs_to_outputs);
		return new copy_files_step(this, inputs_to_outputs, outputs_to_inputs);
	}

	do_calculate_build_steps(target_quintet: quintet, tc: toolchain): build_step[] {
		super.do_calculate_build_steps(target_quintet, tc);
		const copy_step = this.copy_exported_headers_step(target_quintet);
		if(copy_step.inputs_to_outputs.size > 0) {
			this.build_steps.push(copy_step);
		}
		return this.build_steps;
	}
}

@yas.serializable
export abstract class compiled_target extends header_only {
	compiler_flags: filtered_map<string>;

	constructor(spec: any) {
		super(spec);
		var options = {
			compiler_flags: [] as any[]
		}
		Object.assign(options, spec);
		
		this.compiler_flags = wrap_in_filter<string>(options.compiler_flags)
	}

	get_specific_quintet(q: quintet) {
		let my_quintet = new quintet(q.as_raw_string());
		my_quintet.type = new quintet_part('*');
		return my_quintet;
	}

	calculate_specific_sources(target_quintet: quintet, spec: source_spec, common_exclusions: string[]) {
		const inclusions = spec.srcs.matching_elements(target_quintet).map((value: file_pattern) => {
			if(typeof value !== 'string') {
				throw new Error('TODO: implement regexp patterns');
			} else {
				return value;
			}
		});
		const specific_exclusions = spec.excludes.matching_elements(target_quintet).map((value: file_pattern) => {
			if(typeof value !== 'string') {
				throw new Error('TODO: implement regexp patterns');
			} else {
				return value;
			}
		});
		const options = {
			'cwd': this.parent.workspace_directory,
			'matchBase': true,
			'ignore': Array.prototype.concat(specific_exclusions, common_exclusions)
		};
		return fg.sync<string>(inclusions, options);
	}

	calculate_specific_headers(target_quintet: quintet, spec: source_spec, common_exclusions: string[]) {
		const inclusions = spec.headers.matching_elements(target_quintet).map((value: file_pattern) => {
			if(typeof value !== 'string') {
				throw new Error('TODO: implement regexp patterns');
			} else {
				return value;
			}
		});
		const specific_exclusions = spec.excludes.matching_elements(target_quintet).map((value: file_pattern) => {
			if(typeof value !== 'string') {
				throw new Error('TODO: implement regexp patterns');
			} else {
				return value;
			}
		});
		const options = {
			'cwd': this.parent.workspace_directory,
			'matchBase': true,
			'ignore': Array.prototype.concat(specific_exclusions, common_exclusions)
		};
		return fg.sync<string>(inclusions, options);
	}

	calculate_common_headers(target_quintet: quintet, common_exclusions: string[]) {
		const inclusions = this.headers.matching_elements(target_quintet).map((value: file_pattern) => {
			if(typeof value !== 'string') {
				throw new Error('TODO: implement regexp patterns');
			} else {
				return value;
			}
		});
		const options = {
			'cwd': this.parent.workspace_directory,
			'matchBase': true,
			'ignore': common_exclusions
		};
		return fg.sync<string>(inclusions, options);
	}

	calculate_common_exclusions(target_quintet: quintet) {
		const inclusions = this.excludes.matching_elements(target_quintet).map((value: file_pattern) => {
			if(typeof value !== 'string') {
				throw new Error('TODO: implement regexp patterns');
			} else {
				return value;
			}
		});
		const options = {
			'cwd': this.parent.workspace_directory,
			'stats': false,
			'matchBase': true
		};
		return fg.sync<string>(inclusions, options);
	}

	calculate_internal_dependency_include_dirs(target_quintet: quintet) {
		return this.depends.matching_elements(target_quintet).map((ref: target_reference) => {
			return ref.target!.exports.matching_elements(target_quintet).map((exp: export_spec) => {
				return exp.headers.matching_elements(target_quintet).map((mapping: name_map) => {
					return Array.from(mapping.values()).map((pair: [string[], string[]]) => {
						return pair[1];
					}).flat();
				}).flat();
			}).flat();
		}).flat();
	}

	calculate_external_dependency_include_dirs(target_quintet: quintet) {
		return this.external_deps.matching_elements(target_quintet).map((ext: external_dependency) => {
			return ext.resolution!.header_dir!.matching_elements(target_quintet);
		}).flat();
	}

	calculate_compile_steps(target_quintet: quintet, chosen_toolchain: toolchain): build_step[] {
		const common_exclusions = this.calculate_common_exclusions(target_quintet);
		const common_headers    = this.calculate_common_headers(target_quintet, common_exclusions);
		
		const external_include_dirs = this.calculate_external_dependency_include_dirs(target_quintet);
		const internal_include_dirs = this.calculate_internal_dependency_include_dirs(target_quintet);
		
		const options = {
			'cwd': this.parent.workspace_directory,
			'stats': false,
			'matchBase': true
		};
		
		const steps = this.sources.matching_elements(target_quintet).map((spec: source_spec) => {
			const specific_sources = this.calculate_specific_sources(target_quintet, spec, common_exclusions);
			const specific_headers = this.calculate_specific_headers(target_quintet, spec, common_exclusions);
			const target_headers = Array.prototype.concat(specific_headers, common_headers);
			const mappings = chosen_toolchain.compiler.name_mapping.matching_elements(target_quintet);
			const inputs_to_outputs = calculate_renames(fg.sync<string>(specific_sources, options), mappings);
			// TODO handle outputs that are shared
			const outputs_to_inputs = build_reverse_mapping(inputs_to_outputs);
			return new compile_files_step(this, inputs_to_outputs, outputs_to_inputs, chosen_toolchain.compiler, spec, target_headers, external_include_dirs, internal_include_dirs);
		});
		return steps;
	}

	do_calculate_build_steps(target_quintet: quintet, tc: toolchain): build_step[] {
		super.do_calculate_build_steps(target_quintet, tc);
		const compile_steps = this.calculate_compile_steps(target_quintet, tc).filter((step: build_step) => {
			return step.inputs_to_outputs.size > 0;
		});
		this.build_steps.filter((step: build_step) => {
			return step instanceof copy_files_step;
		}).forEach((dependency: build_step) => {
			compile_steps.forEach((comp: build_step) => {
				dependency.needed_by.push(comp);
				comp.needs.push(dependency);
			});
		});
		this.build_steps.push(...compile_steps);
		return this.build_steps;
	}
}

@yas.serializable
export abstract class linked_target extends compiled_target {
	linker_flags: filtered_map<string>;

	constructor(spec: any) {
		super(spec);
		var options = {
			linker_flags: [] as any[]
		}
		Object.assign(options, spec);
		
		this.linker_flags = wrap_in_filter<string>(options.linker_flags)
	}

	calculate_internal_dependency_libs(target_quintet: quintet) {
		return this.depends.matching_elements(target_quintet).map((ref: target_reference) => {
			return ref.target!.build_steps.filter((s: build_step) => {
				return s instanceof compile_files_step;
			}).map((c : build_step) => {
				return Array.from(c.outputs_to_inputs.keys());
			}).flat();
		}).flat();
	}

	calculate_external_dependency_libs(target_quintet: quintet) {
		return this.external_deps.matching_elements(target_quintet).map((ext: external_dependency) => {
			return ext.resolution!.lib_dir!.matching_elements(target_quintet).map((dir: string) => {
				const options = {
					'cwd': dir,
					'stats': false,
					'matchBase': true
				};
				return fg.sync<string>(ext.resolution!.lib_files!.matching_elements(target_quintet), options);
			}).flat();
		}).flat();
	}
	
	calculate_target_objects(target_quintet: quintet, chosen_toolchain: toolchain) {
		const inputs = new name_map();
		const objs = this.build_steps.filter((s: build_step) => {
			return s instanceof compile_files_step;
		}).map((b: build_step) => {
			return Array.from(b.outputs_to_inputs.keys());
		}).flat();

		const outputs = chosen_toolchain.linker.name_mapping.matching_elements(target_quintet).map((m : name_map) => {
			return Array.from(m.values()).map((v: [string[], string[]]) => {
				return v[1];
			}).flat()
		}).flat();
		
		const basename = path.normalize(this.parent!.workspace_directory).replace(path.normalize(this.parent!.root_directory), '').replace(path.sep, '');
		outputs.forEach((ext: string) => {
			const output_name = ext.replace('*', basename); // TODO use variables and substitution!
			const entry = [objs, [output_name]] as [string[], string[]];
			objs.forEach((obj: string) => {
				inputs.set(obj, entry);
			});
		})
		return inputs;
	}

	calculate_link_step(target_quintet: quintet, chosen_toolchain: toolchain) : build_step {
		const internal_libs = this.calculate_internal_dependency_libs(target_quintet);
		const external_libs = this.calculate_external_dependency_libs(target_quintet);
		
		const inputs_to_outputs = this.calculate_target_objects(target_quintet, chosen_toolchain);
		const outputs_to_inputs = build_reverse_mapping(inputs_to_outputs);
		return new link_objects_step(this, inputs_to_outputs, outputs_to_inputs, chosen_toolchain.linker, external_libs, internal_libs);
	}

	do_calculate_build_steps(target_quintet: quintet, tc: toolchain): build_step[] {
		super.do_calculate_build_steps(target_quintet, tc);
		const linker_step = this.calculate_link_step(target_quintet, tc);
		if(linker_step.inputs_to_outputs.size > 0) {
			this.build_steps.filter((step: build_step) => {
				return step instanceof compile_files_step;
			}).forEach((dependency: build_step) => {
				dependency.needed_by.push(linker_step);
				linker_step.needs.push(dependency);
			});
			this.build_steps.push(linker_step);
		}
		return this.build_steps;
	}
}

@yas.serializable
export class executable extends linked_target {
	constructor(spec: any) {
		super(spec);
	}

	get_specific_quintet(q: quintet) {
		let my_quintet = new quintet(q.as_raw_string());
		my_quintet.type = new quintet_part('executable');
		return my_quintet;
	}
}

@yas.serializable
export class dynamic_library extends linked_target {
	constructor(spec: any) {
		super(spec);
	}

	get_specific_quintet(q: quintet) {
		let my_quintet = new quintet(q.as_raw_string());
		my_quintet.type = new quintet_part('dynamic');
		return my_quintet;
	}
}

@yas.serializable
export class static_library extends compiled_target {
	archiver_flags: filtered_map<string>;
	
	constructor(spec: any) {
		super(spec);
		var options = {
			archiver_flags: [] as any[]
		}
		Object.assign(options, spec);
		
		this.archiver_flags = wrap_in_filter<string>(options.archiver_flags)
	}

	get_specific_quintet(q: quintet) {
		let my_quintet = new quintet(q.as_raw_string());
		my_quintet.type = new quintet_part('static');
		return my_quintet;
	}


	calculate_target_objects(target_quintet: quintet, chosen_toolchain: toolchain) {
		const inputs = new name_map();
		const objs = this.build_steps.filter((s: build_step) => {
			return s instanceof compile_files_step;
		}).map((b: build_step) => {
			return Array.from(b.outputs_to_inputs.keys());
		}).flat();

		const outputs = chosen_toolchain.archiver.name_mapping.matching_elements(target_quintet).map((m : name_map) => {
			return Array.from(m.values()).map((v: [string[], string[]]) => {
				return v[1];
			}).flat()
		}).flat();
		
		const basename = path.normalize(this.parent!.workspace_directory).replace(path.normalize(this.parent!.root_directory), '').replace(path.sep, '');
		outputs.forEach((ext: string) => {
			const output_name = ext.replace('*', basename); // TODO use variables and substitution!
			const entry = [objs, [output_name]] as [string[], string[]];
			objs.forEach((obj: string) => {
				inputs.set(obj, entry);
			});
		})
		return inputs;
	}

	calculate_archiver_step(target_quintet: quintet, chosen_toolchain: toolchain) : build_step {
		const inputs_to_outputs = this.calculate_target_objects(target_quintet, chosen_toolchain);
		const outputs_to_inputs = build_reverse_mapping(inputs_to_outputs);
		return new archive_objects_step(this, inputs_to_outputs, outputs_to_inputs, chosen_toolchain.archiver);
	}

	do_calculate_build_steps(target_quintet: quintet, tc: toolchain): build_step[] {
		super.do_calculate_build_steps(target_quintet, tc);
		const archiver_step = this.calculate_archiver_step(target_quintet, tc);
		if(archiver_step.inputs_to_outputs.size > 0) {
			this.build_steps.filter((step: build_step) => {
				return step instanceof compile_files_step;
			}).forEach((dependency: build_step) => {
				dependency.needed_by.push(archiver_step);
				archiver_step.needs.push(dependency);
			});
			this.build_steps.push(archiver_step);
		}
		return this.build_steps;
	}
}
