const XmlParser = require('./xmlparser.js');

module.exports = (osm, opts) => {

	let first = a => a[0];
	let last = a => a[a.length - 1];
	let coordsToKey = (a) => a.join(',');

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

	class Ways {
		constructor() {
			this.ways = [];
			this.firstMap = {};
			this.lastMap = {};
		}

		add(way) {
			this.ways.push(way);
			let firstKey = coordsToKey(first(way)), lastKey = coordsToKey(last(way));
			addToMap(this.firstMap, firstKey, way);
			addToMap(this.lastMap, lastKey, way);
		}

		toRings(direction) {
			let isRing = a => coordsToKey(first(a)) === coordsToKey(last(a));
			let strToFloat = el => el instanceof Array? el.map(strToFloat) : parseFloat(el);

			let ringDirection = (a, xIdx, yIdx) => {
				xIdx = xIdx || 0, yIdx = yIdx || 1;
				let m = a.reduce((maxxIdx, v, idx) => a[maxxIdx][xIdx] > v[xIdx] ? maxxIdx : idx, 0);
				let l = m <= 0? a.length - 1 : m - 1, r = m >= a.length - 1? 0 : m + 1;
				let xa = a[l][xIdx], xb = a[m][xIdx], xc = a[r][xIdx];
				let ya = a[l][yIdx], yb = a[m][yIdx], yc = a[r][yIdx];
				let det = (xb - xa) * (yc - ya) - (xc - xa) * (yb - ya);
				return det < 0 ? 'clockwise' : 'counterclockwise';
			}

			let rings = [], way = null;
			while (way = this.ways.shift()) {
				removeFromMap(this.firstMap, coordsToKey(first(way)), way);
				removeFromMap(this.lastMap, coordsToKey(last(way)), way);

				if (isRing(way)) {
					way = strToFloat(way);
					if (ringDirection(way) !== direction) way.reverse();
					rings.push(way);
				} else {
					let line = [];
					let current = way;
					let reversed = false;
					while (current) {
						line = line.concat(current);
						let key = coordsToKey(last(line));
						reversed = false;

						current = getFirstFromMap(this.firstMap, key);										
						if (!current) {
							current = getFirstFromMap(this.lastMap, key);
							reversed = true;
						}
						
						if (current) {
							this.ways.splice(this.ways.indexOf(current), 1);
							removeFromMap(this.firstMap, coordsToKey(first(current)), current);
							removeFromMap(this.lastMap, coordsToKey(last(current)), current);
							if (reversed) {
								// reverse the shorter line to save time
								if (current.length <= line.length)
									current.reverse();
								else {
									line.reverse();
									[current, line] = [line, current];
								}
							}
							current = current.slice(1);
						}
					}
					
					if (isRing(line)) {
						line = strToFloat(line);
						if (ringDirection(line) !== direction) line.reverse();
						rings.push(line);
					}
				}
			}
			return rings;
		}
	}

	let innerWays = new Ways(), outerWays = new Ways();
	let features = [], relProps = {};

	const xmlParser = new XmlParser({progressive: true});
	xmlParser.addListener('</osm.relation.member[$type==="way"&&$role==="inner"]>', node => {
		with (node) {
			let way = [];
			for (let innerNode of innerNodes)
				way.push([innerNode.$lon, innerNode.$lat]);
			innerWays.add(way);				
		}
	});

	xmlParser.addListener('</osm.relation.member[$type==="way"&&$role==="outer"]>', node => {
		with (node) {
			let way = [];
			for (let innerNode of innerNodes)
				way.push([innerNode.$lon, innerNode.$lat]);
			outerWays.add(way);
		}
	});

	if (opts && opts.allFeatures) {
		xmlParser.addListener('<osm.relation>', node => relProps.id = 'relation/' + node.$id);
		xmlParser.addListener('<osm.relation.bounds>', node => relProps.bbox = [parseFloat(node.$minlon), parseFloat(node.$minlat), parseFloat(node.$maxlon), parseFloat(node.$maxlat)]);
		xmlParser.addListener('</osm.relation.tag>', node => relProps[node.$k] = node.$v);
		xmlParser.addListener('</osm.relation.member[$type==="node"]>', node => {
			with (node) {
				features.push({type: 'Feature', id: `node/${$ref}`, properties: {id: `node/${$ref}`, role: $role}, geometry: {
					type: 'Point',
					coordinates: [parseFloat($lon), parseFloat($lat)]
				}});
			}
		});
	}
	
	xmlParser.parse(osm);

	let constructGeometry = (ows, iws) => {
		let outerRings = ows.toRings('counterclockwise'),
			innerRings = iws.toRings('clockwise');
		
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
		
		// link inner polygons to outer containers
		let innerRing = null;
		while (innerRing = innerRings.shift()) {
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

	let geometry = constructGeometry(outerWays, innerWays);
	if (!opts || !opts.allFeatures)
		return geometry;

	features.unshift({type: 'Feature', id: relProps.id, properties: relProps, geometry});
	return {type: 'FeatureCollection', features};
}