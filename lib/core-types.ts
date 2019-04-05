import * as path from 'path';
import * as util from 'util';
import * as yas from './serializer';
import { workspace, default_build_file_name } from './jsm';

export function unique<T>(arr: T[], compare?: (a: T, b: T) => number, fuse?: (a: T, b: T) => T) : T[] {
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


export function create_regular_object(clazz: Function) {
	return function(elem: string) {
		return Reflect.construct(clazz, [elem]);
	}
}

@yas.serializable
export class label {
	base    : string;
	filename: string;
	target  : string;
	constructor(s: string) {
		// full      : //path/to/folder/file.name:target
		// implicit  : //path/to/folder        => //path/to/folder:folder
		// same-level: :target                 => //path/to/self:target
		
		const label_pattern = /^(\/\/[^.:]*)??(\/[^/.]*\.[^/:]+)?(:.*)?$/;
		const matches = label_pattern.exec(s);
		if(!matches) {
			throw new Error(`can't parse label ${s}`);
		}
		this.base     = matches[1] || '';
		this.filename = matches[2] || '';
		this.target   = matches[3] || '';
	}
	
	make_absolute(ws: workspace) {
		if(this.base == '') {
			this.base = '/' + path.normalize(ws.workspace_directory).replace(path.normalize(ws.root_directory), '').replace(path.sep, '/');
		}
		if(this.filename == '') {
			this.filename = '/' + default_build_file_name;
		}
		if(this.target == '') {
			this.target = ':' + this.base.split('/').slice(-1)[0];
		}
		return this;
	}
	
	toString() : string {
		return this.base + this.filename + this.target;
	}
}

export class quintet_part {
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

	toString(): string {
		return this.as_raw_string();
	}

	static compare(l: quintet_part, r: quintet_part) : number {
		const sl = l.as_raw_string(), sr = r.as_raw_string();
		return sl < sr ? -1
		     : sl > sr ?  1
		     :            0;
	}
}

@yas.serializable
export class quintet {
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

	@yas.unserializable
	get platform      () { return this.parts[0]; }
	set platform      (p: quintet_part) { this.parts[0] = p;}
	@yas.unserializable
	get toolchain     () { return this.parts[1]; }
	set toolchain     (p: quintet_part) { this.parts[1] = p;}
	@yas.unserializable
	get type          () { return this.parts[2]; }
	set type          (p: quintet_part) { this.parts[2] = p;}
	@yas.unserializable
	get arch          () { return this.parts[3]; }
	set arch          (p: quintet_part) { this.parts[3] = p;}
	@yas.unserializable
	get configuration () { return this.parts[4]; }
	set configuration (p: quintet_part) { this.parts[4] = p;}

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

	[util.inspect.custom](depth: number, options: any) {
		return this.as_raw_string();
	}

	toString() : string {
		return this.as_raw_string();
	}

	static compare(l: quintet, r: quintet) : number {
		for(let i = 0; i < 5; ++i) {
			let cmp = quintet_part.compare(l.parts[i], r.parts[i]);
			if(cmp != 0) {
				return cmp;
			}
		}
		return 0;
	}

	@yas.serializer
	static serialize(q: quintet, deeper: (s: any) => any) {
		return [ q.as_raw_string(), false];
	}

	@yas.deserializer
	static deserialize(structured: quintet, destructured: any, deeper: (s: any) => any) {
		let q = new quintet(destructured as string);
		structured.parts = q.parts;
		return false;
	}

	static wildcard : quintet = new quintet('*:*:*:*:*');
}

@yas.serializable
export class filtered_map<V> extends Map<quintet, V[]> {
	static make<V>(spec: { [s: string]: V[]; }) {
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
		let comparison = (l: [quintet, V[]], r: [quintet, V[]]): number => {
			return quintet.compare(l[0], r[0]);
		};
		let fuse = (l: [quintet, V[]], r: [quintet, V[]]): [quintet, V[]] => {
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

export function wrap_in_filter<V>(obj: any): filtered_map<V> {
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
	if(typeof obj === 'object') {
		for(let prop in obj) {
			try {
				new quintet(prop);
			} catch(e) {
				obj = {
					[quintet.wildcard.as_raw_string()]: [obj]
				}
				break;
			}
		}
	}
	for(let prop in obj) {
		if(!Array.isArray(obj[prop])) {
			obj[prop] = [obj[prop]];
		}
	}
	return filtered_map.make<V>(obj);
}

@yas.serializable
export class name_map extends Map<string, [string[], string[]]> {
	constructor(...args: any) {
		super(...args);
	}
	

	@yas.serializer
	static serialize(nm: name_map, deeper: (s: any) => any) {
		return [ Array.from(nm.entries()), false];
	}

	@yas.deserializer
	static deserialize(structured: name_map, destructured: any, deeper: (s: any) => any) {
		let entries = destructured as [string, [string[], string[]]][];
		entries.forEach((entry: [string, [string[], string[]]]) => {
			structured.set(entry[0], entry[1]);
		})
		return false;
	}
}
