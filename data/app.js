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
    "brightnessMode": { "clock": 1, "deco": 3, "brightValue": 200, "clockManual": 50, "decoManual": 120 },
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

function setManualBrightness(target, value) {
	get(`${baseUrl}/setManualBrightness?t=${target}&v=${value}`);
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
	applyLogMock();
}

/* ── UI state helpers ────────────────────────────────── */
function setControlsEnabled(enabled) {
	document.getElementById('mainContainer')
		.querySelectorAll('input:not(.log-control), button:not(.log-control)')
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

/* active/inactive toggle for brightness groups (ON / OFF / AUTO / MANUAL).
   ids = [on, off, auto, manual]; a linha da barra manual tem id "<manualId>Row". */
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
	if (valor === 3) { target = ids[3]; }  // MANUAL
	if (target) {
		document.getElementById(target).classList.remove('btn-outline-secondary');
		document.getElementById(target).classList.add('btn-success');
	}
	if (ids[3]) {
		document.getElementById(ids[3] + 'Row').classList.toggle('d-none', valor !== 3);
	}
}

function updateUiManualBrightness(prefix, value) {
	if (value === undefined || value === null) { return; }
	document.getElementById(prefix + 'Range').value = value;
	document.getElementById(prefix + 'Value').textContent = value;
}

var CLOCK_BS_IDS = ['idCBSOn', 'idCBSOff', 'idCBSAuto', 'idCBSManual'];
var DECO_BS_IDS  = ['idDBSOn', 'idDBSOff', 'idDBSAuto', 'idDBSManual'];

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

	updateUiManualBrightness('idCBSManual', d['brightnessMode']['clockManual']);
	updateUiManualBrightness('idDBSManual', d['brightnessMode']['decoManual']);
	changeBrightState(CLOCK_BS_IDS, d['brightnessMode']['clock']);
	changeBrightState(DECO_BS_IDS,  d['brightnessMode']['deco']);

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
	document.querySelector('#idCBSOn')  .addEventListener('click', function (e) { setBrightnessState(e, 'setClockBrightnessState', 'ON');   changeBrightState(CLOCK_BS_IDS, 1); });
	document.querySelector('#idCBSOff') .addEventListener('click', function (e) { setBrightnessState(e, 'setClockBrightnessState', 'OFF');  changeBrightState(CLOCK_BS_IDS, 0); });
	document.querySelector('#idCBSAuto').addEventListener('click', function (e) { setBrightnessState(e, 'setClockBrightnessState', 'AUTO'); changeBrightState(CLOCK_BS_IDS, 2); });
	// MANUAL apenas exibe a barra; o envio ao ESP acontece quando o valor é escolhido
	document.querySelector('#idCBSManual').addEventListener('click', function () { changeBrightState(CLOCK_BS_IDS, 3); });

	// Decoration brightness
	document.querySelector('#idDBSOn')  .addEventListener('click', function (e) { setBrightnessState(e, 'setDecoBrightnessState', 'ON');   changeBrightState(DECO_BS_IDS, 1); });
	document.querySelector('#idDBSOff') .addEventListener('click', function (e) { setBrightnessState(e, 'setDecoBrightnessState', 'OFF');  changeBrightState(DECO_BS_IDS, 0); });
	document.querySelector('#idDBSAuto').addEventListener('click', function (e) { setBrightnessState(e, 'setDecoBrightnessState', 'AUTO'); changeBrightState(DECO_BS_IDS, 2); });
	document.querySelector('#idDBSManual').addEventListener('click', function () { changeBrightState(DECO_BS_IDS, 3); });

	// Barras de brilho manual: atualiza o número enquanto arrasta e envia ao ESP ao soltar
	[['idCBSManual', 'clock'], ['idDBSManual', 'deco']].forEach(function (cfg) {
		var range = document.getElementById(cfg[0] + 'Range');
		var label = document.getElementById(cfg[0] + 'Value');
		range.addEventListener('input',  function () { label.textContent = range.value; });
		range.addEventListener('change', function () { setManualBrightness(cfg[1], range.value); });
	});

    // Night mode
	document.querySelector('#setNightTime').addEventListener('click', function (e) { setNightTime(e); });

    // Alarm 
	document.querySelector('#btnAlarm').addEventListener('click', function (e) { setAlarm(e); });	
}

