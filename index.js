const jsm = require('./dist/jsm.js');
const path = require('path');
const util = require('util');

async function main() {
	await jsm.jsm(path.normalize(path.resolve('build.jsm')));
}

main();
