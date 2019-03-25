import * as yaserializer from 'yaserializer';

export const the_serializer = new yaserializer.yaserializer();

export {
	yaserializer,
	serializable,
	unserializable,
	serializer,
	deserializer,
	deserialize_action,
	yaserializer_options
} from 'yaserializer';
