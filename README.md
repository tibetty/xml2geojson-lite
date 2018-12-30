xml2geojson-lite
============

A lightweight yet faster convertor for [OSM](http://openstreetmap.org) [data](http://wiki.openstreetmap.org/wiki/OSM_XML) to [GeoJSON](http://www.geojson.org/) - much faster than xmldom + osmtogeojson in most situations - implemented in pure JavaScript without any 3rd party dependency

Usage
-----

### nodejs library

Installation:

    $ npm install xml2geojson-lite

Usage:

```js
    const xml2geojson = require('xml2geojson-lite');
    let geojson = xml2geojson(osm_xml);
```

### browser library
```html
    <script src='your/path/to/xml2geojson-lite.js'></script>
```
```js
    let geojson = xml2geojson(osm_xml);
```

API
---

### `osmtogeojson(osm_xml, opts)`

Converts OSM XML data to GeoJSON.

* `osm_xml`: the OSM XML data, in String.
* `opts?`: optional - the options object, right now only supports *allFeatures* option, when it is set to `true`, it will return a comprehensive GeoJSON object as `FeatureCollection` rather than a bare `Polygon/MultiPolygon`.


Reminder
---
Please fasten your seat-belt before run the test script (node test.js)

Node.JS version
---
  ES5/ES6 features
  
Dependencies
---
  - No 3rd party dependency

License
---
Written in 2018 by tibetty <xihua.duan@gmail.com>

