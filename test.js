const fs = require('fs'),
	DOMParser = require('xmldom').DOMParser,
	osmtogeojson = require('osmtogeojson'),
	xml2geojson = require('./index.js');

const xmlFiles = ['zhucheng.xml', 'hebei.xml', 'tokyodo.xml', 'usa.xml'];
// let geojsons = [];
for (let file of xmlFiles) {
	let osm = fs.readFileSync(file, 'utf-8');
	console.log(`---processing time comparison for ${file}---`);
	let stime = new Date().getTime();
	xml2geojson(osm, {allFeatures: true});
	let etime = new Date().getTime();
	console.log(`.${etime - stime}ms costed by xml2geojson-lite@allFeatures`);

	// geojsons.push(xml2geojson(osm, {allFeatures: true}));

	stime = new Date().getTime();
	const osmdom = new DOMParser().parseFromString(osm);
	etime = new Date().getTime();
	console.log(`.${etime - stime}ms costed by xmldom only`);
	osmtogeojson(osmdom);
	etime = new Date().getTime();
	console.log(`.${etime - stime}ms costed by xmldom + osmtogeojson`);
}
// console.log(JSON.stringify(geojsons));