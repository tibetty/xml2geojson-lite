module.exports = (osm, opts) => {
	const XmlParser = require('./xmlparser.js');
	
	let coordsToKey = (a) => a.join(',');
	let first = a => a[0];
	let last = a => a[a.length - 1];

	let addToMap = (m, k, v) => {
		let a = m[k];
		if (a) a.push(v);
		else m[k] = [v];
	}
	
	let removeFromMap = (m, k, v) => {
		let a = m[k];
		if (a) a.splice(a.indexOf(v), 1);
	}
	
	let getFirstFromMap = (m, k) => {
		let a = m[k];
		if (a && a.length > 0) return a[0];
		return null;
	}			

	let outerWays = [], outerFirstMap = {}, outerLastMap = {};
	let innerWays = [], innerFirstMap = {}, innerLastMap = {};
	let features = [];
	let relProps = {};

	const xmlParser = new XmlParser({progressive: true});
	xmlParser.addListener('</osm.relation.member>', node => {
		with (node) {
			if ($type === 'way') {
				let way = [];
				for (let innerNode of innerNodes) {
					way.push([innerNode.$lon, innerNode.$lat]);
				}
				if ($role === 'inner') {
					innerWays.push(way);
					addToMap(innerFirstMap, coordsToKey(first(way)), way);
					addToMap(innerLastMap, coordsToKey(last(way)), way);
				} else if ($role === 'outer') {
					outerWays.push(way);
					addToMap(outerFirstMap, coordsToKey(first(way)), way);
					addToMap(outerLastMap, coordsToKey(last(way)), way);
				}
			}
			else if (opts && opts.allFeatures && $type === 'node') {
				let feature = {type: 'Feature', id: `node/${$ref}`, properties: {id: `node/${$ref}`, role: $role}, geometry: {
						type: 'Point',
						coordinates: [parseFloat($lon), parseFloat($lat)]
					}};
				features.push(feature);
			}
		}
	});

	if (opts && opts.allFeatures) {
		xmlParser.addListener('<osm.relation>', node => relProps.id = 'relation/' + node.$id);
		xmlParser.addListener('<osm.relation.bounds>', node => relProps.bbox = [parseFloat(node.$minlon), parseFloat(node.$minlat), parseFloat(node.$maxlon), parseFloat(node.$maxlat)]);
		xmlParser.addListener('</osm.relation.tag>', node => relProps[node.$k] = node.$v);
	}
	
	xmlParser.parse(osm);

	let constructGeometry = () => {
		let constructRings = (ways, firstMap, lastMap, direction) => {
			let isRing = a => coordsToKey(first(a)) === coordsToKey(last(a));
			let strToFloat = el => el instanceof Array? el.map(strToFloat) : parseFloat(el);

			let ringDirection = (a, xIdx, yIdx) => {
				xIdx = xIdx || 0, yIdx = yIdx || 1;
				let m = a.reduce((last, v, current) => a[last][0] > v[0] ? last : current, 0);
				let l = m <= 0? a.length - 1 : m - 1, r = m >= a.length - 1? 0 : m + 1;
				let xa = a[l][xIdx], xb = a[m][xIdx], xc = a[r][xIdx];
				let ya = a[l][yIdx], yb = a[m][yIdx], yc = a[r][yIdx];
				let det = (xb - xa) * (yc - ya) - (xc - xa) * (yb - ya);
				return det < 0 ? 'clockwise' : 'counterclockwise';
			}

			let rs = [], way = null;
			while (way = ways.pop()) {
				removeFromMap(firstMap, coordsToKey(first(way)), way);
				removeFromMap(lastMap, coordsToKey(last(way)), way);

				if (isRing(way)) {
					way = strToFloat(way);
					if (ringDirection(way) !== direction) way.reverse();
					rs.push(way);
				} else {
					let line = [];
					let current = way;
					let reversed = false;
					while (current) {
						line = line.concat(current);
						let key = coordsToKey(last(line));
						reversed = false;

						current = getFirstFromMap(firstMap, key);										
						if (!current) {
							current = getFirstFromMap(lastMap, key);
							reversed = true;
						}
						
						if (current) {
							ways.splice(ways.indexOf(current), 1);
							removeFromMap(firstMap, coordsToKey(first(current)), current);
							removeFromMap(lastMap, coordsToKey(last(current)), current);
							if (reversed) current.reverse();
							current = current.slice(1);
						}
					}
					
					if (isRing(line)) {
						line = strToFloat(line);
						if (ringDirection(line) !== direction) line.reverse();
						rs.push(line);
					}
				}
			}
			return rs;
		}

		let outerRings = constructRings(outerWays, outerFirstMap, outerLastMap, 'counterclockwise'),
			innerRings = constructRings(innerWays, innerFirstMap, innerLastMap, 'clockwise');
		
		// link inner polygons to outer containers
		let ptInsidePolygon = (pt, polygon, lngIdx, latIdx) => {
			lngIdx = lngIdx || 0, latIdx = latIdx || 1;
			let result = false;
			for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
				if ((polygon[i][lngIdx] <= pt[lngIdx] && pt[lngIdx] < polygon[j][lngIdx] ||
					polygon[j][lngIdx] <= pt[lngIdx] && pt[lngIdx] < polygon[i][lngIdx]) &&
					pt[latIdx] < (polygon[j][latIdx] - polygon[i][latIdx]) * (pt[lngIdx] - polygon[i][lngIdx]) / (polygon[j][lngIdx] - polygon[i][lngIdx]) + polygon[i][latIdx])
					result = !result;
			}
			return result;
		}
		
		let compositPolyons = [];

		for (let idx in outerRings) {
			compositPolyons[idx] = [outerRings[idx]];
		}
		
		let innerRing = null;
		while (innerRing = innerRings.pop()) {
			for (let idx in outerRings) {
				if (ptInsidePolygon(first(innerRing), outerRings[idx])) {
					compositPolyons[idx].push(innerRing);
					break;
				}
			}
		}

		// construct the geometry
		if (compositPolyons.length === 1) return {
			type: 'Polygon',
			coordinates: compositPolyons[0]
		}

		return {
			type: 'MultiPolygon',
			coordinates: compositPolyons
		}
	}

	let geometry = constructGeometry();
	if (!opts || !opts.allFeatures)
		return geometry;

	features.unshift({type: 'Feature', id: relProps.id, properties: relProps, geometry});
	return {type: 'FeatureCollection', features};
}