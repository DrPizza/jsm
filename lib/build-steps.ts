import * as yas from './serializer';
import { source_spec } from './jsm';
import { name_map } from './core-types';
import { copy_tool, compiler, linker, archiver } from './tools';
import { target } from './targets'

@yas.serializable 
export class build_step {
	generator: target;
	
	inputs_to_outputs: name_map;
	outputs_to_inputs: name_map;
	
	needs: build_step[];
	needed_by: build_step[];

	constructor(generator: target, inputs_to_outputs: name_map, outputs_to_inputs: name_map) {
		this.generator = generator;
		this.needs = [];
		this.needed_by = [];
		this.inputs_to_outputs = inputs_to_outputs;
		this.outputs_to_inputs = outputs_to_inputs;
	}
}

@yas.serializable
export class copy_files_step extends build_step {
	tool: copy_tool;
	
	constructor(generator: target, inputs_to_outputs: name_map, outputs_to_inputs: name_map) {
		super(generator, inputs_to_outputs, outputs_to_inputs);
		this.tool = new copy_tool();
	}
}

@yas.serializable
export class compile_files_step extends build_step {
	spec: source_spec;
	compiler: compiler;
	target_headers: string[];
	external_include_dirs: string[];
	internal_include_dirs: string[];

	constructor(generator: target,
	            inputs_to_outputs: name_map,
	            outputs_to_inputs: name_map,
	            compiler: compiler,
	            spec: source_spec,
	            target_headers: string[],
	            external_include_dirs: string[],
	            internal_include_dirs: string[]) {
		super(generator, inputs_to_outputs, outputs_to_inputs);
		this.spec = spec;
		this.compiler = compiler;
		this.target_headers = target_headers;
		this.external_include_dirs = external_include_dirs;
		this.internal_include_dirs = internal_include_dirs;
	}
}

@yas.serializable
export class link_objects_step extends build_step {
	linker: linker;
	external_libs: string[];
	internal_libs: string[];

	constructor(generator: target, inputs_to_outputs: name_map, outputs_to_inputs: name_map, linker: linker, external_libs: string[], internal_libs: string[]) {
		super(generator, inputs_to_outputs, outputs_to_inputs);
		this.linker = linker;
		this.external_libs = external_libs;
		this.internal_libs = internal_libs;
	}
}

@yas.serializable
export class archive_objects_step extends build_step {
	archiver: archiver;
	
	constructor(generator: target, inputs_to_outputs: name_map, outputs_to_inputs: name_map, archiver: archiver) {
		super(generator, inputs_to_outputs, outputs_to_inputs);
		this.archiver = archiver;
	}
}
