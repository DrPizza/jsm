class serialization_context {
	index: any[];
	objects: any[];
	post_deserialization_actions: (() => any)[];

	constructor() {
		this.index = [];
		this.objects = [];
		this.post_deserialization_actions = [];
	}

	find_object_index(obj: any): number {
		if(obj.____index !== undefined) {
			return obj.____index;
		} else {
			return -1;
		}
	}

	get_next_index(obj: any, destructured: any): number {
		let idx = this.objects.length;
		obj.____index = idx;
		this.objects.push(obj);
		this.index.push(destructured);
		return idx;
	}

	clear_indices() {
		this.objects.forEach((value: any) => {
			delete value.____index;
		});
	}
}

class cerealizer_options {
	ignored: (string | RegExp)[];
	on_deserialize?: (obj: any) => any;
	on_post_deserialize?: (obj: any) => any;

	constructor(ignored?: (string | RegExp | (string | RegExp)[]), deserialize?: (obj: any) => any, post_deserialize?: (obj: any) => any) {
		this.ignored = ignored ? (Array.isArray(ignored) ? ignored : [ignored]) : [];
		this.on_deserialize  = deserialize;
		this.on_post_deserialize = post_deserialize;
	}
}

class registration {
	proto: any;
	serialize_func: (obj: any, ctxt: serialization_context, reg: registration) => any;
	deserialize_func: (obj: any, ctxt: serialization_context, reg: registration) => any;
	options?: cerealizer_options;

	constructor(prot: any,
	            srlz: (obj: any, ctxt: serialization_context, reg: registration) => any,
	            dsrlz: (obj: any, ctxt: serialization_context, reg: registration) => any,
	            options?: cerealizer_options) {
		this.proto = prot;
		this.serialize_func = srlz;
		this.deserialize_func = dsrlz;
		this.options = options;
	}
}

class cerealizer {
	static well_known_symbols = [
		Symbol.asyncIterator, Symbol.hasInstance, Symbol.isConcatSpreadable, Symbol.iterator, Symbol.match, Symbol.replace, Symbol.search, Symbol.species, Symbol.split, Symbol.toPrimitive, Symbol.toStringTag, Symbol.unscopables
	];

	static well_known_symbol_names = [
		'asyncIterator', 'hasInstance', 'isConcatSpreadable', 'iterator', 'match', 'replace', 'search', 'species', 'split', 'toPrimitive', 'toStringTag', 'unscopables'
	];

	known_classes: Map<string, registration>;
	global_options?: cerealizer_options;

	constructor(known_classes?: any[], options?: cerealizer_options) {
		this.known_classes = new Map<string, registration>();

		this.make_class_serializable(Object);
		this.make_class_serializable(Array);
		this.make_class_serializable(Map);
		this.make_class_serializable(Set);
		this.make_class_serializable(Error);
		this.make_class_serializable(RegExp, this.serialize_regexp.bind(this), this.deserialize_regexp.bind(this));
		this.make_class_serializable(Date, this.serialize_date.bind(this), this.deserialize_date.bind(this));

		let t_a_ser   = this.serialize_typed_array.bind(this);
		let t_a_deser = this.deserialize_typed_array.bind(this);

		this.make_class_serializable(Int8Array          , t_a_ser, t_a_deser);
		this.make_class_serializable(Uint8Array         , t_a_ser, t_a_deser);
		this.make_class_serializable(Uint8ClampedArray  , t_a_ser, t_a_deser);
		this.make_class_serializable(Int16Array         , t_a_ser, t_a_deser);
		this.make_class_serializable(Uint16Array        , t_a_ser, t_a_deser);
		this.make_class_serializable(Int32Array         , t_a_ser, t_a_deser);
		this.make_class_serializable(Uint32Array        , t_a_ser, t_a_deser);
		this.make_class_serializable(Float32Array       , t_a_ser, t_a_deser);
		this.make_class_serializable(Float64Array       , t_a_ser, t_a_deser);
		this.make_class_serializable(BigInt64Array      , t_a_ser, t_a_deser);
		this.make_class_serializable(BigUint64Array     , t_a_ser, t_a_deser);

		if(known_classes) {
			known_classes.map((clazz: any) => {
				this.make_class_serializable(clazz);
			})
		}

		if(options) {
			this.global_options = new cerealizer_options();
			Object.assign(this.global_options, options);
		}
	}