/* ── Device log ──────────────────────────────────────── */
var LOG_POLL_MS   = 3000;   // intervalo do auto refresh
var LOG_MAX_LINES = 1000;   // linhas mantidas no navegador (o ESP guarda só as últimas 50)

var logState = {
	seq: 0,          // última linha recebida (número sequencial do dispositivo)
	uptime: null,    // uptime da última resposta (detecta reinício)
	lines: [],       // texto das linhas exibidas (para download)
	timer: null,
	busy: false
};

function logLineClass(text) {
	if (text.indexOf('!!!') >= 0) { return 'log-error'; }
	if (/LENTO|AVISO|ATENCAO/.test(text)) { return 'log-warn'; }
	if (text.indexOf('[HEALTH]') >= 0) { return 'log-health'; }
	return '';
}

function logMatchesFilter(text, filter) {
	return !filter || text.toLowerCase().indexOf(filter) >= 0;
}

function appendLogLines(lines, extraClass) {
	if (!lines || lines.length === 0) { return; }

	var view   = document.getElementById('logView');
	var filter = document.getElementById('logFilter').value.trim().toLowerCase();
	var frag   = document.createDocumentFragment();

	lines.forEach(function (text) {
		var div = document.createElement('div');
		div.className   = 'log-line ' + (extraClass || logLineClass(text));
		div.textContent = text;
		div.hidden      = !logMatchesFilter(text, filter);
		frag.appendChild(div);
		logState.lines.push(text);
	});
	view.appendChild(frag);

	while (logState.lines.length > LOG_MAX_LINES) {
		logState.lines.shift();
		view.removeChild(view.firstChild);
	}

	if (document.getElementById('logAutoScroll').checked) {
		view.scrollTop = view.scrollHeight;
	}
}

function applyLogFilter() {
	var filter = document.getElementById('logFilter').value.trim().toLowerCase();
	var view   = document.getElementById('logView');
	Array.prototype.forEach.call(view.children, function (div) {
		div.hidden = !logMatchesFilter(div.textContent, filter);
	});
}

function formatUptime(seconds) {
	var d = Math.floor(seconds / 86400);
	var h = Math.floor((seconds % 86400) / 3600);
	var m = Math.floor((seconds % 3600) / 60);
	var s = seconds % 60;
	return (d > 0 ? d + 'd ' : '') + h + 'h ' + m + 'm ' + s + 's';
}

function setLogMeta(text, isError) {
	var meta = document.getElementById('logMeta');
	meta.textContent = text;
	meta.classList.toggle('log-meta-error', !!isError);
}

/* Retorna true quando é preciso consultar de novo (dispositivo reiniciou) */
function handleLogResponse(d) {
	if (logState.uptime !== null && d.uptime < logState.uptime) {
		appendLogLines(['──────── device restarted ────────'], 'log-marker');
		logState.seq    = 0;
		logState.uptime = null;
		return true;
	}

	// Linhas descartadas no ESP entre duas consultas (buffer circular de 50 linhas)
	if (logState.seq > 0 && d.first > logState.seq + 1) {
		var lost = d.first - logState.seq - 1;
		appendLogLines(['… ' + lost + ' line(s) lost between refreshes …'], 'log-marker');
	}

	appendLogLines(d.lines);
	logState.seq    = d.seq;
	logState.uptime = d.uptime;

	document.getElementById('logBootInfo').textContent = 'Boot info: ' + (d.bootInfo || '--');
	setLogMeta('Device lines ' + d.first + '–' + d.seq +
		' · uptime ' + formatUptime(d.uptime) +
		' · free heap ' + d.heap + ' B' +
		' · updated ' + new Date().toLocaleTimeString(), false);
	return false;
}

