/* ── Helpers ─────────────────────────────────────────── */
const baseUrl = window.location.origin;

function colorIntToHexString(color) {
    return "#" + color.toString(16).padStart(6, "0").toUpperCase();
}

function loadDataMock() {
	return {
    "time": { "hour": 9, "minute": 23 },
    "date": { "day": 11, "month": 6, "year": 2026 },
    "temperature": 21,
    "humidity": 46,
    "hourColor": [255,255,16777215,16777215],
    "dayColor": [65280,65280,16777215,16777215],
    "tempColor": [16711680,16711680,16777215,16777215],
    "humidityColor": [16776960,16776960,16777215,16777215],
    "decoColor": [16777215,16777215,16777215,16777215,16777215,16777215,16777215,16777215,16777215,16777215,16777215,16777215,16777215,16777215],
    "brightnessMode": { "clock": 1, "deco": 1, "brightValue": 200 },
    "nightMode": {"enable": 1, "start": { "hour": 0, "minute": 0 }, "end": { "hour": 5, "minute": 30} },
	"alarm": {"enable": 0, "hour": 0, "minute": 0 },
	"umbrellaAlert": 0
	}
}

/* ── Loading indicator ───────────────────────────────── */
var pendingRequests = 0;

function setLoading(active) {
	pendingRequests += active ? 1 : -1;
	if (pendingRequests < 0) { pendingRequests = 0; }
	document.getElementById('loadingIndicator').style.display = pendingRequests > 0 ? 'inline-flex' : 'none';
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
	var cor = event.target.value.replace("#", "");
	var url = `${baseUrl}/${api}?p=${digit}&c=${cor}`;
	get(url);
}

function setBrightnessState(event, api, mode) {
	get(`${baseUrl}/${api}?p=${mode}`);
}

function setNightTime(event) {
	var enable = document.getElementById('nightModeEnable').checked === true ? 1 : 0;
	var start = document.getElementById('nightModeStart').value;
	var end   = document.getElementById('nightModeEnd').value;

	get(`${baseUrl}/setNightTime?enable=${enable}&start=${start}&end=${end}`);
}

function setAlarm(event) {
	var enable = document.getElementById('alarmEnable').checked === true ? 1 : 0;
	var start = document.getElementById('alarmTime').value;

	get(`${baseUrl}/setAlarm?enable=${enable}&time=${start}`);
}

function applyDecoColorAll(event, line) {
	var cor = document.getElementById('bulkColorLine' + line).value;

	var url = `${baseUrl}/setDecoColorAll?l=${line}&c=${cor.replace("#", "")}`;

	get(url);

    var idxStart = (line - 1) * 7;
    var idxEnd   = idxStart + 7;
	for (var i = idxStart; i < idxEnd; i++) {
		updateUiColorHex('favDLC' + (i + 1), cor);
	}	
}

/* ── Fetch latest data from device ──────────────────── */
function loadData() {
	get(`${baseUrl}/getInfo`, function (d) {
		setConn(true);
		updateUi(d);
	}, function () {
		setConn(false);
	});
}

