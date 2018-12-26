module.exports = (xml) => {
	// parse outer/inner ways
	let outerWays = [], outerFirstMap = {}, outerLastMap = {};
	let innerWays = [], innerFirstMap = {}, innerLastMap = {};
	
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
		if (a && a.length >= 1) return a[0];
		return null;
	}

	const coordsToKey = (coords) => coords.join(',');
	
	let outerSegments = xml.split(/(<member type="way" ref="\d+" role="outer">)/);
	for (let i = 1; i < outerSegments.length; i += 2) {
		let idx = outerSegments[i + 1].indexOf('</member>');
		let outerContent = outerSegments[i + 1].substring(0, idx);
		let leftOver = outerSegments[i + 1].substring(idx + '</member>'.length);
		let way = [];
		let ndRegEx = /<nd lat="([\d\.]+)" lon="([\d\.]+)"\/>/g;
		let match = null;
		while (match = ndRegEx.exec(outerContent))
			way.push([match[2], match[1]]);
		outerWays.push(way);
		addToMap(outerFirstMap, coordsToKey(first(way)), way);
		addToMap(outerLastMap, coordsToKey(last(way)), way);
		let innerSegments = leftOver.split(/(<member type="way" ref="\d+" role="inner">)/);
		if (innerSegments.length > 1) {
			for (let j = 1; j < innerSegments.length; j += 2) {
				let innerContent = innerSegments[j + 1].substring(0, innerSegments[j + 1].indexOf('</member>'));
				let way = [];
				while (match = ndRegEx.exec(innerContent))
					way.push([match[2], match[1]]);
				innerWays.push(way);
				addToMap(innerFirstMap, coordsToKey(first(way)), way);
				addToMap(innerLastMap, coordsToKey(last(way)), way);
			}
		}
	}
	
	const isRing = a => coordsToKey(first(a)) === coordsToKey(last(a));
	
	function isClockwise(a, xIdx, yIdx) {
		xIdx = xIdx || 0, yIdx = yIdx || 1;
		let m = a.reduce((last, v, current) => a[last][0] > v[0] ? last : current, 0);
		let l = m <= 0? a.length - 1 : m - 1, r = m >= a.length - 1? 0 : m + 1;
		let xa = a[l][xIdx], xb = a[m][xIdx], xc = a[r][xIdx];
		let ya = a[l][yIdx], yb = a[m][yIdx], yc = a[r][yIdx];
		let det = (xb - xa) * (yc - ya) - (xc - xa) * (yb - ya);
		return det < 0;
	}

	const strToFloat = el => el instanceof Array? el.map(strToFloat) : parseFloat(el);

	// join outer ways to form outer polygons
	let outerPolygons = [], innerPolygons = [];
	let way = null;
	while (way = outerWays.pop()) {
		if (isRing(way)) {
			way = strToFloat(way);
			if (isClockwise(way)) way.reverse();
			outerPolygons.push(way);
		} else {
			let line = [];
			let current = way;
			let reversed = false;
			removeFromMap(outerFirstMap, coordsToKey(first(current)), current);
			removeFromMap(outerLastMap, coordsToKey(last(current)), current);
			while (current) {
				line = line.concat(current);
				let key = coordsToKey(last(line));
				reversed = false;

				current = getFromMap(outerFirstMap, key);										
				if (!current) {
					current = getFromMap(outerLastMap, key);
					reversed = true;
				}
				
				if (current) {
					outerWays.splice(outerWays.indexOf(current), 1);
					removeFromMap(outerFirstMap, coordsToKey(first(current)), current);
					removeFromMap(outerLastMap, coordsToKey(last(current)), current);
					if (reversed) current.reverse();
					current = current.slice(1);
				}
			}
			// points of an outerpolygon should be organized counterclockwise
			if (isRing(line)) {
				line = strToFloat(line);
				if (isClockwise(line)) line.reverse();
				outerPolygons.push(line);
			}
		}
	}
	
	// join inner ways to form outer polygons
	while (way = innerWays.pop()) {
		if (isRing(way)) {
			way = strToFloat(way);
			if (!isClockwise(way)) way.reverse();
			innerPolygons.push(way);
		} else {
			let line = [];
			let current = way;
			let reversed = false;
			removeFromMap(innerFirstMap, coordsToKey(first(current)), current);
			removeFromMap(innerLastMap, coordsToKey(last(current)), current);
			while (current) {
				line = line.concat(current);
				let key = coordsToKey(last(line));
				reversed = false;

				current = getFromMap(innerFirstMap, key);
				if (!current) {
					current = getFromMap(innerLastMap, key);
					reversed = true;
				}

				if (current) {
					innerWays.splice(innerWays.indexOf(current), 1);
					removeFromMap(innerFirstMap, coordsToKey(first(current)), current);
					removeFromMap(innerLastMap, coordsToKey((current)), current);
					if (reversed) current.reverse();
					current = current.slice(1);
				}
			}
			// points of an innerpolygon should be organized clockwise
			if (isRing(line)) {
				line = strToFloat(line);
				if (!isClockwise(line)) line.reverse();
				innerPolygons.push(line);
			}
		}
	}
	
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

