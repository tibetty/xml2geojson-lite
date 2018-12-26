module.exports = (xml) => {
	let segments = xml.split(/(<member type="way" ref=".+" role=".+">[^]+?<\/member>)/g);
	let waySegments = [];
	for (let segment of segments) {
		if (/<member type="way" ref=".+" role=".+">[^]+?<\/member>/g.test(segment)) {
			waySegments.push(segment);
		}
	}

	const first = a => a[0];
	const last = a => a[a.length - 1];
	
	function addToMap(m, k, v) {
		let a = m[k];
		if (a) a.push(v);
		else m[k] = [v];
	}
	
	function removeFromMap(m, k, v) {
		let a = m[k];
		if (a) a.splice(a.indexOf(v), 1);
	}
	
	function getFromMap(m, k) {
		let a = m[k];
		if (a && a.length > 0) return a[0];
		return null;
	}

	const coordsToKey = (coords) => coords.join(',');

	let outerWays = [], outerFirstMap = {}, outerLastMap = {};
	let innerWays = [], innerFirstMap = {}, innerLastMap = {};
	
	for (let segment of waySegments) {
		let ways = innerWays, firstMap = innerFirstMap, lastMap = innerLastMap;
		if (/<member type="way" ref=".+" role="outer">/g.test(segment)) {
			ways = outerWays, firstMap = outerFirstMap, lastMap = outerLastMap;
		}

		let ndRegEx = /<nd lat="([\d\.]+)" lon="([\d\.]+)"\/>/g;
		let match = null, way = [];
		while (match = ndRegEx.exec(segment))
			way.push([match[2], match[1]]);
		ways.push(way);
		addToMap(firstMap, coordsToKey(first(way)), way);
		addToMap(lastMap, coordsToKey(last(way)), way);
	}

	function constructPolygons(ways, firstMap, lastMap, clockwise) {
		const isRing = a => coordsToKey(first(a)) === coordsToKey(last(a));
		const strToFloat = el => el instanceof Array? el.map(strToFloat) : parseFloat(el);

		function isClockwise(a, xIdx, yIdx) {
			xIdx = xIdx || 0, yIdx = yIdx || 1;
			let m = a.reduce((last, v, current) => a[last][0] > v[0] ? last : current, 0);
			let l = m <= 0? a.length - 1 : m - 1, r = m >= a.length - 1? 0 : m + 1;
			let xa = a[l][xIdx], xb = a[m][xIdx], xc = a[r][xIdx];
			let ya = a[l][yIdx], yb = a[m][yIdx], yc = a[r][yIdx];
			let det = (xb - xa) * (yc - ya) - (xc - xa) * (yb - ya);
			return det < 0;
		}

		let rs = [], way = null;
		while (way = ways.pop()) {
			removeFromMap(firstMap, coordsToKey(first(way)), way);
			removeFromMap(lastMap, coordsToKey(last(way)), way);

			if (isRing(way)) {
				way = strToFloat(way);
				if (isClockwise(way) !== clockwise) way.reverse();
				rs.push(way);
			} else {
				let line = [];
				let current = way;
				let reversed = false;
				while (current) {
					line = line.concat(current);
					let key = coordsToKey(last(line));
					reversed = false;

					current = getFromMap(firstMap, key);										
					if (!current) {
						current = getFromMap(lastMap, key);
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
				// points of an outerpolygon should be organized counterclockwise
				if (isRing(line)) {
					line = strToFloat(line);
					if (isClockwise(line) !== clockwise) line.reverse();
					rs.push(line);
				}
			}
		}
		return rs;
	}

	let outerPolygons = constructPolygons(outerWays, outerFirstMap, outerLastMap, false),
		innerPolygons = constructPolygons(innerWays, innerFirstMap, innerLastMap, true);
	
	// link inner polygons to outer containers
	function ptInsidePolygon(pt, polygon, lngIdx, latIdx) {
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

	for (let idx in outerPolygons) {
		compositPolyons[idx] = [];
		compositPolyons[idx].push(outerPolygons[idx]);
	}
	
	let ipg = null;
	while (ipg = innerPolygons.pop()) {
		for (let idx in outerPolygons) {
			if (ptInsidePolygon(first(ipg), outerPolygons[idx])) {
				compositPolyons[idx].push(ipg);
				break;
			}
		}
	}
		
	// construct return value (geojson polyon or multipolygon)
	let geom = {
		type: 'MultiPolygon',
		coordinates: compositPolyons
	};
	
	if (compositPolyons.length === 1) geom = {
		type: 'Polygon',
		coordinates: compositPolyons[0]
	};
	
	return geom;
};