	make_class_serializable(clazz: any,
		                    srlz?: (obj: any, ctxt: serialization_context, reg: registration) => any,
		                    dsrlz?: (obj: any, ctxt: serialization_context, reg: registration) => any,
		                    options?: cerealizer_options) {
		const  srl =  srlz || this.serialize_arbitrary_object.bind(this);
		const dsrl = dsrlz || this.deserialize_arbitrary_object.bind(this);
		if(!this.known_classes.has(clazz.name)) {
			this.known_classes.set(clazz.name, new registration(clazz, srl, dsrl, options));
		}
	}

	get_object_class_name(obj: any): string {
		if(obj.constructor.name) {
			return obj.constructor.name;
		}
		if(obj instanceof Float64Array) { return 'Float64Array'; }
		if(obj instanceof Float32Array) { return 'Float32Array'; }
		if(obj instanceof Uint32Array ) { return 'Uint32Array';  }
		if(obj instanceof Uint16Array ) { return 'Uint16Array';  }
		if(obj instanceof Uint8Array  ) { return 'Uint8Array';   }
		if(obj instanceof Int32Array  ) { return 'Int32Array';   }
		if(obj instanceof Int16Array  ) { return 'Int16Array';   }
		if(obj instanceof Int8Array   ) { return 'Int8Array';    }

		throw new Error(`unknown class name for ${obj}`);
	}

	// b: BigInt
	// f: function
	// o: object: integer | { c: class_name, a: array-like, p: property-descriptor } | null
	// s: Symbol: integer (well-known) | string (global)

	serialize_bigint(obj: any) : any {
		return { 'b': obj.toString() };
	}

	deserialize_bigint(obj: any) : bigint {
		return BigInt(obj['b']);
	}

	serialize_function(obj: any): any {
		if(obj.toString() != 'function Function() { [native code] }') {
			return { 'f': obj.toString() };
		} else {
			throw new Error(`can't serialize native functions`);
		}
	}

	deserialize_function(obj: any): Function {
		// eval in global scope, to try to prevent capturing anything from the deserialization environment
		return (1, eval)('(' + obj['f'] + ')') as Function;
	}

	serialize_symbol(obj: any): any {
		const idx = cerealizer.well_known_symbols.indexOf(obj);
		if(idx != -1) {
			return { 's': idx };
		}
		const key = Symbol.keyFor(obj);
		if(key !== undefined) {
			return { 's': key };
		}
		throw new Error(`can't serialize local Symbol`);
	}

	deserialize_symbol(obj: any): Symbol {
		switch(typeof obj['s']) {
		case 'number':
			return cerealizer.well_known_symbols[obj['s'] as number];
		case 'string':
			return Symbol.for(obj['s'] as string);
		}
		throw new Error(`unknown Symbol type`);
	}

	serialize_typed_array(obj: any, ctxt: serialization_context, reg: registration) {
		return Buffer.from(obj['buffer']).toString('base64');
	}

	deserialize_typed_array(obj: any, ctxt: serialization_context, reg: registration): any {
		const buff = Buffer.from(obj as string, "base64");
		return new reg.proto(new Uint8Array(buff).buffer);
	}

	serialize_date(obj: any, ctxt: serialization_context, reg: registration): any {
		return (obj as Date).toISOString();
	}

	deserialize_date(obj: any, ctxt: serialization_context, reg: registration): Date {
		return new Date(obj as string);
	}

	serialize_regexp(obj: any, ctxt: serialization_context, reg: registration): any {
		return (obj as RegExp).toString();
	}

	deserialize_regexp(obj: any, ctxt: serialization_context, reg: registration): RegExp {
		const str = obj as string;
		return new RegExp(str.substr(1, str.length - 2));
	}

