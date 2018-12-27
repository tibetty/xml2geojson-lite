const fs = require('fs'),
	DOMParser = require('xmldom').DOMParser,
	osmtogeojson = require('osmtogeojson'),
	xml2geojson = require('./index.js');

const xmlFiles = ['zhucheng.xml', 'hebei.xml', 'tokyodo.xml'];

for (let file of xmlFiles) {
	console.log(`---processing time comparison for ${file}---`);
	let content = fs.readFileSync(file, 'utf-8');
	let stime = new Date().getTime();
	const xmlcontent = new DOMParser().parseFromString(content);
	osmtogeojson(xmlcontent);
	let etime = new Date().getTime();
	console.log(`.${etime - stime}ms costed by xmldom + osmtogeojson`);

	stime = new Date().getTime();
	xml2geojson(content);
	etime = new Date().getTime();
	console.log(`.${etime - stime}ms costed by xml2geojson-lite`);
}