import * as yas from './serializer';
import { filtered_map, wrap_in_filter, quintet, name_map } from './core-types';
import { calculate_renames } from './targets'
import logger from './logging';

@yas.serializable
export class tool {
	generate_command(target_quintet: quintet, inputs: any) {
		return [] as string[];
	}
}

@yas.serializable
export class copy_tool extends tool {
	constructor() {
		super();
	}
}

@yas.serializable
export class build_tool extends tool {
	executable  : string;
	flags       : filtered_map<string>;
	command     : filtered_map<string>;
	name_mapping: filtered_map<name_map>;

	constructor(executable: string, flags: any, command: any, name_mapping: any) {
		super();
		this.executable   = executable;
		this.flags        = wrap_in_filter<string>(flags);
		this.command      = wrap_in_filter<string>(command);
		this.name_mapping = wrap_in_filter<object>(name_mapping).transform_all_elements_sync((elem: object) => { 
			return new name_map(Object.entries(elem).map((value: [string, any]) => {
				return [value[0], [[value[0]], Array.isArray(value[1]) ? value[1] : [value[1]]]];
			}));
		});
	}

	generate_output_names(target_quintet: quintet, inputs: string[]) {
console.log('this method is unfinished and does not work');
		
		let renames = calculate_renames(inputs, this.name_mapping.matching_elements(target_quintet));
		Object.entries(renames).forEach((value: [string, string[]]) => {
			logger.silly(`${value[0]} => ${value[1].join(', ')}`);
		});
		return renames;
	}
}

@yas.serializable
export class compiler extends build_tool {
	defines: filtered_map<string>;

	constructor(executable: string, flags: any, command: any, output: any, defines: any) {
		super(executable, flags, command, output);
		this.defines = wrap_in_filter<string>(defines);
	}
}

@yas.serializable
export class linker extends build_tool {
	constructor(executable: string, flags: any, command: any, output: any) {
		super(executable, flags, command, output);
	}
}

@yas.serializable
export class archiver extends build_tool {
	constructor(executable: string, flags: any, command: any, output: any) {
		super(executable, flags, command, output);
	}
}
