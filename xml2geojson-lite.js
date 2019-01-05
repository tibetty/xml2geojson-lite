(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
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