function fetchLogs() {
	if (logState.busy) { return; }
	logState.busy = true;

	var controller = new AbortController();
	var timeout    = setTimeout(function () { controller.abort(); }, 8000);

	fetch(`${baseUrl}/getLogs?since=${logState.seq}`, { signal: controller.signal, cache: 'no-store' })
		.then(function (r) {
			if (!r.ok) { throw new Error('HTTP ' + r.status); }
			return r.json();
		})
		.then(function (d) {
			if (handleLogResponse(d)) { setTimeout(fetchLogs, 0); }
		})
		.catch(function (err) {
			var reason = err.name === 'AbortError' ? 'timeout' : err.message;
			setLogMeta('Log unavailable (' + reason + ') · ' + new Date().toLocaleTimeString(), true);
		})
		.finally(function () {
			clearTimeout(timeout);
			logState.busy = false;
		});
}

function scheduleLogPolling() {
	if (logState.timer) {
		clearInterval(logState.timer);
		logState.timer = null;
	}
	if (document.getElementById('logAutoRefresh').checked) {
		logState.timer = setInterval(function () {
			if (!document.hidden) { fetchLogs(); }
		}, LOG_POLL_MS);
	}
}

function clearLogView() {
	logState.lines = [];
	document.getElementById('logView').innerHTML = '';
}

function downloadLog() {
	var blob = new Blob([logState.lines.join('\n') + '\n'], { type: 'text/plain' });
	var now  = new Date();
	var pad  = function (n) { return String(n).padStart(2, '0'); };
	var name = 'ledclock-log-' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
		'-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) + '.txt';

	var a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = name;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(a.href);
}

function applyLogMock() {
	document.getElementById('logAutoRefresh').checked = false;
	scheduleLogPolling();
	clearLogView();
	logState.seq    = 0;
	logState.uptime = null;
	handleLogResponse({
		seq: 6, first: 1, uptime: 3725, heap: 31240, boot: 3,
		bootInfo: "Boot #3 | Reset: Software Watchdog (exccause=4 epc1=0x40201234) | Anterior: checkpoint READ_TEMP_GET aos 3540112 ms, heap 28904, rota '/getInfo'",
		lines: [
			"[   3720.012] [HEALTH] uptime=3720s loops=48211 (4821/s) maiorGapLoop=12ms em SECOND_TICK loopsLentos=0",
			"[   3720.015] [HEALTH] heap=31240 minHeap=28904 maiorBloco=29800 frag=4% stack=3120",
			"[   3721.000] [DISP  ] Modo: TEMPERATURA",
			"[   3721.004] [TEMP  ] GET retornou -11 (read Timeout) em 5003 ms",
			"[   3721.005] [TEMP  ] !!! Codigo HTTP inesperado: -11",
			"[   3721.006] [TEMP  ] LENTO: readTheTemperature() levou 5010 ms"
		]
	});
}

function bindLogEvents() {
	document.getElementById('logAutoRefresh').addEventListener('change', function () {
		scheduleLogPolling();
		if (this.checked) { fetchLogs(); }
	});
	document.getElementById('logAutoScroll').addEventListener('change', function () {
		if (this.checked) {
			var view = document.getElementById('logView');
			view.scrollTop = view.scrollHeight;
		}
	});
	document.getElementById('logFilter').addEventListener('input', applyLogFilter);
	document.getElementById('btnLogRefresh').addEventListener('click', fetchLogs);
	document.getElementById('btnLogDownload').addEventListener('click', downloadLog);
	document.getElementById('btnLogClear').addEventListener('click', clearLogView);
}

/* ── Entry point ─────────────────────────────────────── */
function startup() {
	setControlsEnabled(false);
	bindEvents();
	bindLogEvents();
	loadData();
	fetchLogs();
	scheduleLogPolling();
}

startup();