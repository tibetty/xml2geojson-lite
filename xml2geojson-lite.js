let xml2geojson = (xml) => {
	let ommitComments = s => s.replace(/<!--[^]+?-->/g, '');
	xml = ommitComments(xml);

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
	
	let getFromMap = (m, k) => {
		let a = m[k];
		if (a && a.length > 0) return a[0];
		return null;
	}

	let coordsToKey = (coords) => coords.join(',');

	let outerWays = [], outerFirstMap = {}, outerLastMap = {};
	let innerWays = [], innerFirstMap = {}, innerLastMap = {};

	let wayRegEx = /(<member type="way" ref=".+" role=".+">[^]+?<\/member>)/g, wayMatch = null;
	while (wayMatch = wayRegEx.exec(xml)) {
		let wayElem = wayMatch[0];
		let ways = outerWays, firstMap = outerFirstMap, lastMap = outerLastMap;
		if (/<member type="way" ref=".+" role="inner">/g.test(wayElem)) {
			ways = innerWays, firstMap = innerFirstMap, lastMap = innerLastMap;
		}

		let ndRegEx = /<nd lat="([\d\.]+)" lon="([\d\.]+)"\/>/g, ndMatch = null, way = [];
		while (ndMatch = ndRegEx.exec(wayElem))
			way.push([ndMatch[2], ndMatch[1]]);
		ways.push(way);
		addToMap(firstMap, coordsToKey(first(way)), way);
		addToMap(lastMap, coordsToKey(last(way)), way);
	}

	let letructRings = (ways, firstMap, lastMap, direction) => {
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
				
				if (isRing(line)) {
					line = strToFloat(line);
					if (ringDirection(line) !== direction) line.reverse();
					rs.push(line);
				}
			}
		}
		return rs;
	}

	let outerRings = letructRings(outerWays, outerFirstMap, outerLastMap, 'counterclockwise'),
		innerRings = letructRings(innerWays, innerFirstMap, innerLastMap, 'clockwise');
	
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
	
	let ir = null;
	while (ir = innerRings.pop()) {
		for (let idx in outerRings) {
			if (ptInsidePolygon(first(ir), outerRings[idx])) {
				compositPolyons[idx].push(ir);
				break;
			}
		}
	}
		
	// letruct return value (geojson polyon or multipolygon)
	if (compositPolyons.length === 1) return {
		type: 'Polygon',
		coordinates: compositPolyons[0]
	};

	return {
		type: 'MultiPolygon',
		coordinates: compositPolyons
	};
}