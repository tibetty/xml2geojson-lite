(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
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
			addToMap(this.firstMap, coordsToKey(first(way)), way);
			addToMap(this.lastMap, coordsToKey(last(way)), way);
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
				// self-contained ring
				if (isRing(way)) {
					way = strToFloat(way);
					if (ringDirection(way) !== direction) {
						way.reverse();
					}
					rings.push(way);
				}
				// need to do concatenation to form a ring
				else {
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
							if (isRing(current)) {
								current = strToFloat(current);
								if (ringDirection(current) !== direction) {
									current.reverse();
								}
								rings.push(current);
							}
						}
					} while (next);
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
},{"./xmlparser.js":2}],2:[function(require,module,exports){
module.exports = (() => {
	function conditioned(evt) {
		return evt.match(/^(.+?)\[(.+?)\]>$/g) != null;
	}

	function parseEvent(evt) {
		let match = /^(.+?)\[(.+?)\]>$/g.exec(evt);
		if (match)
			return {evt: match[1] + '>', exp: match[2]};
		return {evt: evt};
	}

	function genConditionFunc(cond) {
		let body = 'return ' + cond.replace(/(\$.+?)(?=[=!.])/g, 'node.$&') + ';';
		return new Function('node', body);
	}

	return class {
		constructor(opts) {
			if (opts) {
				this.queryParent = opts.queryParent? true : false;
				this.progressive = opts.progressive;
				if (this.queryParent) this.parentMap = new WeakMap();
			}
			this.evtListeners = {};
		}

		parse(xml, parent, dir) {
			dir = dir? dir + '.' : '';
			let nodeRegEx = /<([^ >\/]+)(.*?)>/mg, nodeMatch = null, nodes = [];
			while (nodeMatch = nodeRegEx.exec(xml)) {
				let tag = nodeMatch[1], node = {tag}, fullTag = dir + tag; 

				let attrText = nodeMatch[2].trim(), closed = false;
				if (attrText.endsWith('/') || tag.startsWith('?') || tag.startsWith('!')) {
					closed = true;
				}

				let attRegEx = /([^ ]+?)="(.+?)"/g, attMatch = null, hasAttrs = false;
				while (attMatch = attRegEx.exec(attrText)) {
					hasAttrs = true;
					node[`$${attMatch[1]}`] = attMatch[2];
				}

				if (!hasAttrs && attrText !== '') node.text = attrText;
				if (this.progressive) this.emit(`<${fullTag}>`, node, parent);

				if (!closed) {
					let innerRegEx = new RegExp(`([^]+?)<\/${tag}>`, 'g');
					innerRegEx.lastIndex = nodeRegEx.lastIndex;
					let innerMatch = innerRegEx.exec(xml);
					if (innerMatch && innerMatch[1]) {
						nodeRegEx.lastIndex = innerRegEx.lastIndex;
						let innerNodes = this.parse(innerMatch[1], node, fullTag);
						if (innerNodes.length > 0) node.innerNodes = innerNodes;
						else node.innerText = innerMatch[1];
					}
				}
				if (this.queryParent && parent) {
					this.parentMap.set(node, parent);
				}

				if (this.progressive) this.emit(`</${fullTag}>`, node, parent);
				nodes.push(node);
			}

			return nodes;
		}

		getParent(node) {
			if (this.queryParent)
				return this.parentMap.get(node);
			return null;
		}

		$addListener(evt, func) {
			let funcs = this.evtListeners[evt];
			if (funcs) funcs.push(func);
			else this.evtListeners[evt] = [func];
		}

		// support javascript condition for the last tag
		addListener(evt, func) {
			if (conditioned(evt)) {
				// func.prototype = evt;
				evt = parseEvent(evt);	
				func.condition = genConditionFunc(evt.exp);
				evt = evt.evt;
			}
			this.$addListener(evt, func);
		}

		$removeListener(evt, func) {
			let funcs = this.evtListeners[evt];
			if (funcs) {
				funcs.splice(funcs.indexOf(func), 1);
			}
		}

		removeListener(evt, func) {
			if (conditioned(evt)) {
				evt = parseEvent(evt);	
				evt = evt.evt;
			}
			this.$removeListener(evt, func);
		}

		emit(evt, ...args) {
			let funcs = this.evtListeners[evt];
			if (funcs) {
				for (let func of funcs) {
					if (func.condition) {
						if (func.condition.apply(null, args) === true)
							func.apply(null, args);
					} else 
						func.apply(null, args);
				}
			}
		}

		on(evt, func) {
			this.addListener(evt, func);
		}

		off(evt, func) {
			this.removeListener(evt, func);
		}
	};
})();
},{}]},{},[1]);