	serialize_array_like(obj: any, ctxt: serialization_context) {
		let arr : any[] = [];
		for(let idx in obj) {
			if(Number(idx).toString() === idx) {
				arr.push([Number(idx), this.serialize_primitive(obj[idx], ctxt)]);
			}
		}
		return arr;
	}

	deserialize_array_like(obj: any, ctxt: serialization_context) {
		let arr: any[] = [];
		obj.map((pair: any[]) => {
			arr[pair[0]] = this.deserialize_primitive(pair[1], ctxt);
		});
		return arr;
	}

	serialize_arbitrary_object(obj: any, ctxt: serialization_context, reg: registration) {
		let destructured : any = {};
		const is_array_like = obj instanceof Array;
		if(is_array_like) {
			destructured['a'] = this.serialize_array_like(obj, ctxt);
		}

		let ignores: (string | RegExp)[] = [];
		if(reg.options) {
			ignores = ignores.concat(reg.options.ignored);
		}
		if(this.global_options) {
			ignores = ignores.concat(this.global_options.ignored);
		}

		const desc = Object.getOwnPropertyDescriptors(obj);
		for(let prop in desc) {
			const should_ignore = ignores.reduce<boolean>((acc: boolean, curr: (string | RegExp)): boolean => {
				return acc || (typeof curr === "string" ? prop === curr : curr.test(prop));
			}, false);
			if(should_ignore) {
				continue;
			}
			if(prop === '____index') {
				delete desc[prop];
				continue;
			}
			if(is_array_like && prop == null || Number(prop).toString() === prop) {
				delete desc[prop];
				continue;
			}
			if(desc[prop].hasOwnProperty('value')) {
				if(desc[prop].value !== null) {
					desc[prop].value = this.serialize_primitive(desc[prop].value, ctxt);
				}
			}
			if(desc[prop].hasOwnProperty('get')) {
				if(desc[prop]['get'] !== null) {
					desc[prop]['get'] = this.serialize_primitive(desc[prop]['get'], ctxt);
				}
			}
			if(desc[prop].hasOwnProperty('set')) {
				if(desc[prop]['set'] !== null) {
					desc[prop]['set'] = this.serialize_primitive(desc[prop]['set'], ctxt);
				}
			}
		}
		destructured['p'] = desc;
		return destructured;
	}

	deserialize_arbitrary_object(obj: any, ctxt: serialization_context, reg: registration) {
		const structured: any = (obj.hasOwnProperty('a')) ? new Array() : {};
		Object.setPrototypeOf(structured, reg.proto.prototype);

		if(obj.hasOwnProperty('a')) {
			Object.assign(structured, this.deserialize_array_like(obj['a'], ctxt));
		}
		if(obj.hasOwnProperty('p')) {
			const desc = obj['p'];
			for(let prop in desc) {
				if(desc[prop].hasOwnProperty('value')) {
					if(desc[prop].value !== null) {
						desc[prop].value = this.deserialize_primitive(desc[prop].value, ctxt);
					}
				}
				if(desc[prop].hasOwnProperty('get') || desc[prop].hasOwnProperty('set')) {
					if(desc[prop]['get'] !== undefined) {
						desc[prop]['get'] = this.deserialize_primitive(desc[prop]['get'], ctxt);
						Object.defineProperty(desc[prop]['get'], 'name', { writable: true });
						desc[prop]['get']['name'] = 'get';
						Object.defineProperty(desc[prop]['get'], 'name', { writable: false });
					}
					if(desc[prop]['set'] !== undefined) {
						desc[prop]['set'] = this.deserialize_primitive(desc[prop]['set'], ctxt);
						Object.defineProperty(desc[prop]['set'], 'name', { writable: true });
						desc[prop]['set']['name'] = 'set';
						Object.defineProperty(desc[prop]['set'], 'name', { writable: false });
					}
				}
			}
			Object.defineProperties(structured, desc);
		}
		return structured;
	}

