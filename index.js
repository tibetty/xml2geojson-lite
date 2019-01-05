const XmlParser = require('./xmlparser.js');

module.exports = (osm, opts) => {
	let first = a => a[0];
	let last = a => a[a.length - 1];
	let coordsToKey = a => a.join(',');

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

	let strToFloat = el => el instanceof Array? el.map(strToFloat) : parseFloat(el);

	class Ways {
		constructor() {
			this.ways = [];
			this.firstMap = {};
			this.lastMap = {};
		}

		add(way) {
			this.ways.push(way);
			addToMap(this.firstMap, coordsToKey(first(way)), way);
			addToMap(this.lastMap, coordsToKey(last(way)), way);
		}

		toRings(direction) {
			let isRing = a => coordsToKey(first(a)) === coordsToKey(last(a));

			let ringDirection = (a, xIdx, yIdx) => {
				xIdx = xIdx || 0, yIdx = yIdx || 1;
				let m = a.reduce((maxxIdx, v, idx) => a[maxxIdx][xIdx] > v[xIdx] ? maxxIdx : idx, 0);
				let l = m <= 0? a.length - 1 : m - 1, r = m >= a.length - 1? 0 : m + 1;
				let xa = a[l][xIdx], xb = a[m][xIdx], xc = a[r][xIdx];
				let ya = a[l][yIdx], yb = a[m][yIdx], yc = a[r][yIdx];
				let det = (xb - xa) * (yc - ya) - (xc - xa) * (yb - ya);
				return det < 0 ? 'clockwise' : 'counterclockwise';
			}

			let strings = this.toStrings();
			let rings = [], string = null;
			while (string = strings.shift()) {
				if (isRing(string)) {
					if (ringDirection(string) != direction) string.reverse();
					rings.push(string);
				}	
			}
			return rings;
		}

		toStrings() {
			let strings = [], way = null;
			while (way = this.ways.shift()) {
				removeFromMap(this.firstMap, coordsToKey(first(way)), way);
				removeFromMap(this.lastMap, coordsToKey(last(way)), way);
				let current = way, next = null;
				do {
					let key = coordsToKey(last(current)), reversed = false;

					next = getFirstFromMap(this.firstMap, key);										
					if (!next) {
						next = getFirstFromMap(this.lastMap, key);
						reversed = true;
					}
					
					if (next) {
						this.ways.splice(this.ways.indexOf(next), 1);
						removeFromMap(this.firstMap, coordsToKey(first(next)), next);
						removeFromMap(this.lastMap, coordsToKey(last(next)), next);
						if (reversed) {
							// always reverse shorter one to save time
							if (next.length > current.length)
								[current, next] = [next, current];
							next.reverse();
						}

						current = current.concat(next.slice(1));
					}
				} while (next);
				strings.push(strToFloat(current));
			}

			return strings;
		}
	}

	let constructGeometry = rel => {
		let constructPointGeometry = (pts) => {		
			if (pts.length === 1) return {
				type: 'Point',
				coordinates: pts[0]
			}

			return {
				type: 'MultiPoint',
				coordinates: pts
			}
		}

		let constructStringGeometry = (ws) => {
			let strings = ws? ws.toStrings() : [];
			if (strings.length === 1) return {
				type: 'LineString',
				coordinates: strings[0]
			}

			return {
				type: 'MultiLineString',
				coordinates: strings
			}
		}

		let constructPolygonGeometry = (ows, iws) => {
			let outerRings = ows? ows.toRings('counterclockwise') : [],
				innerRings = iws? iws.toRings('clockwise') : [];
			
			let ptInsidePolygon = (pt, polygon, xIdx, yIdx) => {
				xIdx = xIdx || 0, yIdx = yIdx || 1;
				let result = false;
				for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
					if ((polygon[i][xIdx] <= pt[xIdx] && pt[xIdx] < polygon[j][xIdx] ||
						polygon[j][xIdx] <= pt[xIdx] && pt[xIdx] < polygon[i][xIdx]) &&
						pt[yIdx] < (polygon[j][yIdx] - polygon[i][yIdx]) * (pt[xIdx] - polygon[i][xIdx]) / (polygon[j][xIdx] - polygon[i][xIdx]) + polygon[i][yIdx])
						result = !result;
				}
				return result;
			}
			
			let compositPolyons = [];

			let ring = null;
			for (ring of outerRings)
				compositPolyons.push([ring]);
			
			// link inner polygons to outer containers
			while (ring = innerRings.shift()) {
				for (let idx in outerRings) {
					if (ptInsidePolygon(first(ring), outerRings[idx])) {
						compositPolyons[idx].push(ring);
						break;
					}
				}
			}

			// construct the Polygon/MultiPolygon geometry
			if (compositPolyons.length === 1) return {
				type: 'Polygon',
				coordinates: compositPolyons[0]
			}

			return {
				type: 'MultiPolygon',
				coordinates: compositPolyons
			}
		}

		if (rel.outerWays) {
			return constructPolygonGeometry(rel.outerWays, rel.innerWays);
		}
		else if (rel.ways) {
			return constructStringGeometry(rel.ways);
		}

		return null;
	}

	let nodes = {}, ways = {}, relations = {};
	let points = [], strings = [], polygons = [];

	const xmlParser = new XmlParser({progressive: true});

	xmlParser.addListener('<osm.relation>', node => {
			relations[node.$id] = {type: 'Feature', id: `relation/${node.$id}`, properties: {id: `relation/${node.$id}`}};
	});

	xmlParser.addListener('</osm.way>', node => {
		with (node) {
			let way = [];
			if (node.innerNodes) {
				for (let nd of node.innerNodes) {
					if (nd.$lon && nd.$lat)
						way.push([nd.$lon, nd.$lat]);
					else if (nd.$ref) {
						let rnd = nodes[nd.$ref];
						if (rnd) way.push(rnd);
					}
				}
			}
			ways[$id] = way;
		}
	});

	xmlParser.addListener('</osm.node>', node => {
		with (node) {
			nodes[$id] = [$lon, $lat];
			/*
			if (node.innerNodes) {
				let feature = {type: 'Feature', id: `node/${$id}`, properties: {id: `node/${$id}`}, geometry: {type: 'Point', coordinates: [parseFloat($lon), parseFloat($lat)]}};
				for (let innerNode of innerNodes) {
					if (innerNode.tag === 'tag') {
						feature.properties[innerNode.$k] = innerNode.$v;
					}
				}
				points.push(feature);
			}
			*/
		}
	});

	xmlParser.addListener('</osm.relation.member[$type==="way"]>', (node, parent) => {
		const roleToWaysName = {
			inner: 'innerWays',
			outer: 'outerWays',
			'': 'ways'
		};
		with (node) {
			if (!node.$role) node.$role = '';
			let waysName = roleToWaysName[$role];
			let _ways = relations[parent.$id][waysName];
			if (!_ways) {
				_ways = relations[parent.$id][waysName] = new Ways();
			}

			let way = [];
			if (node.innerNodes) {
				for (let nd of node.innerNodes) {
					if (nd.$lon && nd.$lat)
						way.push([nd.$lon, nd.$lat]);
					else if (nd.$ref) {
						let rnd = nodes[nd.$ref];
						if (rnd) way.push(rnd);
					}
				}
			} else way = ways[$ref];

			_ways.add(way);
		}
	});

	xmlParser.addListener('</osm.relation>', node => {
		let rel = relations[node.$id];
		rel.geometry = constructGeometry(rel);
		delete rel.outerWays;
		delete rel.innerWays;
		delete rel.ways;
		delete relations[node.$id];
		if (rel.geometry) {
			switch (rel.geometry.type) {
				case 'Polygon':
				case 'MultiPolygon':
					polygons.push(rel);
					break;
				case 'LineString':
				case 'MultiLineString':
					strings.push(rel);
					break;
				default:
					break;
			}
		}
	});

	xmlParser.addListener('</osm.relation.bounds>', (node, parent) => relations[parent.$id].properties.bbox = [parseFloat(node.$minlon), parseFloat(node.$minlat), parseFloat(node.$maxlon), parseFloat(node.$maxlat)]);

	xmlParser.addListener('</osm.relation.tag>', (node, parent) => relations[parent.$id].properties[node.$k] = node.$v);

	xmlParser.addListener('</osm.relation.member[$type==="node"]>', node => {
		with (node) {
			let feature = {type: 'Feature', id: `node/${$ref}`, properties: {id: `node/${$ref}`, role: $role}};
			if (node.$lon && node.$lat)
				feature.geometry = {
					type: 'Point',
					coordinates: [parseFloat($lon), parseFloat($lat)]
				};
			else {
				let nd = nodes[$ref];
				if (nd)
					feature.geometry = {
						type: 'Point',
						coordinates: strToFloat(nd)
					};
			}

			points.push(feature);
		}
	});
	
	xmlParser.parse(osm);

	if (!opts || !opts.allFeatures)
		return polygons[0].geometry;

	return {type: 'FeatureCollection', features: polygons.concat(strings).concat(points)};
}