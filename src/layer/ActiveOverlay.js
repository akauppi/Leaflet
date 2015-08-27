/*
 * L.ActiveOverlay sets an independent SVG universe over the map, handling the
 * panning and scaling without any modifications within the SVG universe required
 * (i.e. ActiveOverlay adjusts the svg viewbox appropriately).
 *
 * In practice, this is akin to 'L.ImageOverlay' but the contents can move, be
 * animated and be interactive.
 *
 * Since the technique doesn't touch the internals of the SVG at all, any SVG library
 * (such as SnapSVG, D3 or svg.js) can be used.
 *
 * Pros:
 *    - any SVG library can be used (such as SnapSVG, D3 or svg.js)
 *    - anything is possible (that SVG itself supports)
 *
 * Cons:
 *    - not tiled; if you have a lot of polylines, or your data covers a wide
 *      geographic area, it may be best to use the normal Leaflet vector elements
 *      for drawing those (you can of course do a hybrid of vectors + activeOverlay).
 *
 * Developer note:
 *    - If this code were to be taken to Leaflet proper, one day, it may be useful
 *      to create a common base class for 'L.ImageOverlay' and this; common code
 *      could then live in that base class.
 */

L.ActiveOverlay = L.Layer.extend({

	/* Design note: there does not seem to be a way to apply opacity to an 'svg' HTML tag,
	 *       so it's left out of options, compared to 'L.ImageOverlay'. To get the
	 *       same effect, one can set a group ('<g>') within the SVG and control its opacity instead.
	 */
	options: {
		unit: 1.0,            // SVG units (meters)
		interactive: false    // like 'L.ImageOverlay' has interactive 'false' by default
	},

	/* Design note: either the caller or us could create the 'svgElem' (now we do it).
	 */
	initialize: function (bounds, options) { // (LatLngBounds [, Object])
		this._bounds = bounds;
		this._zoomAnimated = true;
		this._initSvg();    // sets 'this._svgElem'

		// Set elsewhere:
		//
		// this._initialized: boolean   (true)
		// this._svgSize: Point         (constant)
		// this._factor: number         (varies by the zoom level)

		L.Util.setOptions(this, options);
	},

	onAdd: function () {
		var el = this._svgElem;

		/*** REMOVE
		// tbd: do we need to update both '.className' and '.classList' this way? AKa270815
		//
		el.className = 'leaflet-active-layer ' + (this._zoomAnimated ? 'leaflet-zoom-animated' : '');

		el.classList.add('leaflet-active-layer');
		if (this._zoomAnimated) {
			el.classList.add('leaflet-zoom-animated');
		}
		***/

		if (this.options.interactive) {
			L.DomUtil.addClass(el, 'leaflet-interactive');
			this.addInteractiveTarget(el);
		}

		this.getPane().appendChild(el);
		this._reset();
	},

	onRemove: function () {
		L.DomUtil.remove(this._svgElem);
		if (this.options.interactive) {
			this.removeInteractiveTarget(this._image);
		}
	},

	bringToFront: function () {
		if (this._map) {
			L.DomUtil.toFront(this._svgElem);
		}
		return this;
	},

	bringToBack: function () {
		if (this._map) {
			L.DomUtil.toBack(this._svgElem);
		}
		return this;
	},

	getEvents: function () {
		var events = {
		  zoom: this._reset,
			viewreset: this._reset
		};

		if (this._zoomAnimated) {
			events.zoomanim = this._animateZoom;
		}

		return events;
	},

	getBounds: function () {
		return this._bounds;
	},

	getElement: function () {
		return this._svgElem;
	},

	_initSvg: function () {
		this._svgElem = L.DomUtil.create('svg',
				'leaflet-active-layer ' + (this._zoomAnimated ? 'leaflet-zoom-animated' : ''));

		var el = this._svgElem;
		el.onselectstart = L.Util.falseFn;
		el.onmousemove = L.Util.falseFn;
	},

	_animateZoom: function (e) {
		var scale = this._map.getZoomScale(e.zoom),
			offset = this._map._latLngToNewLayerPoint(this._bounds.getNorthWest(), e.zoom, e.center);

		L.DomUtil.setTransform(this._svgElem, offset, scale);
	},

	_reset: function () {      // ([Event]) ->
		var el = this._svgElem;

		if (!this._initial) {
			this._initial = true;

			// Find the width and height of the bounding box, in meters.
			//
			var nw = this._bounds.getNorthWest();

			var mWidth = nw.distanceTo(this._bounds.getNorthEast());    // width (m)
			var mHeight = nw.distanceTo(this._bounds.getSouthWest());   // height (m)

			var svgSize = L.point(mWidth, mHeight)._divideBy(this.options.unit);

			// The actual dimensions (in meters) get anchored in the SVG 'viewBox' properties
			// (and don't change by zooming or panning). These are the SVG coordinate dimensions
			// of the bounding box.
			//
			el.setAttribute('viewBox', [0, 0, svgSize.x, svgSize.y].join(' '));

			this._svgSize = svgSize;
		}

		// Pixels from the top left of the map, if the map hasn't been panned
		//
		var pBounds = L.bounds(
			this._map.latLngToLayerPoint(this._bounds.getNorthWest()),
			this._map.latLngToLayerPoint(this._bounds.getSouthEast())
	  );

		var size = pBounds.getSize();    // size in screen pixels

		// Note: We're currently only considering the 'x' factor in latLngToSvgPoint
		//      calculations. To be more precise, we could consider both (they are
		//      close to each other but not completely the same).
		//
		//console.log('X factor: ' + (size.x / this._svgSize.x));
		//console.log('Y factor: ' + (size.y / this._svgSize.y));

		this._factor = size.x / this._svgSize.x;      // pixels / m

		L.DomUtil.setPosition(el, pBounds.min);

		el.style.width  = size.x + 'px';
		el.style.height = size.y + 'px';
	},

	/*
	* Conversion of LatLng coordinates to/from SVG coordinates.
	*
	* Note: For a normal image, this would mean conversion from/to pixel coordinates
	*      (which feature is not in the 'ImageOverlay' API but could be).
	*/
	latLngToSvgPoint: function(latLng) {  // (LatLng) -> Point
		var offset = L.DomUtil.getPosition(this._svgElem);    // offset in screen pixels, without panning

		var p = this._map.latLngToLayerPoint(latLng)._subtract(offset)._divideBy(this._factor);
		return p;
	},

	// Note: This has not been tested!!
	//
	svgPointToLatLng: function(p) {   // (Point) -> LatLng
		var offset = L.DomUtil.getPosition(this._svgElem);

		var latlng = this._map.layerPointToLatLng(p.multiplyBy(this._factor)._add(offset));
		return latlng;
	},

	/*
	* Size of a screen pixel in SVG dimensions.
	*
	* Note: Returning a 'Point' though it's a dimension, not a coordinate.
	*
	* Note: The API is ready for storing separate x and y factors, though currently we don't.
	*/
	pixelToSvg: function() {    // () -> Point
		var tmp = 1.0 / this._factor;
		return L.point(tmp, tmp);
	}
});

L.activeOverlay = function (bounds, options) {   // (LatLngBounds [, Object])
	return new L.ActiveOverlay(bounds, options);
};
