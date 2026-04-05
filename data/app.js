/* ── Helpers ─────────────────────────────────────────── */
var zeroPad = function (num, places) { return String(num).padStart(places, '0'); };

function componentToHex(c) {
	var h = c.toString(16);
	return h.length === 1 ? '0' + h : h;
}

function rgbToHex(r, g, b) {
	return '#' + componentToHex(r) + componentToHex(g) + componentToHex(b);
}

function hexToRgb(hex) {
	var res = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	return res ? {
		r: parseInt(res[1], 16),
		g: parseInt(res[2], 16),
		b: parseInt(res[3], 16)
	} : null;
}

/* ── Loading indicator ───────────────────────────────── */
var pendingRequests = 0;

function setLoading(active) {
	pendingRequests += active ? 1 : -1;
	if (pendingRequests < 0) { pendingRequests = 0; }
	document.getElementById('loadingIndicator').style.display =
		pendingRequests > 0 ? 'inline-flex' : 'none';
}

/* ── GET helper ──────────────────────────────────────── */
function get(url, callback, errorCallback) {
	setLoading(true);
	var xhttp = new XMLHttpRequest();

	xhttp.onreadystatechange = function () {
		if (this.readyState !== 4) { return; }
		setLoading(false);
		if (this.status === 200) {
			var resultado = JSON.parse(this.responseText, null, '  ');
			if (callback) { callback(resultado); }
			console.log(resultado);
		} else {
			if (errorCallback) { errorCallback(); }
		}
	};

	xhttp.onerror = function () {
		setLoading(false);
		if (errorCallback) { errorCallback(); }
	};

	xhttp.open('GET', url, true);
	xhttp.send();
}

/* ── API wrappers ────────────────────────────────────── */
function setColorToDigit(event, api, digit) {
	var cor = hexToRgb(event.target.value);
	var url = 'http://192.168.100.7/' + api + '?p=' + digit + '&r=' + cor.r + '&g=' + cor.g + '&b=' + cor.b;
	get(url);
}

function setBrightnessState(event, api, mode) {
	get('http://192.168.100.7/' + api + '?p=' + mode);
}

function setRainbowState(event,api, mode) {
	get('http://192.168.100.7/'+ api + '?p=' + mode);
}

function setNightTime(event) {
	var start = document.getElementById('nightModeStart').value;
	var end   = document.getElementById('nightModeEnd').value;
	get('http://192.168.100.7/setNightTime?s=' + start + '&e=' + end);
}

function applyDecoColorAll(event, line) {
	var hex = document.getElementById('bulkColorLine' + line).value;
	var cor = hexToRgb(hex);
	var url = 'http://192.168.100.7/setDecoColorAll?l=' + line + '&r=' + cor.r + '&g=' + cor.g + '&b=' + cor.b;
	get(url);

    var idxStart = (line - 1) * 7;
    var idxEnd   = idxStart + 7;
	var corStr = '#('+ cor.r + ',' + cor.g + ',' + cor.b + ')';
	for (var i = idxStart; i < idxEnd; i++) {
		updateUiColor('favDLC' + (i + 1), corStr);
	}	
}

/* ── Fetch latest data from device ──────────────────── */
function loadData() {
	get('http://192.168.100.7/getInfo', function (d) {
		setConn(true);
		updateUi(d);
	}, function () {
		setConn(false);
	});
}

