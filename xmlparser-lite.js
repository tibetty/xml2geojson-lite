module.exports = class{
	constructor(queryParent) {
		this.queryParent = queryParent? true : false;
		if (this.queryParent) {
			this.parentMap = new WeakMap();
		}
		this.evtListeners = {};
	}

	parse(xml, parent, dir) {
		dir = dir? dir + '.' : '';
		let elemRegEx = /<([^ >\/]+)(.*?)>/g, elemMatch = null, nodes = [];
		while (elemMatch = elemRegEx.exec(xml)) {
			let tag = elemMatch[1], node = {tag}, fullTag = dir + tag; 

			let closed = false;
			let attRegEx = /([^ ]+?)="(.+?)"/g, attrText = elemMatch[2].trim(), attMatch = null;
			if (attrText.endsWith('/') || tag.startsWith('?') || tag.startsWith('!')) {
				closed = true;
			}

			let hasAttrs = false;
			while (attMatch = attRegEx.exec(attrText)) {
				hasAttrs = true;
				node[`$${attMatch[1]}`] = attMatch[2];
			}

			if (!hasAttrs && attrText !== '') node.text = attrText;
			this.emit(`<${fullTag}>`, node, parent);


			if (!closed) {
				let innerRegEx = new RegExp(`([^]+?)<\/${tag}>`, 'g');
				innerRegEx.lastIndex = elemRegEx.lastIndex;
				let innerMatch = innerRegEx.exec(xml);
				if (innerMatch && innerMatch[1]) {
					elemRegEx.lastIndex = innerRegEx.lastIndex;
					let innerNodes = this.parse(innerMatch[1], node, fullTag);
					if (innerNodes.length > 0) node.innerNodes = innerNodes;
					else node.innerText = innerMatch[1];
				}
			}
			if (this.queryParent && parent) {
				this.parentMap.set(node, parent);
			}

			this.emit(`</${fullTag}>`, node, parent);
			nodes.push(node);
		}

		return nodes;
	}

	getParent(node) {
		if (this.queryParent)
			return this.parentMap.get(node);
		return null;
	}

	addListener(evt, func) {
		let funcs = this.evtListeners[evt];
		if (funcs) funcs.push(func);
		else this.evtListeners[evt] = [func];
	}

	removeListener(evt, func) {
		let funcs = this.evtListeners[evt];
		if (funcs) {
			funcs.splice(funcs.indexOf(func), 1);
		}
	}

	emit(evt, ...args) {
		let funcs = this.evtListeners[evt];
		if (funcs) {
			for (let func of funcs) {
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