	serialize_object(obj: any, ctxt: serialization_context): any {
		const destructured: any = {};
		const class_name = this.get_object_class_name(obj);

		if(class_name !== 'Object' && !this.known_classes.has(class_name)) {
			throw new Error(`class ${class_name} is not registered`);
		}
		let idx = ctxt.find_object_index(obj);
		if(idx === -1) {
			const substructure: any = {};
			substructure['c'] = class_name;
			idx = ctxt.get_next_index(obj, substructure);
			const reg = this.known_classes.get(class_name)!;
			substructure['v'] = reg.serialize_func(obj, ctxt, reg);
		}
		destructured['o'] = idx;
		return destructured;
	}

	deserialize_object(obj: any, ctxt: serialization_context): any {
		const idx = obj['o'] as number;
		if(ctxt.objects[idx] !== undefined) {
			return ctxt.objects[idx];
		}
		const object_data = ctxt.index[idx];
		const class_name = object_data['c'];
		if(!this.known_classes.has(class_name)) {
			throw new Error(`class ${class_name} is not registered`);
		}
		const reg = this.known_classes.get(class_name)!;
		const structured = reg.deserialize_func(object_data['v'], ctxt, reg);
		
		if(reg.options && reg.options.on_deserialize) {
			reg.options.on_deserialize(structured);
		}
		if(this.global_options && this.global_options.on_deserialize) {
			this.global_options.on_deserialize(structured);
		}
		if(reg.options && reg.options.on_post_deserialize) {
			ctxt.post_deserialization_actions.push(() => {
				reg.options!.on_post_deserialize!(structured);
			});
		}
		if(this.global_options && this.global_options.on_post_deserialize) {
			ctxt.post_deserialization_actions.push(() => {
				this.global_options!.on_post_deserialize!(structured);
			});
		}

		ctxt.objects[idx] = structured;
		return structured;
	}

	serialize_primitive(obj: any, ctxt: serialization_context): any {
		if(obj === undefined) {
			return undefined;
		}
		if(obj === null) {
			return null;
		}
		switch(typeof obj) {
		case 'number':
		case 'boolean':
		case 'string':
			return obj;
		case 'bigint':
			return this.serialize_bigint(obj);
		case 'function':
			return this.serialize_function(obj);
		case 'symbol':
			return this.serialize_symbol(obj);
		case 'object':
			return this.serialize_object(obj, ctxt);
		default:
			throw new Error(`don't know how to serialize an object with type ${typeof obj}`);
		}
	}

	deserialize_primitive(obj: any, ctxt: serialization_context): any {
		if(obj === undefined) {
			return undefined;
		}
		if(obj === null) {
			return null;
		}
		switch(typeof obj) {
		case 'number':
		case 'boolean':
		case 'string':
			return obj;
		case 'object':
			if(obj.hasOwnProperty('b')) {
				return this.deserialize_bigint(obj);
			} else if(obj.hasOwnProperty('f')) {
				return this.deserialize_function(obj);
			} else if(obj.hasOwnProperty('s')) {
				return this.deserialize_symbol(obj);
			} else {
				return this.deserialize_object(obj, ctxt);
			}
		default:
			throw new Error(`don't know how to deserialize an object of type ${typeof obj}`);
		}
	}

	serialize(obj: any): string {
		let ctxt = new serialization_context();
		let destructured = this.serialize_primitive(obj, ctxt);
		ctxt.clear_indices();
		return JSON.stringify([ctxt.index, destructured]);
	}

	deserialize(data: string) : any {
		let raw_object: any = JSON.parse(data);
		if(!(raw_object instanceof Array) || raw_object.length != 2) {
			throw new Error(`invalid serialization data: ${data.substr(0, 16)}`);
		}
		const ctxt = new serialization_context();
		ctxt.index = raw_object[0];
		const deserialized = this.deserialize_primitive(raw_object[1], ctxt);
		ctxt.post_deserialization_actions.forEach((value: (() => any)) => {
			value();
		});
		return deserialized;
	}
};

module.exports = {
	cerealizer: cerealizer,
	cerealizer_options: cerealizer_options
}
