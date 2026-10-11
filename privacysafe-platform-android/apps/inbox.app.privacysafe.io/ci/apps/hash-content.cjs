
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

function hashFile(fPath) {
	const fileContent = fs.readFileSync(fPath);
	const h = crypto.createHash('sha512');
	h.update(fileContent);
	return { file: fPath, size: fileContent.length, sha512: h.digest('base64') };
}

function hashesFromDir(dirPath) {
	const paths = fs.readdirSync(dirPath)
	.map(fName => path.join(dirPath, fName));
	const hashes = [];
	for (const fPath of paths) {
		const stats = fs.statSync(fPath);
		if (stats.isFile()) {
			hashes.push(hashFile(fPath));
		} else {
			hashes.push(...hashesFromDir(fPath));
		}
	}
	return hashes;
}

if (require.main === module) {
	const pathsToHash = process.argv.slice(
		process.argv.findIndex(arg => arg.endsWith(__filename)) + 1
	);
	const content = [];
	for (const fPath of pathsToHash) {
		const stats = fs.statSync(fPath);
		if (stats.isFile()) {
			content.push(hashFile(fPath));
		} else {
			content.push(...hashesFromDir(fPath));
		}
	}
	console.log(JSON.stringify({ content }, null, 2));
} else {
	exports.hashFile = hashFile;
	exports.hashesFromDir = hashesFromDir;
}