import * as util from 'util';
import * as yas from './serializer';

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

	toString() : string { return this.as_raw_string(); }

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

	@yas.serializer
	static serialize(q: quintet) {
		return [ q.as_raw_string(), false];
	}

	@yas.deserializer
	static deserialize(structured: quintet, destructured: any) {
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