/* ── Mock data (offline preview / development) ───────── */
function loadDataMock() {
	var d = {
		brightnessSensorMap: '142',
		temperature:         '28.5°C',
		humidity:            '75%',
		time:                '14:35',
		date:                '01/04/2026', 
		urlTemperature:      'http://api.hgbrasil.com/weather?woeid=455831&format=json-cors&array_limit=2&fields=only_results,temp,humidity,city_name&key=3b983af0',
		clockFirstHourColor:   '(58,132,0)',
		clockSecondHourColor:  '(58,132,0)',
		clockFirstMinuteColor: '(221,0,0)',
		clockSecodMinuteColor: '(221,0,0)',
		clockFirstDayColor:    '(58,0,57)',
		clockSecondDayColor:   '(58,0,57)',
		clockFirstMonthColor:  '(221,255,0)',
		clockSecodMonthColor:  '(221,255,0)',
		tempFirstValueColor:   '(0, 132,57)',
		tempSecondValueColor:  '(0,132,57)',
		tempFirstSymbolColor:  '(221,0,255)',
		tempSecondSymbolColor: '(221,0,255)',
		humidityFirstSymbolColor:  '(0,0,57)',
		humiditySecondSymbolColor: '(0,0,57)',		
		humidityFirstValueColor:   '(221,0,125)',
		humiditySecondValueColor:  '(221,125,0)',		
		clockBrightnessMode: '1',
		decoBrightnessMode:  '2',
		rainbowModeClock:    '0',
		rainbowModeDeco:     '0',		
		decoColor: '(255,255,255)-(255,255,255)-(255,255,255)-(255,255,255)-(255,255,255)-(255,255,255)-(255,255,255)-(255,0,0)-(255,0,0)-(255,0,0)-(255,0,0)-(255,0,0)-(255,0,0)-(255,0,0)'
	};
	setConn(true);
	updateUi(d);
}

/* ── UI state helpers ────────────────────────────────── */
function setControlsEnabled(enabled) {
	document.getElementById('mainContainer')
		.querySelectorAll('input, button')
		.forEach(function (el) { el.disabled = !enabled; });
}

function setConn(ok) {
	var dot   = document.getElementById('connDot');
	var label = document.getElementById('connLabel');
	dot.className     = 'conn-dot ' + (ok ? 'ok' : 'error');
	label.textContent = ok ? 'CONNECTED' : 'OFFLINE';
	setControlsEnabled(ok);
}