/* ── Mock data (offline preview / development) ───────── */
function applyDataMock() {
	var d = loadDataMock();
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

function updateUiColorHex(id, cor) {
	document.getElementById(id).value = cor;
}

function updateUiColorInt(id, cor) {
	var hex = colorIntToHexString(cor);
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
	if (valor === 0) { target = ids[1]; }  // OFF
	if (valor === 1) { target = ids[0]; }  // ON
	if (valor === 2) { target = ids[2]; }  // AUTO
	if (target) {
		document.getElementById(target).classList.remove('btn-outline-secondary');
		document.getElementById(target).classList.add('btn-success');
	}
}

/* ── Update full UI from API response ────────────────── */
function updateUi(d) {
	document.getElementById('brightnessSensorMap').innerHTML = d['brightnessMode']['brightValue'];
	document.getElementById('temperature').innerHTML         = d['temperature'] + ' °C';
	document.getElementById('humidity').innerHTML            = d['humidity'] + ' %';	
	document.getElementById('time').innerHTML                = d['time']['hour'].toString().padStart(2, '0') + ' : ' + d['time']['minute'].toString().padStart(2, '0');
	document.getElementById('date').innerHTML                = d['date']['day'].toString().padStart(2, '0') + ' / ' + d['date']['month'].toString().padStart(2, '0') + ' / ' + d['date']['year'].toString().padStart(4, '0');

	document.getElementById('umbrellaAlert').innerHTML       = d['umbrellaAlert'] == 1? "ON" : "OFF";
	document.getElementById('alarmStatus').innerHTML         = d['alarm']['enable'] == 1? "ON" : "OFF";

	updateUiColorInt('clockFirstHourColor',    d['hourColor'][0]);
	updateUiColorInt('clockSecondHourColor',   d['hourColor'][1]);
	updateUiColorInt('clockFirstMinuteColor',  d['hourColor'][2]);
	updateUiColorInt('clockSecodMinuteColor',  d['hourColor'][3]);

	updateUiColorInt('clockFirstDayColor',     d['dayColor'][0]);
	updateUiColorInt('clockSecondDayColor',    d['dayColor'][1]);
	updateUiColorInt('clockFirstMonthColor',   d['dayColor'][2]);
	updateUiColorInt('clockSecodMonthColor',   d['dayColor'][3]);

	updateUiColorInt('tempFirstValueColor',    d['tempColor'][0]);
	updateUiColorInt('tempSecondValueColor',   d['tempColor'][1]);
	updateUiColorInt('tempFirstSymbolColor',   d['tempColor'][2]);
	updateUiColorInt('tempSecondSymbolColor',  d['tempColor'][3]);

	updateUiColorInt('humidityFirstValueColor',    d['humidityColor'][0]);
	updateUiColorInt('humiditySecondValueColor',   d['humidityColor'][1]);
	updateUiColorInt('humidityFirstSymbolColor',   d['humidityColor'][2]);
	updateUiColorInt('humiditySecondSymbolColor',  d['humidityColor'][3]);

	changeBrightState(['idCBSOn', 'idCBSOff', 'idCBSAuto'], d['brightnessMode']['clock']);
	changeBrightState(['idDBSOn', 'idDBSOff', 'idDBSAuto'], d['brightnessMode']['deco']);

	for (var i = 0; i < 14; i++) {
		updateUiColorInt('favDLC' + (i + 1), d['decoColor'][i]);
	}

	document.getElementById('nightModeEnable').checked = d['nightMode']['enable'] == 1;
	document.getElementById('nightModeStart').value = d['nightMode']['start']['hour'].toString().padStart(2, '0') + ':' + d['nightMode']['start']['minute'].toString().padStart(2, '0');
	document.getElementById('nightModeEnd').value = d['nightMode']['end']['hour'].toString().padStart(2, '0') + ':' + d['nightMode']['end']['minute'].toString().padStart(2, '0');

	document.getElementById('alarmEnable').checked = d['alarm']['enable'] == 1;
	document.getElementById('alarmTime').value = d['alarm']['hour'].toString().padStart(2, '0') + ':' + d['alarm']['minute'].toString().padStart(2, '0');
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
	document.querySelector('#idCBSOn')  .addEventListener('click', function (e) { setBrightnessState(e, 'setClockBrightnessState', 'ON');   changeBrightState(['idCBSOn', 'idCBSOff', 'idCBSAuto'], 1); });
	document.querySelector('#idCBSOff') .addEventListener('click', function (e) { setBrightnessState(e, 'setClockBrightnessState', 'OFF');  changeBrightState(['idCBSOn', 'idCBSOff', 'idCBSAuto'], 0); });
	document.querySelector('#idCBSAuto').addEventListener('click', function (e) { setBrightnessState(e, 'setClockBrightnessState', 'AUTO'); changeBrightState(['idCBSOn', 'idCBSOff', 'idCBSAuto'], 2); });

	// Decoration brightness
	document.querySelector('#idDBSOn')  .addEventListener('click', function (e) { setBrightnessState(e, 'setDecoBrightnessState', 'ON');   changeBrightState(['idDBSOn', 'idDBSOff', 'idDBSAuto'], 1); });
	document.querySelector('#idDBSOff') .addEventListener('click', function (e) { setBrightnessState(e, 'setDecoBrightnessState', 'OFF');  changeBrightState(['idDBSOn', 'idDBSOff', 'idDBSAuto'], 0); });
	document.querySelector('#idDBSAuto').addEventListener('click', function (e) { setBrightnessState(e, 'setDecoBrightnessState', 'AUTO'); changeBrightState(['idDBSOn', 'idDBSOff', 'idDBSAuto'], 2); });

    // Night mode
	document.querySelector('#setNightTime').addEventListener('click', function (e) { setNightTime(e); });

    // Alarm 
	document.querySelector('#btnAlarm').addEventListener('click', function (e) { setAlarm(e); });	
}

/* ── Entry point ─────────────────────────────────────── */
function startup() {
	setControlsEnabled(false);
	bindEvents();
	loadData();
}

startup();