import * as yas from 'yaserializer';

export const the_serializer = new yas.yaserializer();

// until I update yas on npm
the_serializer.make_class_serializable(EvalError        );
the_serializer.make_class_serializable(RangeError       );
the_serializer.make_class_serializable(ReferenceError   );
the_serializer.make_class_serializable(SyntaxError      );
the_serializer.make_class_serializable(TypeError        );
the_serializer.make_class_serializable(URIError         );

export {
	yaserializer,
	serializable,
	unserializable,
	serializer,
	deserializer,
	deserialize_action,
	yaserializer_options
} from 'yaserializer';