function updateUiColor(id, valueStr) {
	var x   = valueStr.replace(/[()#]/g, '').split(',');
	var hex = rgbToHex(parseInt(x[0]), parseInt(x[1]), parseInt(x[2]));
	document.getElementById(id).value = hex;
}

/* active/inactive toggle for 3-button groups (ON / OFF / AUTO) */
function changeBrightState(ids, valor) {
	ids.forEach(function (id) {
		if (!id) { return; }
		document.getElementById(id).classList.remove('btn-success');
		document.getElementById(id).classList.add('btn-outline-secondary');
	});
	var target = null;
	if (valor === '0') { target = ids[1]; }  // OFF
	if (valor === '1') { target = ids[0]; }  // ON
	if (valor === '2') { target = ids[2]; }  // AUTO
	if (target) {
		document.getElementById(target).classList.remove('btn-outline-secondary');
		document.getElementById(target).classList.add('btn-success');
	}
}

/* active/inactive toggle for 2-button groups (ON / OFF) */
function changeRainbowState(ids, valor) {
	ids.forEach(function (id) {
		document.getElementById(id).classList.remove('btn-success');
		document.getElementById(id).classList.add('btn-outline-secondary');
	});
	var target = valor === '1' ? ids[0] : ids[1];
	document.getElementById(target).classList.remove('btn-outline-secondary');
	document.getElementById(target).classList.add('btn-success');
}

/* ── Update full UI from API response ────────────────── */
function updateUi(d) {
	document.getElementById('brightnessSensorMap').innerHTML = d['brightnessSensorMap'];
	document.getElementById('temperature').innerHTML         = d['temperature'];
	document.getElementById('humidity').innerHTML            = d['humidity'];	
	document.getElementById('time').innerHTML                = d['time'];
	document.getElementById('date').innerHTML                = d['date'];
	document.getElementById('urlTemperature').value          = d['urlTemperature'];

	updateUiColor('clockFirstHourColor',    d['clockFirstHourColor']);
	updateUiColor('clockSecondHourColor',   d['clockSecondHourColor']);
	updateUiColor('clockFirstMinuteColor',  d['clockFirstMinuteColor']);
	updateUiColor('clockSecodMinuteColor',  d['clockSecodMinuteColor']);

	updateUiColor('clockFirstDayColor',     d['clockFirstDayColor']);
	updateUiColor('clockSecondDayColor',    d['clockSecondDayColor']);
	updateUiColor('clockFirstMonthColor',   d['clockFirstMonthColor']);
	updateUiColor('clockSecodMonthColor',   d['clockSecodMonthColor']);

	updateUiColor('tempFirstValueColor',    d['tempFirstValueColor']);
	updateUiColor('tempSecondValueColor',   d['tempSecondValueColor']);
	updateUiColor('tempFirstSymbolColor',   d['tempFirstSymbolColor']);
	updateUiColor('tempSecondSymbolColor',  d['tempSecondSymbolColor']);

	updateUiColor('humidityFirstValueColor',    d['humidityFirstValueColor']);
	updateUiColor('humiditySecondValueColor',   d['humiditySecondValueColor']);
	updateUiColor('humidityFirstSymbolColor',   d['humidityFirstSymbolColor']);
	updateUiColor('humiditySecondSymbolColor',  d['humiditySecondSymbolColor']);

	changeBrightState(['idCBSOn', 'idCBSOff', 'idCBSAuto'], d['clockBrightnessMode'][0]);
	changeBrightState(['idDBSOn', 'idDBSOff', 'idDBSAuto'], d['decoBrightnessMode'][0]);

	changeRainbowState(['idERCOn', 'idERCOff'], d['rainbowModeClock'][0]);
	changeRainbowState(['idERDOn', 'idERDOff'], d['rainbowModeDeco'][0]);	

	var decoColors = d['decoColor'].replaceAll(' ', '').split('-');
	for (var i = 0; i < 14; i++) {
		updateUiColor('favDLC' + (i + 1), decoColors[i]);
	}
}

/* ── Register all event listeners (once on startup) ─── */
function bindEvents() {
	// Clock — hours
	document.querySelector('#clockFirstHourColor') .addEventListener('change', function (e) { setColorToDigit(e, 'setHourColor', '1'); });
	document.querySelector('#clockSecondHourColor').addEventListener('change', function (e) { setColorToDigit(e, 'setHourColor', '2'); });
	document.querySelector('#clockFirstMinuteColor').addEventListener('change', function (e) { setColorToDigit(e, 'setHourColor', '3'); });
	document.querySelector('#clockSecodMinuteColor').addEventListener('change', function (e) { setColorToDigit(e, 'setHourColor', '4'); });

	// Day / Month
	document.querySelector('#clockFirstDayColor')  .addEventListener('change', function (e) { setColorToDigit(e, 'setDayColor', '1'); });
	document.querySelector('#clockSecondDayColor') .addEventListener('change', function (e) { setColorToDigit(e, 'setDayColor', '2'); });
	document.querySelector('#clockFirstMonthColor').addEventListener('change', function (e) { setColorToDigit(e, 'setDayColor', '3'); });
	document.querySelector('#clockSecodMonthColor').addEventListener('change', function (e) { setColorToDigit(e, 'setDayColor', '4'); });

	// Temperature
	document.querySelector('#tempFirstValueColor') .addEventListener('change', function (e) { setColorToDigit(e, 'setTempColor', '1'); });
	document.querySelector('#tempSecondValueColor').addEventListener('change', function (e) { setColorToDigit(e, 'setTempColor', '2'); });
	document.querySelector('#tempFirstSymbolColor').addEventListener('change', function (e) { setColorToDigit(e, 'setTempColor', '3'); });
	document.querySelector('#tempSecondSymbolColor').addEventListener('change', function (e) { setColorToDigit(e, 'setTempColor', '4'); });

	// Humidity
	document.querySelector('#humidityFirstSymbolColor') .addEventListener('change', function (e) { setColorToDigit(e, 'setHumidityColor', '1'); });
	document.querySelector('#humiditySecondSymbolColor').addEventListener('change', function (e) { setColorToDigit(e, 'setHumidityColor', '2'); });
	document.querySelector('#humidityFirstValueColor').addEventListener('change', function (e) { setColorToDigit(e, 'setHumidityColor', '3'); });
	document.querySelector('#humiditySecondValueColor').addEventListener('change', function (e) { setColorToDigit(e, 'setHumidityColor', '4'); });	

	// Decoration lights
	for (var i = 1; i <= 14; i++) {
		(function (idx) {
			document.querySelector('#favDLC' + idx).addEventListener('change', function (e) {
				setColorToDigit(e, 'setDecoColor', String(idx));
			});
		})(i);
	}

	// Apply bulk color — Line 1 & 2
	document.querySelector('#applyLine1All').addEventListener('click', function (e) { applyDecoColorAll(e, 1); });
	document.querySelector('#applyLine2All').addEventListener('click', function (e) { applyDecoColorAll(e, 2); });

	// Clock brightness
	document.querySelector('#idCBSOn')  .addEventListener('click', function (e) { setBrightnessState(e, 'setClockBrightnessState', 'ON');   changeBrightState(['idCBSOn', 'idCBSOff', 'idCBSAuto'], '1'); });
	document.querySelector('#idCBSOff') .addEventListener('click', function (e) { setBrightnessState(e, 'setClockBrightnessState', 'OFF');  changeBrightState(['idCBSOn', 'idCBSOff', 'idCBSAuto'], '0'); });
	document.querySelector('#idCBSAuto').addEventListener('click', function (e) { setBrightnessState(e, 'setClockBrightnessState', 'AUTO'); changeBrightState(['idCBSOn', 'idCBSOff', 'idCBSAuto'], '2'); });

	// Decoration brightness
	document.querySelector('#idDBSOn')  .addEventListener('click', function (e) { setBrightnessState(e, 'setDecoBrightnessState', 'ON');   changeBrightState(['idDBSOn', 'idDBSOff', 'idDBSAuto'], '1'); });
	document.querySelector('#idDBSOff') .addEventListener('click', function (e) { setBrightnessState(e, 'setDecoBrightnessState', 'OFF');  changeBrightState(['idDBSOn', 'idDBSOff', 'idDBSAuto'], '0'); });
	document.querySelector('#idDBSAuto').addEventListener('click', function (e) { setBrightnessState(e, 'setDecoBrightnessState', 'AUTO'); changeBrightState(['idDBSOn', 'idDBSOff', 'idDBSAuto'], '2'); });

	// Rainbow clock
	document.querySelector('#idERCOn') .addEventListener('click', function (e) { setRainbowState(e, 'setRainbowEffectsClock', 'ON');  changeRainbowState(['idERCOn', 'idERCOff'], '1'); });
	document.querySelector('#idERCOff').addEventListener('click', function (e) { setRainbowState(e, 'setRainbowEffectsClock','OFF'); changeRainbowState(['idERCOn', 'idERCOff'], '0'); });

	// Rainbow deco
	document.querySelector('#idERDOn') .addEventListener('click', function (e) { setRainbowState(e, 'setRainbowEffectsDeco', 'ON');  changeRainbowState(['idERDOn', 'idERDOff'], '1'); });
	document.querySelector('#idERDOff').addEventListener('click', function (e) { setRainbowState(e, 'setRainbowEffectsDeco','OFF'); changeRainbowState(['idERDOn', 'idERDOff'], '0'); });	
	
	// Night mode
	document.querySelector('#setNightTime').addEventListener('click', function (e) { setNightTime(e); });
}

/* ── Entry point ─────────────────────────────────────── */
function startup() {
	setControlsEnabled(false);
	bindEvents();
	loadData();
}

startup();