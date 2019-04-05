import BSON from 'bson';
import zlib from 'zlib';

import * as yas from 'yaserializer';

const use_packed = false;

export const the_serializer = new yas.yaserializer([], { use_packed_format: use_packed });

const binary_options = {
	use_packed_format: use_packed, 
	perform_encode: function(obj: any) {
		return BSON.serialize(obj);
	},
	perform_decode: function(obj: any) {
		return BSON.deserialize(obj);
	}
};
export const binary_serializer = new yas.yaserializer([], binary_options);

const compressed_binary_options = {
	use_packed_format: use_packed, 
	perform_encode: function(obj: any) {
		const serial_form = BSON.serialize(obj);
		return zlib.deflateSync(serial_form);
	},
	perform_decode: function(obj: any) {
		const serial_form = zlib.inflateSync(obj);
		return BSON.deserialize(serial_form);
	}
}
export const compressed_binary_serializer = new yas.yaserializer([], compressed_binary_options);

const compressed_options = {
	use_packed_format: use_packed, 
	perform_encode: function(obj: any) {
		const serial_form = JSON.stringify(obj);
		return zlib.deflateSync(serial_form);
	},
	perform_decode: function(obj: any) {
		const serial_form = zlib.inflateSync(obj);
		return JSON.parse(serial_form.toString());
	}
}
export const compressed_serializer = new yas.yaserializer([], compressed_options);

export {
	yaserializer,
	serializable,
	unserializable,
	serializer,
	deserializer,
	deserialize_action
} from 'yaserializer';
