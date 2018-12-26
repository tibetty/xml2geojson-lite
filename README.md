xml2geojson-lite
============

A lightweight yet faster convertor for [OSM](http://openstreetmap.org) [data](http://wiki.openstreetmap.org/wiki/OSM_XML) to [GeoJSON](http://www.geojson.org/) - about 8x faster than xmldom + osmtogeojson in most situations - implemented in pure JavaScript without any 3rd party dependency

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

### `osmtogeojson(osm_xml)`

Converts OSM XML data to GeoJSON.

* `osm_xml`: the OSM XML data, in string.


Reminder
---
Please fasten your seat-belt before run the test script (node test.js)

Node.JS version
---
  4.x+ with major ES 6 features supports
  
Dependencies
---
  - No 3rd party dependency

License
---
Written in 2018 by tibetty <xihua.duan@gmail.com>

