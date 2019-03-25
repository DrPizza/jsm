const jsm = require('./dist/jsm').jsm;
const path = require('path');
const util = require('util');

async function main() {
	await jsm(path.normalize(path.resolve('build.jsm')));
}

main();
