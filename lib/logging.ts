import * as util from 'util';
import * as path from 'path';
import * as worker from 'worker_threads';
import * as winston from 'winston';
import wrap_ansi from 'wrap-ansi';
import slice_ansi from 'slice-ansi';
import { default as strip_ansi } from 'strip-ansi';

function get_call_location(): any {
	var stacklist = (new Error()).stack!.split('\n').slice(3).filter((value: string) => {
		return !value.includes('node_modules') && !value.includes('(internal/') && !value.includes('(events.js');
	});

	// stack trace format:
	// https://github.com/v8/v8/wiki/Stack%20Trace%20API
	// do not remove the regex expresses to outside of this method (due to a BUG in node.js)
	var stackReg = /at\s+(.*)\s+\((.*):(\d*):(\d*)\)/gi
	var stackReg2 = /at\s+()(.*):(\d*):(\d*)/gi

	var s = stacklist[0]
	var sp = stackReg.exec(s) || stackReg2.exec(s)

	if (sp && sp.length === 5) {
		return {
			method: sp[1],
			relativePath: path.relative(__dirname, sp[2]),
			line: sp[3],
			pos: sp[4],
			file: path.basename(sp[2]),
			stack: stacklist.join('\n')
		}
	}
}

const handler = {
	get (target: winston.Logger, p: PropertyKey, receiver: any): any {
		const levels = Reflect.get(target, 'levels');
		const fn_names = Array.from(Object.keys(levels));
		if(typeof p === 'string') {
			const call_info = get_call_location();
			const filename = `${call_info['file']}:${call_info['line']}:${call_info['pos']}`;
			const fn = call_info['method'];
			const tid = worker.threadId;
			if(fn_names.includes(p)) {
				return function(message: string) {
					if(message === '') { return '' };
					return (Reflect.get(target, 'log', receiver) as Function).apply(target, [{ message: message, level: String(p), filename: filename, func: fn, tid: tid }]);
				}
			} else if(p == 'log') {
				return function(entry: winston.LogEntry) {
					if(entry.message === '') { return '' };
					entry.filename = filename;
					entry.func = fn;
					entry.tid = tid;
					return (Reflect.get(target, p) as Function).apply(target, [entry]);
				}
			}
		}
		return Reflect.get(target, p, receiver);
	}
};

const logger = new Proxy(winston.createLogger({
	transports: [
		new winston.transports.Console({
			level: 'silly',
			format: winston.format.combine(
				winston.format.colorize({ all: true }),
				winston.format.prettyPrint({ colorize: true }),
				winston.format.timestamp(),
				winston.format.printf((info) => {
					const limit = 120;
					const stripped = strip_ansi(info.message);
					const indent_width = stripped.trimRight().length - stripped.trim().length;
					info.message = slice_ansi(info.message, indent_width);
					const lines = wrap_ansi(info.message, limit - indent_width, { wordWrap: false, hard: true, trim: false }).split('\n');

					let ansi_pad_left = (a: string, limit: number) => {
						const padding_needed = limit - strip_ansi(a).length;
						return ' '.repeat(padding_needed) + a;
					};
					let ansi_pad_right = (a: string, limit: number) => {
						const padding_needed = limit - strip_ansi(a).length;
						return a + ' '.repeat(padding_needed);
					};

					const head           = `[` + `${ansi_pad_left(info.level, 9)}` + ' ]' + ` ${info.timestamp}: `;
					const tail           = ` (at ${info.filename} (${info.tid}:${info.func}))`;
					const left_padding   = ' '.repeat(strip_ansi(head).length);
					const right_padding  = ' '.repeat(strip_ansi(tail).length);
					const indent_padding = ' '.repeat(indent_width);

					lines[0] = head + indent_padding + ansi_pad_right(lines[0], limit - indent_width) + tail;
					for(let i = 1; i < lines.length; ++i) {
						lines[i] = left_padding + indent_padding + ansi_pad_right(lines[i], limit - indent_width) + right_padding;
					}
					return lines.join('\n');
				})
			)
		}),
		new winston.transports.File({
			filename: 'jsm.log',
			level: 'info',
			format: winston.format.combine(
				winston.format.colorize({ level: false }),
				winston.format.prettyPrint({ colorize: false }),
				winston.format.timestamp(),
				winston.format.uncolorize(),
				winston.format.printf((info) => {
					return `${info.level} ${info.timestamp}: ${info.message} (at ${info.filename} (${info.tid}:${info.func}))`;
				}),
			)
		})
	]
}), handler);

export default logger;

util.inspect.defaultOptions.compact = true;
util.inspect.defaultOptions.depth = 2;
util.inspect.defaultOptions.breakLength = 135;
util.inspect.defaultOptions.showHidden = true;
util.inspect.defaultOptions.colors = true;
