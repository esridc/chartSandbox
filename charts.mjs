import { loadModules, setDefaultOptions } from 'https://unpkg.com/esri-loader/dist/esm/esri-loader.js';

(async () => {

  setDefaultOptions({
    css: true,
    // url: 'http://localhost:8000/buildOutput/init.js',
    // url: 'http://jscore.esri.com/debug/4.16/dojo/dojo.js',
    // version: 'next',
  });

  const [
  Map,
  MapView,
  FeatureLayer,
  generateHistogram,
  HistogramRangeSlider,
  Histogram,
  uniqueValues,
  Legend,
  colorRamps,
  Color,
  viewColorUtils,
  LabelClass,
  CIMSymbol,
  cimSymbolUtils,
] = await loadModules([
  "esri/Map",
  "esri/views/MapView",
  "esri/layers/FeatureLayer",
  "esri/smartMapping/statistics/histogram",
  "esri/widgets/HistogramRangeSlider",
  "esri/widgets/Histogram",
  "esri/smartMapping/statistics/uniqueValues",
  "esri/widgets/Legend",
  "esri/smartMapping/symbology/support/colorRamps",
  "esri/smartMapping/symbology/color",
  "esri/views/support/colorUtils",
  "esri/layers/support/LabelClass",
  "esri/symbols/CIMSymbol",
  "esri/symbols/support/cimSymbolUtils",
]);

  // data urls
  var datasets = {
    'Tucson Demographics': "35fda63efad14a7b8c2a0a68d77020b7_0",
    'Citclops Water': "8581a7460e144ae09ad25d47f8e82af8_0",
    'Seattle Bike Facilities': "f4f509fa13504fb7957cef168fad74f0_1",
    'NYC bags': "7264acdf886941199f7c01648ba04e6b_0",
    'Black Rat Range': "28b0a8a0727d4cc5a2b9703cf6ca4425_0",
    'Traffic Circles': "717b10434d4945658355eba78b66971a_6",
    'King County Photos': "383878300c4c4f8c940272ba5bfcce34_1036",
  }

  // dataset switcher
  var datasetList = document.getElementById('datasetList');
  // populate dropdown with all attributes
  for (let [key, value] of Object.entries(datasets)) {
    // create new option element and add it to the dropdown
    var opt = document.createElement('option');
    opt.text = key;
    opt.value = value;
    datasetList.appendChild(opt);
  }

  datasetList.addEventListener('change', async event => {
    await loadDataset({ datasetId: event.target.value, env: 'prod' });
  });

  // track state
  var state = {};
  function initState() {
    state = {
      dataset: null,
      layer: null,
      view: null,
      widgets: [],
      bgColor: null,
      legend: null,
      categoricalMax: 7,
      fieldName: null,
      highlights: [],
    }
  }
  var chart, cedarChart, guide;
  var matches = [];

  const DATASET_FIELD_UNIQUE_VALUES = {}; // cache by field name

  // URL params
  const params = new URLSearchParams(window.location.search);
  var env = 'prod';
  if (Array.from(params).length != 0) {
    var datasetId = params.get('dataset');
    const datasetSlug = params.get('slug');
    env = params.get('env');
    await loadDataset({ datasetId, datasetSlug, env });
  } else {
    var datasetId = datasetList.options[datasetList.selectedIndex].value;
    await loadDataset({ datasetId, env });
  }

  //
  // CHARTING
  //

  // add a chart, making a best guess at appropriate style based on fieldType and various properties
  async function addChart({event = null, fieldName = null, fieldStats = null}) {
    console.log('addChart:', arguments);
    let {view, layer, dataset} = state;

    // if no fieldName is passed directly, get it from the attribute selection event
    if (fieldName == null) fieldName = event.currentTarget.dataset.field;
    const field = await getDatasetField(fieldName);

    // debugger
    view.ui.add('chart', 'bottom-left');
    var definition = {
      type: "bar",
      datasets: [
        {
          // url: "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_States_Generalized/FeatureServer/0",
          url: dataset.attributes.url,
          query: {
            // orderByFields: "POPULATION DESC"
            orderByFields: fieldName
          }
        }
      ],
      series: [
        {
          // category: { field: "STATE_NAME", label: "US State" },
          // value: { field: "POPULATION", label: "Population" }
          category: { field: "NAME", label: "NAME" },
          value: { field: fieldName, label: fieldName },
        }
      ],
      overrides: {
        "listeners": [
          {
            "event": "init",
            "method": e => {
              console.log('init', e)
              // e.chart.graphs[0].colorField = "color"; // either works
              e.chart.graphs[0].fillColorsField = "color"; // either works
              e.chart.graphs[0].lineColorField = "color";
              chart = e.chart;
              window.chart = e.chart;
              guide = new AmCharts.Guide();
              chart.categoryAxis.addGuide(guide);
            },
          },
          {
            "event": "zoomed",
            "method": e => console.log('zoom')
          },
          {
            "event": "clicked",
            "method": e => console.log('clicked')
          },
          {
            "event": "clickGraphItem",
            "method": e => {
              console.log('clickGraphItem', e)

              // e.item.color = "red";
              e.item.lineColor = "red";
              e.item.fillColors = "red";
              // debugger
              e.chart.drawChart(); // why does drawChart work here but not without an event?
              // e.chart.parseData(); // why does drawChart work here but not without an event?
            }
          },
          {
            "event": "changed", // cursor position has changed on the chart
            "method": async e => {
              var xValue = e.chart.categoryAxis.coordinateToValue(e.x);
              var yValue = AmCharts.roundTo(e.chart.valueAxes[0].coordinateToValue(e.y), 2);
              let feature = e.chart.chartData.filter(i => i.dataContext.NAME == xValue)[0];
              let title = e.chart.valueAxes[0].title
              let name = feature.category;
              console.log(`Chart item: ${name}`)

              drawGuides({name});
              highlightFeature({name});
            }
          },
        ],
      },
    };

    cedarChart = new cedar.Chart("chart", definition);
    window.cedarchart = cedarChart;
    cedarChart.show()
      .then(e => {
        //
      });
    // debugger

    return;

    // let chart = document.createElement('div');
    chart.classList.add('chartDiv');
    fieldStats = fieldStats ? fieldStats : field.statistics;
    chart.innerHTML = await generateLabel(field, fieldStats);

    const numberLike = await datasetFieldIsNumberLike(fieldName);

    // (pseudo-)categorical - most records are covered by a limited # of unique values
    // or all other string values

    if ((field.simpleType === 'string' && !numberLike)) {
      // value list
      var widget = await makeStringWidget({ fieldName, container, slider: true });
    }
    // numerics and dates
    else {
      widget = await makeHistogramWidget({ fieldName, container, slider: true });
      container.classList.add('histogramWidget');
      // set whereClause attribute
      let whereClause = widget.generateWhereClause(fieldName);
      // whereClause = whereClause.replace(fieldName, `CAST(${fieldName} AS FLOAT)`); // for number-like fields
      widget.container.setAttribute('whereClause', whereClause);
    }
    // if (field.simpleType === 'date') {
    //   // Time slider
    //   widget = await makeTimeSliderWidget({ fieldName, container, slider: true });
    // }

    // scroll the sidebar down to show the most recent filter and keep the attribute search visible
    let sidebar = document.getElementById('sidebar')
    sidebar.scrollTop = sidebar.scrollHeight;
    widget.container.setAttribute('fieldName', fieldName);
    widget.container.setAttribute('numberLike', numberLike);
    state = {...state, view, layer};
  }

  //
  // WIDGETS
  //

  // create a histogram
  async function makeHistogram ({fieldName, container, slider = false, where = null, features = null }) {
    // wrap in another container to handle height without fighting w/JSAPI and rest of sidebar
    const parentContainer = container;
    let newcontainer = document.createElement('div');
    parentContainer.appendChild(newcontainer);
    const numberLike = await datasetFieldIsNumberLike(fieldName);
    if (!where) {
      where = "1=1";
    }
    if (numberLike) {
      where = where.replace(fieldName, `CAST(${fieldName} AS FLOAT)`); // for number-like fields
    }

    try {
      let params = {
        layer: state.layer,
        field: fieldName,
        numBins: 30,
        where, // optional where clause
        features // optional existing set of features
      };
      let values, source, coverage;
      try {
        values = await generateHistogram(params);
        source = 'widgets';
        coverage = 1;
      } catch(e) {
        try {
          // histogram generation failed with automated server call, try using features from server query
          console.warn('Histogram generation failed with automated server call, try using features from server query\n', e);
          // params.features = (await layer.queryFeatures()).features;
          // const featureCount = await layer.queryFeatureCount();
          // if (params.features.length != featureCount) throw new Error('params.features.length != featureCount');

          const { features, exceededTransferLimit } = await state.layer.queryFeatures();
          if (exceededTransferLimit) throw new Error('Exceeded server limit querying features');
          params.features = features;

          values = await generateHistogram(params);
          source = 'layerQuery';
          coverage = params.features.length / featureCount;
        } catch(e) {
          // histogram generation failed with automated server call, try using features from server query
          console.warn('Histogram generation failed with server query, try reconstructing from unique values\n', e);

          try {
            let uniqueValues = (await getDatasetFieldUniqueValues(fieldName)).values;
            let domain = [Math.min(...uniqueValues.map(a => a.value)),
                          Math.max(...uniqueValues.map(a => a.value))]
            // manually reconstruct a feature values array from the unique values and their counts -
            let arr = reconstructDataset(uniqueValues);
            // use d3 to bin histograms
            let d3bins = d3.histogram()  // create layout object
            .domain([Math.min(...uniqueValues.map(a => a.value)),
            Math.max(...uniqueValues.map(a => a.value))])  // to cover range
            .thresholds(29) // separated into 30 bins
            (arr);          // pass the array
            // convert the d3 bins array to a bins object
            var bins = [];
            for (let x = 0; x < d3bins.length; x++) {
              bins.push({
                minValue: d3bins[x]['x0'],
                maxValue: d3bins[x]['x1'],
                count: d3bins[x].length,
              });
            }
            // put the bins in the params object
            values = {
              'bins': bins,
              'minValue': Math.min(...uniqueValues.map(a => a.value)),
              'maxValue': Math.max(...uniqueValues.map(a => a.value)),
            }
            const featureCount = arr.length;
            source = 'layerQuery';
            coverage = 1;
          } catch(e) {
          // histogram generation failed with unique values, try using features in layer view
          console.warn('Histogram generation failed with unique values, try using features in layer view\n', e);
          let layerView = await view.whenLayerView(layer);
          params.features = (await layerView.queryFeatures()).features;
          // const featureCount = await layer.queryFeatureCount();
          values = await generateHistogram(params);
          source = 'layerView';
          }
        }
      }

      // Determine if field is an integer
      const field = getDatasetField(fieldName);
      const integer = await datasetFieldIsInteger(fieldName);
      const widget =
        slider ?
          // Histogram range slider widget
          new HistogramRangeSlider({
            bins: values.bins,
            min: values.minValue,
            max: values.maxValue,
            values: [values.minValue, values.maxValue],
            precision: integer ? 0 : 2,
            container: container,
            excludedBarColor: "#dddddd",
            rangeType: "between",
            labelFormatFunction: (value, type) => {
              // apply date formatting to histogram
              if (field.simpleType == 'date') {
                return formatDate(value);
              }
              return value;
            }
          })
        :
          // plain histogram, for miniHistogram nested in timeSlider
          new Histogram({
            bins: values.bins,
            min: values.minValue,
            max: values.maxValue,
            container: container,
            rangeType: "between",
          })
      ;
      return { widget, values, source, coverage };
    }
    catch(e) {
      console.log('histogram generation failed', e);
      return {};
    }
  }

    //
    // UDPATE THINGS
    //

  //
  // UTILITY FUNCTIONS
  //

  // concatenate all the where clauses from all the widgets
  function concatWheres( { server = false } = {}) {
    let whereClause = '';
    let widgets = listWidgetElements();
    // generate master here clause with simple string concatenation
    for (const [x, widget] of widgets.entries()) {
      if (x > 0) whereClause += ' AND ';
      let widgetWhere = widget.getAttribute('whereClause');

      // explicit cast for number-likes, for feature layer (server-side) queries ONLY
      // skip for feature layer view (client-side) queries, which work *without* the cast (but fail with it)
      const numberLike = widget.getAttribute('numberLike') === "true";
      if (server && numberLike) {
        const fieldName = widget.getAttribute('fieldName');
        widgetWhere = widgetWhere.replace(fieldName, `CAST(${fieldName} AS FLOAT)`); // for number-like fields
      }

      whereClause += '(' + widgetWhere + ')';
      // whereClause += '(' + widget.getAttribute('whereClause') + ')';
    }
    return whereClause;
  }

  // draw whole map from scratch
  async function drawMap() {
    var {dataset, layer, view} = state;
    const darkModeCheckbox = document.querySelector('#darkMode calcite-checkbox');
    const map = new Map({
      // choose a light or dark background theme as default
      basemap: darkModeCheckbox?.checked ? "dark-gray-vector" : "gray-vector",
      layers: layer,
    });
    if (view) {
      // update existing view, then exit
      view.map = map;
      state = {...state, view}
      // explicitly wait for bgColor to be updated, then update the layerView
      await getBgColor().then(color => {
        state.bgColor = color;
        // updateLayerViewEffect();
      });
      return view;
    }
    var view = new MapView({
      container: "viewDiv",
      map: map,
      extent: getDatasetExtent(dataset),
      ui: { components: [] },
    });
    view.whenLayerView(layer).then(r => state.layerView = r);

    // put vars on window for debugging
    Object.assign(window, { state, map, getDatasetField, getDatasetFieldUniqueValues, /*histogram, histogramValues,*/ generateHistogram, HistogramRangeSlider, uniqueValues });

    // Dataset info
    document.querySelector('#datasetName').innerHTML = dataset.attributes.name;
    document.querySelector('#orgName').innerHTML = dataset.attributes.orgName || '';
    document.querySelector('#recordCount').innerHTML = `${dataset.attributes.recordCount} records`;

    view.on("pointer-move", async function(evt) {
      let {layerView, highlights} = state;
      var screenPoint = {
        x: evt.x,
        y: evt.y
      };

      // the hitTest() checks to see if any graphics in the view
      // intersect the given screen x, y coordinates
      view.hitTest(screenPoint)
        .then( function(response){
            matches.push(response);
            // highlightFeature(response);
            // debugger
            // console.log('matches:', matches)
        });

      if (matches && matches.length) {
        var match = matches.pop();
        try {
          var name = match.results[0]?.graphic?.attributes?.NAME;
          if (name) {
            console.log('match:', name);

            drawGuides({response: match});
            highlightFeature({response: match});
          }

        } catch(e) {
          //
        }
        matches = [];
      }
    });

    // update state
    state.view = view;
    // bgColor needs state.view to be set first
    state.bgColor = await getBgColor();
    return view;
  }

  async function highlightFeature({response = null, name = null}) {
    let {view, layer} = state;
    var symbol = {
      type: "simple-fill",
      color: [255,0,0,0.5],
      style: "solid",
      outline: {
        color: "red",
        width: 2
      }
    };
    var selectionGraphic = {
      type: "polygon" // autocast to new Graphic()
    };
    if (name) {
      var query = layer.createQuery();
      query.where = `NAME = '${name}'`;
      query.returnGeometry = true;
      response = await layer.queryFeatures(query).then(response => response);
      selectionGraphic.geometry = response.features[0].geometry;
    } else {
      var result = response.results[0]
      selectionGraphic = result.graphic;
    }
    view.graphics.removeAll(); // reset
    selectionGraphic.symbol = symbol;
    view.graphics.add(selectionGraphic);
  }
  window.matches = matches;

  function drawGuides({response = null, name = null}) {
    // get the topmost graphic from the hover location
    // and display select attribute values from the
    // graphic to the user
    if (!name) {
      console.log('response:', response)
      if (!response.results) {
        matches.forEach(i => i.color = undefined)
        matches = [];
        console.log('clear')
        return false;
      }
      var graphic = response.results[0].graphic;
      var attributes = graphic.attributes;
      name = attributes.NAME;
    }

    console.log('name:', name)
    let matchIndex = chart.dataProvider.findIndex(m => m["NAME"] == name);
    let match = chart.dataProvider[matchIndex];

    guide.category = name; // start guide highlight here
    guide.toCategory = name; // end guide highlight here
    guide.expand = true;

    guide.fillAlpha = 1;
    guide.fillColor = "#ff0000";
    chart.categoryAxis.draw(); // AH HA - update guides

  }

  async function loadDataset (args) {
    // reset state
    initState();
    var dataset, layer;
    if (args.url) { // dataset url provided directly
      const datasetURL = args.url;
      try {
        // dataset = (await fetch(datasetURL).then(r => r.json()));
        dataset = {attributes: {url: args.url}}
      } catch(e) { console.log('failed to load dataset from url:', args.url, e); }
    } else if (args.datasetId) { // dataset id provided directly
      // https://opendataqa.arcgis.com/api/v3/datasets/97a641ac39904f349fb5fc25b94207f6
      const datasetURL = `https://opendata${args.env === 'qa' ? 'qa' : ''}.arcgis.com/api/v3/datasets/${args.datasetId}`;
      try {
        dataset = (await fetch(datasetURL).then(r => r.json())).data;
      } catch(e) { console.log('failed to load dataset from id', args.datasetId, e); }
    } else if (args.datasetSlug) { // dataset slug provided as alternate
      // https://opendata.arcgis.com/api/v3/datasets?filter%5Bslug%5D=kingcounty%3A%3Aphoto-centers-for-2010-king-county-orthoimagery-project-ortho-image10-point
      const filter = `${encodeURIComponent('filter[slug]')}=${encodeURIComponent(args.datasetSlug)}`
      const datasetURL = `https://opendata${args.env === 'qa' ? 'qa' : ''}.arcgis.com/api/v3/datasets?${filter}`;
      try {
        dataset = (await fetch(datasetURL).then(r => r.json())).data[0];
      } catch(e) { console.log('failed to load dataset from slug', args.datasetSlug, e); }
    }
    // initialize a new layer
    const url = dataset.attributes.url;
    layer = new FeatureLayer({
      renderer: {type: 'simple'},
      url,
      minScale: 0,
      maxScale: 0,
    });
    // update state
    state = {...state, layer, dataset};

    // clear widgets list
    state.widgets = [];

    // update attributes lists
    updateAttributeList('#chartAttributeList', () => addChart({event}) );

    let chartAttributeSearchElement = document.getElementById("chartAttributeSearch")
    chartAttributeSearchElement.addEventListener("input", chartAttributeSearchInput);
    chartAttributeSearchElement.addEventListener("change", chartAttributeSearchChange); // clear input button
    let chartPlaceholderText = `Search ${dataset.attributes.fields.length} Attributes by Name`;
    chartAttributeSearchElement.setAttribute('placeholder', chartPlaceholderText);

    state.usePredefinedStyle = false; // disable for now
    // draw map once before autoStyling because getBgColor() requires an initialized layerView object
    state.view = await drawMap();
    autoStyle({});  // guess at a style for this field
  }

  // manually reconstruct a feature values array from unique values and their counts
  function reconstructDataset(values) {
    // normalize array length to 1000, as precision isn't as important as speed here
    const divisor = state.dataset.attributes.recordCount / 1000;
    // const divisor = 1; // alternately, use the whole set
    let arr = [];
    for (let x = 0; x < values.length; x++) {
      for (let y = 0; y < Math.ceil(values[x].count/divisor); y++) {
        arr.push(values[x].value);
      };
    }
    return arr;
  }

  // https://stackoverflow.com/questions/6122571/simple-non-secure-hash-function-for-javascript
  function getHash(s) {
    var hash = 0;
    if (s.length == 0) {
        return hash;
    }
    for (var i = 0; i < s.length; i++) {
        var char = s.charCodeAt(i);
        hash = ((hash<<5)-hash)+char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  //
  // STYLING
  //

  // determine whether the map background is dark or light
  async function getBgColor() {
    const {view, layer} = state;
    try {
      // make sure there's a layerView, then
      var bgColor = view.whenLayerView(layer).then(
        // get and return the theme
        async () => await viewColorUtils.getBackgroundColorTheme(view).then(theme => theme));
    } catch(e) {
      console.warn(`Couldn't detect basemap color theme - tab must be in foreground. Choosing "light."\n`, e)
      bgColor = "light"; // set default bgColor
    }
    return bgColor;
  }

  // Choose symbology based on various dataset and theme attributes
  async function autoStyle ({event = null, fieldName = null}) {
    var {dataset, layer, view, usePredefinedStyle} = state;

    // SET COLORS

    // get basemap color theme: "light" or "dark"
    var bgColor = await getBgColor();
    state.bgColor = bgColor;

    // choose default colors based on background theme – dark on light, light on dark
    // use rgb values because CIMSymbols don't understand web color names
    var fillColor = bgColor == "dark" ? [0,196,210,255] : [173,216,230,255]; // lightblue and steelblue
    var strokeColor = bgColor == "dark" ? [70,130,180,255] : [70,130,180,255]; // steelblue and white
    // set bad-value colors
    const badStrokeColor = geotype == "line" ? bgColor == "dark" ? [128,128,128,255] : [64,64,64,255] : [128,128,128,255]; // grey outlines
    const badFillColor = [255,255,255,255]; // white fills
    // set "other" colors for unique-value renderers
    const otherStrokeColor = [128,128,128,255]; // grey
    const otherFillColor = [192,192,192,255]; // light grey

    var symbol;
    var renderer = {
      type: "simple", // autocasts as new SimpleRenderer()
      visualVariables: [],
    };

    // declare shorthand geometry types
    const geometryType = dataset.attributes.geometryType;
    var geotype = (geometryType == 'esriGeometryPoint') ? 'point'
                : (geometryType == 'esriGeometryMultiPoint') ? 'point'
                : (geometryType == 'esriGeometryPolygon') ? 'polygon'
                : (geometryType == 'esriGeometryLine') ? 'line'
                : (geometryType == 'esriGeometryPolyline') ? 'line'
                : geometryType;

    // SET GEOMETRY

    if (geotype === 'point') {
      // use CIMSymbol so we can have sub-pixel outline widths
      var cimsymbol = new CIMSymbol({
        data:  {
          type: "CIMSymbolReference",
          symbol: {
            type: "CIMPointSymbol",
            symbolLayers: [{
                type: "CIMVectorMarker",
                enable: true,
                size: 16,
                frame: {
                  xmin: 0,
                  ymin: 0,
                  xmax: 14,
                  ymax: 14
                },
                markerGraphics: [{
                  type: "CIMMarkerGraphic",
                  geometry: {
                    // circle geo taken from https://developers.arcgis.com/javascript/latest/sample-code/sandbox/index.html?sample=cim-primitive-overrides
                    rings: [
                      [
                        [8.5, 0.2],[7.06, 0.33],[5.66, 0.7],[4.35, 1.31],[3.16, 2.14],[2.14, 3.16],[1.31, 4.35],[0.7, 5.66],[0.33, 7.06],[0.2, 8.5],[0.33, 9.94],[0.7, 11.34],[1.31, 12.65],[2.14, 13.84],[3.16, 14.86],[4.35, 15.69],[5.66, 16.3],[7.06, 16.67],[8.5, 16.8],[9.94, 16.67],[11.34, 16.3],[12.65, 15.69],[13.84, 14.86],[14.86, 13.84],[15.69, 12.65],[16.3, 11.34],[16.67, 9.94],[16.8, 8.5],[16.67, 7.06],[16.3, 5.66],[15.69, 4.35],[14.86, 3.16],[13.84, 2.14],[12.65, 1.31],[11.34, 0.7],[9.94, 0.33],[8.5, 0.2]
                      ]
                    ]},
                  symbol: {
                    type: "CIMPolygonSymbol",
                    symbolLayers: [
                      {
                        type: "CIMSolidStroke",
                        width: .45,
                        color: strokeColor,
                      },
                      {
                        type: "CIMSolidFill",
                        color: fillColor,
                      },
                    ]
                  }
                }]
            }]
          }
        }
      });
      symbol = cimsymbol;

    } else if (geotype === 'line') {
      symbol = {
        type: 'simple-line',
        width: '2px',
        color: strokeColor,
      };

    } else if (geotype === 'polygon') {
      symbol = {
        type: 'simple-fill',
        color: fillColor,
        outline: {
          color: strokeColor,
          width: 0.5,
        },
      };
    }

    // GET FIELD

    // check for fieldName in args, the event object,
    if (!fieldName) { fieldName = event?.currentTarget?.getAttribute('data-field'); }
    // a displayField specified in the dataset,
    if (!fieldName) { fieldName = dataset?.attributes?.displayField; }
    // or just set default fieldName to "NAME"
    if (!fieldName && dataset.attributes.fieldNames.includes("NAME")) { fieldName = "NAME"; }

    // if there's a fieldName then style it by field
    fieldStyle: // label this block so we can break out of it when necessary
    if (fieldName) {
      state.fieldName = fieldName; // used by toggle checkboxes
      var field = getDatasetField(fieldName);
      // TODO: don't use cached statistics, as they're frequently out-of-date and incomplete
      var fieldStats = field.statistics;
      if (fieldStats.values.length == 0) { // it happens
        console.warn("Couldn't get statistics values for field '"+fieldName+"'.");
        break fieldStyle;
      }
      try {
        // sometimes stats have .min and .max, sometimes they have .value and .count
        var { categorical, pseudoCategorical } = await datasetFieldCategorical(fieldName);
        var numberLike = await datasetFieldIsNumberLike(fieldName);
        if (field.simpleType == "string" && numberLike) {
          // recast values as numbers and resort
          fieldStats.values = fieldStats.values.map(e => Object.assign({...e, value: parseFloat(e.value)}))
            .sort((a, b) => a.value !== b.value ? a.value < b.value ? -1 : 1 : 0);
        }
        var minValue =
          typeof fieldStats.values.min !== "undefined" ? fieldStats.values.min :
          typeof fieldStats.values.length !== "undefined" ? fieldStats.values[0].value :
          null;
        var minLabel = minValue;
        var maxValue =
          typeof fieldStats.values.max !== "undefined" ? fieldStats.values.max :
          typeof fieldStats.values.length !== "undefined" ? fieldStats.values[fieldStats.values.length -1].value :
          null;
        var maxLabel = maxValue;
      } catch(e) {
        console.warn("Couldn't get statistics for styling field '"+fieldName+"':", e);
        break fieldStyle;
      }

      // don't use predefined styles for now
      // } else if (usePredefinedStyle) {
      //   // check for built-in style passed in with the dataset
      //   let predefinedStyle = dataset.attributes?.layer?.drawingInfo;
      //   if (predefinedStyle && usePredefinedStyle) {
      //     layer = await new FeatureLayer({
      //       // renderer: jsonUtils.fromJSON(predefinedStyle.renderer),
      //       // url
      //     });
      //   }
      // }

      // don't use predefined labelingInfo for now
      // if (layer.labelingInfo && !usePredefinedStyle) {}

      // clear any existing labelingInfo sent from the server
      layer.labelingInfo = [ ];
      var uniqueValues = (await getDatasetFieldUniqueValues(fieldName)).values;
      var numGoodValues = uniqueValues.filter(i => !isBadValue(i.value)).length;

      // STYLING

      // reset colors – these will be used as "No value" symbols
      symbol = copyAndColor(symbol, strokeColor, fillColor);

      let {categoricalMax} = state;
      if (categorical || (pseudoCategorical && !numberLike)) {
        // your basic categorical field
        // GET RAMP
        let ramp = colorRamps.byName("Mushroom Soup");
        let rampColors = ramp.colors;
        var numColors = rampColors.length;

        // if the field has only a single unique non-bad value, pick a single color, hashing by fieldName –
        // this will be more likely to show a visual change when switching between two fields which both have a single value
        if ( (numGoodValues == 1) ||
            ((fieldStats.values.min && fieldStats.values.max) &&
                (fieldStats.values.min === fieldStats.values.max))
            ) {
          var indexOffset = getHash(fieldName) % numColors; // pick an offset
          // replace the entire ramp with a single color
          rampColors = [rampColors[indexOffset]];
          numColors = 1;
        }

        // sort by values - if only pseudocategorical leave it sorted by the default: prevalence
        if (categorical) {
          uniqueValues.sort((a, b) => a.value !== b.value ? a.value < b.value ? -1 : 1 : 0);
        }
        // TODO: sort before assigning color values? currently values are assigned color by frequency

        // generate categorical colors for field
        var uniqueValueInfos = [];
        // pick a limit to the number of legend entries
        const numEntries = categorical ? Math.min(uniqueValues.length, categoricalMax) : // the top categories
                           pseudoCategorical <= categoricalMax ? pseudoCategorical : // the top pseudocategories
                           5; // just show the top 5
        if (numGoodValues == 0 && uniqueValues.length == 1) { // it happens
          var defaultSymbol = copyAndColor(symbol, badStrokeColor, badFillColor);
          var defaultLabel = "No value";
        } else {
          for (let x = 0; x < numEntries; x++) {
            if (isBadValue(uniqueValues[x].value)) {
              // style any bad points as white rings and lines as grey
              var strokeColor = badStrokeColor;
              var fillColor = badFillColor;

            } else {
              // rollover calculation
              // TODO: interpolate over whole range to prevent duplicate colors
              var indexOffset = x % numColors;
              var strokeColor = [
                // TODO: switch to proportional interpolation
                rampColors[indexOffset].r * .5, // same as fillColor but half as bright
                rampColors[indexOffset].g * .5,
                rampColors[indexOffset].b * .5,
                255 //alpha is always opaque
              ];
              // set fillColor
              var fillColor = [
                rampColors[indexOffset].r,
                rampColors[indexOffset].g,
                rampColors[indexOffset].b,
                255 // alpha is always opaque
              ];
            }

            // clone and color symbol
            let uniqueSymbol = copyAndColor(symbol, strokeColor, fillColor);
            // add symbol to the stack
            uniqueValueInfos.push( {
              value: uniqueValues[x].value || "",
              label: field.simpleType == "date" ? formatDate(uniqueValues[x].value) :
                      isBadValue(uniqueValues[x].value) ? "No value" :
                      uniqueValues[x].value,
              symbol: uniqueSymbol,
            });
          }
        }

        let numOthers = uniqueValues.length - numEntries;
        // set defaults
        if (numOthers > 0) {
          // use the "other" default color for the long tail of categories
          var defaultSymbol = copyAndColor(symbol, otherStrokeColor, otherFillColor);
          var defaultLabel = (numOthers + " other") + (numOthers > 1 ? "s" : "");
        }

        // set renderer
        renderer = {...renderer,
          type: "unique-value",
          defaultSymbol,
          defaultLabel,
          uniqueValueInfos,
        };
      } else if (numberLike) { // number-like and non-categorical
        // SET RAMP
        // custom ramp - pink to blue
        var rMin = {r:255, g:200, b:221, a:255};
        var rMax = bgColor == "dark" ? {r:61, g:79, b:168, a:255} : {r:21, g:39, b:128, a:255};

        renderer.visualVariables.push({
          type: "color",
          field: fieldName,
          stops: [{
            value: minValue,
            color: {r: rMin.r, g: rMin.g, b: rMin.b, a: 1},
            label: (field.simpleType == "date") ? formatDate(minValue) : minLabel
          },{
            value: maxValue,
            color: {r: rMax.r, g: rMax.g, b: rMax.b, a: 1},
            label: (field.simpleType == "date") ? formatDate(maxValue) : maxLabel
          }]
        });

        if (field.simpleType !== "date") {
          // add one more midValue
          var midValue = (parseFloat(maxValue)+parseFloat(minValue))/2;
          // if min and max are integers, make mid integer too
          if (numberLike && (Number.isInteger(parseFloat(maxValue)) && Number.isInteger(parseFloat(maxValue)))) {
            midValue = parseInt(midValue+.5);
          }
          if (midValue != minValue && midValue !== maxValue) {
            // ensure accurate placement of midValue along the ramp, in case of integer coersion
            let divisor = (midValue-minValue)/(maxValue - minValue);
            // color
            var rMid = {r: (rMax.r + rMin.r) * divisor, g: (rMax.g + rMin.g) * divisor, b: (rMax.b + rMin.b) * divisor};
            renderer.visualVariables[renderer.visualVariables.length-1].stops.push({
                value: midValue,
                color: {r: rMid.r, g: rMid.g, b: rMid.b, a: 1},
                label: midValue,
            });
          }
        }
        // set default label
        renderer.label = numGoodValues < uniqueValues.length ? "No value" : "Feature";
      // if it's neither categorical nor number-like, use default styling but add labels
      } else {
        layer.labelingInfo = [ addLabels(fieldName) ];
      }
    } // end if (fieldName)

    renderer = {...renderer, symbol, field: fieldName};

    // also add labels if the "Labels on" toggle is checked
    if (document.querySelector('#labels calcite-checkbox')?.checked && fieldName) {
      layer.labelingInfo = [ addLabels(fieldName) ];
    }

    // SET SCALE

    if (geotype == "point") {
      renderer.visualVariables.push({
        type: "size",
        valueExpression: "$view.scale",
        // zoom levels and scale values based on layerView.zoom and layerView.scale
        stops: [
          {
            size: 3.5,
            value: 36978595.474472 // z3
          },
          {
            size: 4.5,
            value: 577790.554289 // z9
          },
          {
            size: 6,
            value: 18055.954822 // z15
          },
        ]
      });
    } else if (geotype == "line") {
      renderer.visualVariables.push({
        type: "size",
        valueExpression: "$view.scale",
        stops: [
          {
            size: .5,
            value: 1155581.108577 // z8
          },
          {
            size: 1,
            value: 577790.554289 // z9
          },
          {
            size: 2,
            value: 144447.638572 // z11
          },
        ]
      });
    }

    // ADD LABELS

    // add labels by default to polygons only for now
    if (geotype == "polygon") {
      if (!bgColor) {
        // bgcolor might not be set if the tab wasn't visible when loaded, give it another chance
        bgColor = await getBgColor();
      }
      if (fieldName) {
        var expression = "$feature."+fieldName;
        // label if field matches a few conditions:
        if (
          // there's more than one value
          uniqueValues.length > 1 &&
          (
            (simpleFieldType == "string" && !numberLike) ||  // it's a non-numberlike string, or
            (field.statistics.values.count == uniqueValues.length) // every value is unique
          )
        ){
          // TODO: don't violate DRY (labels also set above)
          const labels = new LabelClass({
            labelExpressionInfo: expression ? { expression } : null,
            symbol: {
              type: "text",  // autocasts as new TextSymbol()
              color: bgColor == "light" ? "#1e4667" : "black",
              haloSize: 1.5,
              haloColor: bgColor == "light" ? "white" : "black",
              font: {
                size: '14px',
              }
            }
          });
          layer.labelingInfo = [ labels ];
        }
      }
    }

    // ADD LEGEND

    var {legend, view} = state;
    // if (fieldName) {
    //   // remove and replace legend entirely rather than updating, to avoid dojo issues
    //   view.ui.remove(legend);
    //   legend = await new Legend({
    //     view,
    //   })
    //   legend.layerInfos = [{
    //     layer,
    //   }]
    //   view.ui.add(legend, "bottom-right");
    // } else {
    //   view.ui.remove(legend);
    //   legend = null;
    // }

    layer.renderer = renderer; // replace the old renderer
    layer.refresh(); // ensure the layer draws

    // update state
    state = {...state, layer, view, renderer, bgColor, legend}
  } // end autoStyle

  //
  // STYLING UTILITY FUNCTIONS
  //

  // check for weirdness
  function isBadValue(value) {
    return (value === null ||          // null
            value === "" ||            // empty string
            (/^\s+$/.test(value)));   // all whitespace
  }

  // copy a symbol and apply colors
  function copyAndColor(symbol, strokeColor, fillColor) {
    if (symbol.type == 'cim') {
      // clone symbol
      var newSymbol = symbol.clone();
      cimSymbolUtils.applyCIMSymbolColor(newSymbol, fillColor);
      newSymbol.data.symbol.symbolLayers[0].markerGraphics[0].symbol.symbolLayers[0].color = strokeColor;
    } else {
      newSymbol = Object.assign({}, symbol);
      newSymbol.color = fillColor;
      if (symbol.type !== "simple-line") {
        newSymbol.outline.color = strokeColor;
      }
    }
    return newSymbol;
  }


  // add labels to a layer
  function addLabels(fieldName) {
    return new LabelClass({
      labelExpressionInfo: { expression: "$feature."+fieldName },
      symbol: {
        type: "text",  // autocasts as new TextSymbol()
        color: state.bgColor == "light" ? "#1e4667" : "white",
        haloSize: 1.5,
        haloColor: state.bgColor == "light" ? "white" : "black",
        font: {
          size: '14px',
        }
      }
      // these ArcGIS label class properties don't exist in the JSAPI ... yet
      // removeDuplicates: "all",
      // removeDuplicatesDistance: 0,
      // repeatLabel: false,
      // repeatLabelDistance: 500,
    });
  }

  // get geometrical extent of dataset features
  function getDatasetExtent (dataset) {
    const extent = dataset.attributes.extent;
    return {
      xmin: extent.coordinates[0][0],
      ymin: extent.coordinates[0][1],
      xmax: extent.coordinates[1][0],
      ymax: extent.coordinates[1][1],
      spatialReference: extent.spatialReference
    };
  }

  // get a field object from a field name
  function getDatasetField (fieldName) {
    let lc_fieldName = fieldName.toLowerCase();
    const field = state.dataset.attributes.fields.find(f => f.name.toLowerCase() === lc_fieldName);
    if (!field) {
      throw new Error(`Could not find field "${fieldName}" in dataset.`);
    }
    const stats = [...Object.entries(state.dataset.attributes.statistics).values()].find(([, fields]) => fields[lc_fieldName]);

    // add "simple type" (numeric, date, string) and stats into rest of field definition
    return {
      ...field,
      simpleType: stats && stats[0],
      statistics: stats && stats[1][lc_fieldName].statistics
    }
  }

  // get the unique values of a field
  async function getDatasetFieldUniqueValues (fieldName) {
    var {layer} = state;
    if (!DATASET_FIELD_UNIQUE_VALUES[fieldName]) {
      const field = getDatasetField(fieldName);
      let stats;
    if (layer) {
      const uniqueValueInfos = (await uniqueValues({ layer: state.layer, field: fieldName }))
        .uniqueValueInfos
        .sort((a, b) => a.count > b.count ? -1 : 1);
        const count = uniqueValueInfos.reduce((count, f) => count + f.count, 0);
        stats = {
          count,
          uniqueCount: uniqueValueInfos.length,
          values: uniqueValueInfos
        }
      }
      stats.uniqueCount = stats.values.length;
      // add percent of records
      stats.values = stats.values
      // .filter(v => v.value != null && (typeof v.value !== 'string' || v.value.trim() !== ''))
      .map(v => ({ ...v, pct: v.count / stats.count }));
      // get top values
      const maxTopValCount = 12;
      // stats.topValues = stats.values.slice(0, maxTopValCount);
      stats.topValues = [];
      if (stats.uniqueCount < maxTopValCount) {
        stats.topValues = stats.values;
      } else {
        let coverage = 0;
        for (let i=0, coverage=0; i < stats.values.length; i++) {
          // let stat = { ...stats.values[i], pct: stats.values[i].count / recordCount };
          const stat = stats.values[i];
          // if (coverage >= 0.80 && stat.pct < 0.05 && stats.topValues.length >= maxTopValCount) break;
          if (stat.pct < 0.015 || stats.topValues.length >= maxTopValCount) break;
          stats.topValues.push(stat);
          coverage += stat.pct;
        }
      }
      // cache
      DATASET_FIELD_UNIQUE_VALUES[fieldName] = stats;
    }
    return DATASET_FIELD_UNIQUE_VALUES[fieldName];
  }

  // Determine if field is categorical or pseudo-categorical
  async function datasetFieldCategorical (fieldName) {
    var {categoricalMax} = state;
    const field = await getDatasetField(fieldName);
    const stats = await getDatasetFieldUniqueValues(fieldName);
    const categorical = stats.uniqueCount <= categoricalMax;
    const pseudoCategoricalMin = .8; // the proportion of unique values to total values is < 80%
    // sum the values until you reach at least pseudoCategoricalMin
    const coverage = Object.values(stats.values).reduce(
      // accumulator object - pull .pct from each value
      ({sum, i}, {pct}) =>
        (sum < pseudoCategoricalMin ? // still not there?
        {sum: sum + pct, i: i + 1} : // keep adding
        {sum, i}), // otherwise just keep returning the current value
          // TODO: break once the value is reached
        {sum: 0, i: 0}); // init value
    // return the number of unique values which comprise pseudoCategoricalMin% of the features, or false
    const pseudoCategorical = coverage.sum >= pseudoCategoricalMin ? coverage.i : false;
    return { categorical, pseudoCategorical };
  }

  // Determine if field is an integer
  async function datasetFieldIsInteger (fieldName) {
    const field = getDatasetField(fieldName);
    if (field.type.toLowerCase().includes('integer')) { // explicit integer type
      return true;
    } else { // or check the known values to see if they're all integers
      const stats = await getDatasetFieldUniqueValues(field.name);
      return stats.values.every(v => v.value == null || Number.isInteger(v.value));
    }
  }

  // Determine if field is number-like, e.g. is a number or all non-null values can be parsed as such
  async function datasetFieldIsNumberLike (fieldName) {
    const field = getDatasetField(fieldName);
    if (field.simpleType === 'numeric') { // explicit number type
      return true;
    } else { // or check the known values to see if they're all integers
      const stats = await getDatasetFieldUniqueValues(field.name);
      return stats.values.every(v => v.value == null || !isNaN(Number(v.value)));
    }
  }

  //
  // UI MAINTENANCE
  //

  // Add an entry to an attribute dropdown
  function updateAttributeList (list, callback) {
    var {dataset} = state;
    // create attributeitem for each attribute
    const attributeList = document.querySelector(list);
    // clear existing entries
    Array.from(attributeList.children)
    .forEach(i => attributeList.removeChild(i))
    const attributes = [
    ...Object.entries(dataset.attributes.statistics.numeric || {}),
    ...Object.entries(dataset.attributes.statistics.date || {}),
    ...Object.entries(dataset.attributes.statistics.string || {})
    ];

    attributes
    .map(([fieldName, { statistics: fieldStats }]) => [fieldName, fieldStats]) // grab stats

    // TODO: decide how to handle datasets with only one record
    // .filter(([fieldName, fieldStats]) => { // exclude fields with one value
    //   return !fieldStats ||
    //   !fieldStats.values ||
    //   fieldStats.uniqueCount > 1 || // unique count reported as 0 for sampled data
    //   fieldStats.values.min !== fieldStats.values.max
    // })

    .forEach(async ([fieldName, fieldStats]) => {
      // dataset.attributes.fieldNames
      //   .map(fieldName => [fieldName, getDatasetField(fieldName)])
      //   .filter(([fieldName, field]) => !field.statistics || field.statistics.values.min !== field.statistics.values.max)
      //   .forEach(([fieldName, field]) => {
      const field = getDatasetField(fieldName);
      fieldName = field.name;

      // make list entry for attribute
      const item = document.createElement('calcite-dropdown-item');
      item.setAttribute('class', 'attribute');
      item.innerHTML = await generateLabel(field, fieldStats);

      // add icon for field type
      if (field.simpleType === 'numeric') {
        item.iconEnd = 'number';
      } else if (field.simpleType === 'string') {
        item.iconEnd = 'description';
      } else if (field.simpleType === 'date') {
        item.iconEnd = 'calendar';
      }

      item.setAttribute('data-field', fieldName);

      // add click handler if the field has valid values
      if (fieldStats &&
          (
            !(fieldStats.values.min == null || fieldStats.values.max == null) || // min and max are not null
            (fieldStats.uniqueCount && field.simpleType === 'string') // or the field is type string and there's a uniqueCount
          )
        )
      {
        item.addEventListener('click', () => callback({fieldName}));
      } else {
        // if not, grey out the list item
        item.classList.add('inactive');
      }
      attributeList.appendChild(item);
    });
    return attributeList;
  }

  // find the number of significant digits of a numeric value, for truncation in generateLabel()
  function getDigits(num) {
    var s = num.toString();
    s = s.split('.');
    if (s.length == 1) {
      s = [s[0], "0"];
    }
    // return number of digits to the left and right of the decimal point
    return [s[0].length, Math.min(s[1].length, 4)];
  }

  // make a data annotation, eg (3 values) or (5.5 - 13.2) for an entry in the attributes list
  async function generateLabel(field, fieldStats) {
    var label = `${field.alias || field.name}`;
    if (!fieldStats) {
      return label;
    } else {
      var min = fieldStats.values.min;
      var max = fieldStats.values.max;
      label += ' <span class="attributeRange">';
    }
    if (fieldStats.values
      && (min && max) != null
      && typeof (min && max) != 'undefined') {
      if (field.simpleType === 'numeric') {
        // vary precision based on value range – round to integers if range is > 100, otherwise
        // find the decimal exponent of the most sigfig of the value range, and truncate two decimal places past that -
        // eg: if the range is .000999999, most sigfig exponent is -4 (.0001), values will be truncated to -6 (.000001)
        // TODO: test if this is actually working (seems to in practice)
        let digits = getDigits(max - min);
        let precision = digits[1] == 1 ? 0 : digits[0] > 3 ? 0 : digits[1];
        min = min.toFixed(precision);
        max = max.toFixed(precision);
        label += `(${min} to ${max})`;
      } else if (field.simpleType === 'date') {
        label += `(${formatDate(min)} to ${formatDate(max)})`;
      }
    } else if (fieldStats.uniqueCount && field.simpleType === 'string') {
      // remove bad values
      var uniqueValues = (await getDatasetFieldUniqueValues(field.name)).values;
      label += `(${uniqueValues.length} value${uniqueValues.length > 1 ? 's)' : ')'}`;
    } else {
      label += `<i>(No values)</i>`;
    }
    return ''+label+'</span>';
  }

  function formatDate (timestamp) {
    const date = new Date(timestamp);
    return `${date.getMonth()+1}/${date.getDate()}/${date.getFullYear()}`;
  }

  function simpleFieldType (fieldType) {
    const fieldTypes = {
      esriFieldTypeGlobalID: 'text',
      esriFieldTypeGUID: 'text',
      esriFieldTypeDate: 'date-time',
      esriFieldTypeString: 'string',
      esriFieldTypeSingle: 'number',
      esriFieldTypeFloat: 'number',
      esriFieldTypeDouble: 'number',
      esriFieldTypeInteger: 'number',
      esriFieldTypeSmallInteger: 'number',
      esriFieldTypeOID: 'number',
    };

    return fieldTypes[fieldType] || '';
  }

  // filter attribute entries by search
  function chartAttributeSearchInput(e) {
    Array.from(document.getElementById('chartAttributeList').children)
    .map(x => {
      let field = x.getAttribute('data-field');
      let fieldName = getDatasetField(field).alias.toLowerCase();
      x.style.display = fieldName.indexOf(e.srcElement.value) == -1 ? 'none' : 'flex';
    });
}
  // only triggered by the clear search x button
  function chartAttributeSearchChange(e) {
    Array.from(document.getElementById('chartAttributeList').children)
      .map(x => {
        let field = x.getAttribute('data-field');
        let fieldName = getDatasetField(field).alias.toLowerCase();
        x.style.display = fieldName.indexOf(e.srcElement.value) == -1 ? 'none' : 'flex';
      });
  }


  // TESTS
  // autoStyle({});
  // autoStyle({fieldName:"AMERIND_CY"});
  addChart({fieldName:"AMERIND_CY"});
  // autoStyle({fieldName:"parametersProjectObservationUID"});
  // addChart({fieldName:"observationResult"});
  // addChart({fieldName:"PROJECT_NUMBER"});

})();