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
		.querySelectorAll('input:not(.log-control), button:not(.log-control):not(.tab-btn)')
		.forEach(function (el) { el.disabled = !enabled; });
}

function setConn(ok) {
	var dot   = document.getElementById('connDot');
	var label = document.getElementById('connLabel');
	dot.className     = 'conn-dot ' + (ok ? 'ok' : 'error');
	label.textContent = ok ? 'Online' : 'Offline';
	document.getElementById('connBadge').className = 'conn-badge ' + (ok ? 'ok' : 'error');
	setControlsEnabled(ok);
}

function pad2(n) {
	return String(n).padStart(2, '0');
}

function updateUiColorHex(id, cor) {
	document.getElementById(id).value = cor;
}

function updateUiColorInt(id, cor) {
	var hex = colorIntToHexString(cor);
	document.getElementById(id).value = hex;
}

/* Controle segmentado de brilho (OFF / ON / AUTO / MAN).
   g = { on, off, auto, manual, label }: ids dos elementos do grupo.
   A linha da barra manual tem id "<manual>Row". */
var BRIGHT_MODE_LABELS = ['Desligado', 'Ligado', 'Automático (LDR)', 'Manual'];

function changeBrightState(g, valor) {
	var byMode = [g.off, g.on, g.auto, g.manual];   // índice = valor do modo no firmware
	byMode.forEach(function (id, mode) {
		document.getElementById(id).classList.toggle('active', mode === valor);
	});
	document.getElementById(g.manual + 'Row').classList.toggle('d-none', valor !== 3);
	document.getElementById(g.label).textContent = BRIGHT_MODE_LABELS[valor] || '--';
}

function updateUiManualBrightness(prefix, value) {
	if (value === undefined || value === null) { return; }
	document.getElementById(prefix + 'Range').value = value;
	document.getElementById(prefix + 'Value').textContent = value;
}

var CLOCK_BS_IDS = { on: 'idCBSOn', off: 'idCBSOff', auto: 'idCBSAuto', manual: 'idCBSManual', label: 'idCBSLabel' };
var DECO_BS_IDS  = { on: 'idDBSOn', off: 'idDBSOff', auto: 'idDBSAuto', manual: 'idDBSManual', label: 'idDBSLabel' };

/* Ativo/inativo nos cards escuros do mostrador */
function setDisplayOnOff(id, on) {
	var el = document.getElementById(id);
	el.textContent = on ? 'ON' : 'OFF';
	el.classList.toggle('c-on', on);
	el.classList.toggle('glow', on);
	el.classList.toggle('c-off', !on);
}

function weekdayName(day, month, year) {
	var name = new Date(year, month - 1, day).toLocaleDateString('pt-BR', { weekday: 'long' });
	return name.charAt(0).toUpperCase() + name.slice(1);
}

/* ── Update full UI from API response ────────────────── */
function updateUi(d) {
	document.getElementById('brightnessSensorMap').textContent = d['brightnessMode']['brightValue'];
	document.getElementById('temperature').textContent         = d['temperature'] + '°C';
	document.getElementById('humidity').textContent            = d['humidity'] + '%';
	document.getElementById('time').textContent                = pad2(d['time']['hour']) + ':' + pad2(d['time']['minute']);
	document.getElementById('date').textContent                = pad2(d['date']['day']) + '/' + pad2(d['date']['month']) + '/' + pad2(d['date']['year'] % 100);
	document.getElementById('dateSub').textContent             = weekdayName(d['date']['day'], d['date']['month'], d['date']['year']);

	var rain = d['umbrellaAlert'] == 1;
	setDisplayOnOff('umbrellaAlert', rain);
	var rainSub = document.getElementById('umbrellaSub');
	rainSub.textContent = rain ? 'Leve o guarda-chuva' : 'Sem previsão';
	rainSub.classList.toggle('c-on', !rain);

	setDisplayOnOff('alarmStatus', d['alarm']['enable'] == 1);
	document.getElementById('alarmSub').textContent = 'Programado ' + pad2(d['alarm']['hour']) + ':' + pad2(d['alarm']['minute']);

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

	// Umidade: posições 1-2 = símbolo, 3-4 = valor (mesma ordem de setHumidityColor e do firmware)
	updateUiColorInt('humidityFirstSymbolColor',   d['humidityColor'][0]);
	updateUiColorInt('humiditySecondSymbolColor',  d['humidityColor'][1]);
	updateUiColorInt('humidityFirstValueColor',    d['humidityColor'][2]);
	updateUiColorInt('humiditySecondValueColor',   d['humidityColor'][3]);

	updateUiManualBrightness('idCBSManual', d['brightnessMode']['clockManual']);
	updateUiManualBrightness('idDBSManual', d['brightnessMode']['decoManual']);
	changeBrightState(CLOCK_BS_IDS, d['brightnessMode']['clock']);
	changeBrightState(DECO_BS_IDS,  d['brightnessMode']['deco']);

	for (var i = 0; i < 14; i++) {
		updateUiColorInt('favDLC' + (i + 1), d['decoColor'][i]);
	}

	document.getElementById('nightModeEnable').checked = d['nightMode']['enable'] == 1;
	document.getElementById('nightModeStart').value = pad2(d['nightMode']['start']['hour']) + ':' + pad2(d['nightMode']['start']['minute']);
	document.getElementById('nightModeEnd').value   = pad2(d['nightMode']['end']['hour']) + ':' + pad2(d['nightMode']['end']['minute']);

	document.getElementById('alarmEnable').checked = d['alarm']['enable'] == 1;
	document.getElementById('alarmTime').value = pad2(d['alarm']['hour']) + ':' + pad2(d['alarm']['minute']);
}

/* Botão de rodapé dos cards de cor: copia a cor do 1º dígito para os outros 3.
   As requisições vão uma após a outra para não sobrecarregar o servidor do ESP. */
function applyFirstColorToGroup(api, ids) {
	var first = document.getElementById(ids[0]).value;
	var i = 1;
	(function next() {
		if (i >= ids.length) { return; }
		document.getElementById(ids[i]).value = first;
		get(`${baseUrl}/${api}?p=${i + 1}&c=${first.replace('#', '')}`, next);
		i++;
	})();
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

	// Rodapé dos cards de cor: igualar à cor do 1º dígito
	document.querySelector('#uniformHour').addEventListener('click', function () {
		applyFirstColorToGroup('setHourColor', ['clockFirstHourColor', 'clockSecondHourColor', 'clockFirstMinuteColor', 'clockSecodMinuteColor']);
	});
	document.querySelector('#uniformDay').addEventListener('click', function () {
		applyFirstColorToGroup('setDayColor', ['clockFirstDayColor', 'clockSecondDayColor', 'clockFirstMonthColor', 'clockSecodMonthColor']);
	});
	document.querySelector('#uniformTemp').addEventListener('click', function () {
		applyFirstColorToGroup('setTempColor', ['tempFirstValueColor', 'tempSecondValueColor', 'tempFirstSymbolColor', 'tempSecondSymbolColor']);
	});
	document.querySelector('#uniformHumidity').addEventListener('click', function () {
		applyFirstColorToGroup('setHumidityColor', ['humidityFirstSymbolColor', 'humiditySecondSymbolColor', 'humidityFirstValueColor', 'humiditySecondValueColor']);
	});

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
		appendLogLines(['──────── dispositivo reiniciou ────────'], 'log-marker');
		logState.seq    = 0;
		logState.uptime = null;
		return true;
	}

	// Linhas descartadas no ESP entre duas consultas (buffer circular de 50 linhas)
	if (logState.seq > 0 && d.first > logState.seq + 1) {
		var lost = d.first - logState.seq - 1;
		appendLogLines(['… ' + lost + ' linha(s) perdida(s) entre atualizações …'], 'log-marker');
	}

	appendLogLines(d.lines);
	logState.seq    = d.seq;
	logState.uptime = d.uptime;

	document.getElementById('logBootInfo').textContent = d.bootInfo || '--';
	document.getElementById('logHeap').textContent     = d.heap.toLocaleString('pt-BR') + ' B';
	document.getElementById('logUptime').textContent   = formatUptime(d.uptime);
	setLogMeta('Última atualização: ' + new Date().toLocaleTimeString('pt-BR') +
		' · linhas ' + d.first + '–' + d.seq, false);
	return false;
}

function fetchLogs() {
	// Durante o OTA o ESP está ocupado gravando; consultas extras só atrasariam o upload
	if (logState.busy || otaState.busy) { return; }
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
			setLogMeta('Log indisponível (' + reason + ') · ' + new Date().toLocaleTimeString('pt-BR'), true);
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

/* ── Atualização OTA ─────────────────────────────────── */
var OTA_USER          = 'admin';   // mesmo usuário de OTA_USER no firmware
var OTA_REBOOT_WAIT   = 4000;      // espera antes de começar a procurar o relógio de volta
var OTA_REBOOT_POLL   = 2000;
var OTA_REBOOT_LIMIT  = 60000;

var otaState = {
	target: 'fw',     // 'fw' = firmware.bin, 'fs' = littlefs.bin (interface)
	file: null,
	info: null,       // resposta de /otaInfo
	busy: false
};

function formatKB(bytes) {
	return (bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' KB';
}

function otaAuthHeader() {
	return 'Basic ' + btoa(OTA_USER + ':' + document.getElementById('otaPassword').value);
}

function setOtaStatus(text, kind) {
	var el = document.getElementById('otaStatus');
	el.textContent = text;
	el.className = 'ota-status' + (kind ? ' ' + kind : '');
}

function setOtaProgress(percent, stage, kind) {
	document.getElementById('otaProgressBox').classList.remove('d-none');
	document.getElementById('otaStage').textContent = stage;
	document.getElementById('otaPercent').textContent = Math.round(percent) + '%';
	var bar = document.getElementById('otaBar');
	bar.style.width = percent + '%';
	bar.className = 'progress-bar' + (kind ? ' ' + kind : '');
}

function setOtaBusy(busy) {
	otaState.busy = busy;
	['otaSend', 'otaTargetFw', 'otaTargetFs', 'otaPassword', 'otaFile'].forEach(function (id) {
		document.getElementById(id).disabled = busy;
	});
	document.getElementById('otaDrop').classList.toggle('disabled', busy);
}

function otaMaxSize() {
	if (!otaState.info) { return null; }
	return otaState.target === 'fs' ? otaState.info.maxFs : otaState.info.maxFirmware;
}

function renderOtaTarget() {
	var fs = otaState.target === 'fs';
	document.getElementById('otaTargetFw').classList.toggle('active', !fs);
	document.getElementById('otaTargetFs').classList.toggle('active', fs);
	var expected = document.getElementById('otaExpected');   // some quando há arquivo escolhido
	if (expected) { expected.textContent = fs ? 'littlefs.bin' : 'firmware.bin'; }
	document.getElementById('otaFileHint').textContent = fs
		? 'Gere com "Build Filesystem Image" (pasta data/)'
		: 'Gerado em .pio/build/esp12e/';
	var max = otaMaxSize();
	document.getElementById('otaLimit').textContent = max ? 'Máximo ' + formatKB(max) : '--';
}

function setOtaFile(file) {
	otaState.file = file || null;
	var drop = document.getElementById('otaDrop');
	drop.classList.toggle('has-file', !!file);
	document.getElementById('otaFileName').innerHTML = file
		? '<strong></strong>'
		: 'Escolha ou arraste o <strong id="otaExpected"></strong>';
	if (file) {
		document.querySelector('#otaFileName strong').textContent = file.name + ' · ' + formatKB(file.size);
	}
	renderOtaTarget();
	setOtaStatus('');
}

function renderOtaInfo(info) {
	otaState.info = info;
	document.getElementById('otaBuild').textContent  = info.build;
	document.getElementById('otaSketch').textContent = formatKB(info.sketchSize);
	document.getElementById('otaFsUsed').textContent = formatKB(info.fsUsed);
	renderOtaTarget();
}

function loadOtaInfo() {
	return fetch(`${baseUrl}/otaInfo`, { cache: 'no-store' })
		.then(function (r) { return r.json(); })
		.then(renderOtaInfo)
		.catch(function () { /* relógio offline: os campos ficam com "--" */ });
}

/* Confere se o arquivo combina com o tipo escolhido antes de enviar:
   firmware do ESP8266 começa com o byte 0xE9; imagem LittleFS tem "littlefs" no byte 8. */
function validateOtaFile(file) {
	return file.slice(0, 16).arrayBuffer().then(function (buf) {
		var bytes = new Uint8Array(buf);
		var isFirmware = bytes[0] === 0xE9;
		var isLittleFs = String.fromCharCode.apply(null, bytes.slice(8, 16)) === 'littlefs';

		if (otaState.target === 'fw' && !isFirmware) {
			return isLittleFs ? 'Este arquivo é uma imagem da interface. Selecione "Interface".'
			                  : 'Arquivo não parece um firmware do ESP8266 (firmware.bin).';
		}
		if (otaState.target === 'fs' && !isLittleFs) {
			return isFirmware ? 'Este arquivo é um firmware. Selecione "Firmware".'
			                  : 'Arquivo não parece uma imagem LittleFS (littlefs.bin).';
		}
		var max = otaMaxSize();
		if (max && file.size > max) {
			return 'Arquivo de ' + formatKB(file.size) + ' é maior que o espaço disponível (' + formatKB(max) + ').';
		}
		return null;
	});
}

/* Confere a senha antes de mandar o arquivo inteiro */
function checkOtaPassword() {
	return fetch(`${baseUrl}/otaInfo`, { cache: 'no-store', headers: { 'Authorization': otaAuthHeader() } })
		.then(function (r) { return r.json(); })
		.then(function (info) {
			renderOtaInfo(info);
			return info.auth;
		});
}

function uploadOtaFile(file) {
	return new Promise(function (resolve, reject) {
		var form = new FormData();
		form.append('file', file, file.name);

		var xhr = new XMLHttpRequest();
		xhr.open('POST', `${baseUrl}/update?target=${otaState.target}&size=${file.size}`);
		xhr.setRequestHeader('Authorization', otaAuthHeader());
		xhr.upload.onprogress = function (e) {
			if (e.lengthComputable) { setOtaProgress(e.loaded * 100 / e.total, 'Enviando e gravando'); }
		};
		xhr.onload = function () {
			if (xhr.status === 200) { resolve(); return; }
			var msg = 'Erro HTTP ' + xhr.status;
			try { msg = JSON.parse(xhr.responseText).error || msg; } catch (e) { /* resposta não-JSON */ }
			reject(new Error(msg));
		};
		xhr.onerror = function () { reject(new Error('Conexão perdida durante o envio')); };
		xhr.send(form);
	});
}

/* Depois de gravar, o ESP reinicia: espera ele voltar a responder */
function waitForReboot() {
	var start = Date.now();
	return new Promise(function (resolve, reject) {
		function attempt() {
			if (Date.now() - start > OTA_REBOOT_LIMIT) {
				reject(new Error('O relógio não voltou a responder em 60 s. Recarregue a página em instantes.'));
				return;
			}
			var controller = new AbortController();
			var timeout = setTimeout(function () { controller.abort(); }, 1500);
			fetch(`${baseUrl}/otaInfo`, { cache: 'no-store', signal: controller.signal })
				.then(function (r) { return r.json(); })
				.then(resolve)
				.catch(function () { setTimeout(attempt, OTA_REBOOT_POLL); })
				.finally(function () { clearTimeout(timeout); });
		}
		setTimeout(attempt, OTA_REBOOT_WAIT);
	});
}

function startOtaUpdate() {
	var file = otaState.file;
	if (!file) { setOtaStatus('Escolha o arquivo .bin primeiro.', 'error'); return; }
	if (!document.getElementById('otaPassword').value) { setOtaStatus('Informe a senha OTA.', 'error'); return; }

	setOtaBusy(true);
	setOtaStatus('Verificando arquivo e senha...');

	validateOtaFile(file)
		.then(function (problem) {
			if (problem) { throw new Error(problem); }
			return checkOtaPassword();
		})
		.then(function (ok) {
			if (!ok) { throw new Error('Senha incorreta.'); }
			setOtaStatus('Não feche esta página até o relógio reiniciar.');
			setOtaProgress(0, 'Enviando e gravando');
			return uploadOtaFile(file);
		})
		.then(function () {
			setOtaProgress(100, 'Reiniciando o relógio', 'done');
			setOtaStatus('Gravação concluída. Aguardando o relógio reiniciar...');
			return waitForReboot();
		})
		.then(function (info) {
			if (otaState.target === 'fs') {
				setOtaStatus('Interface atualizada. Recarregando a página...', 'ok');
				setTimeout(function () { location.reload(); }, 1000);
				return;
			}
			renderOtaInfo(info);
			setOtaStatus('Firmware atualizado (compilado em ' + info.build + ').', 'ok');
			setOtaFile(null);
			setOtaBusy(false);
			loadData();
		})
		.catch(function (err) {
			var reason = err.message === 'Failed to fetch' ? 'Relógio inacessível.' : err.message;
			setOtaStatus(reason, 'error');
			if (!document.getElementById('otaProgressBox').classList.contains('d-none')) {
				setOtaProgress(parseFloat(document.getElementById('otaBar').style.width) || 0, 'Falhou', 'error');
			}
			setOtaBusy(false);
		});
}

function bindOtaEvents() {
	document.getElementById('otaTargetFw').addEventListener('click', function () { otaState.target = 'fw'; setOtaFile(otaState.file); });
	document.getElementById('otaTargetFs').addEventListener('click', function () { otaState.target = 'fs'; setOtaFile(otaState.file); });
	document.getElementById('otaFile').addEventListener('change', function () { setOtaFile(this.files[0]); });
	document.getElementById('otaSend').addEventListener('click', startOtaUpdate);

	var drop = document.getElementById('otaDrop');
	['dragenter', 'dragover'].forEach(function (ev) {
		drop.addEventListener(ev, function (e) {
			e.preventDefault();
			if (!otaState.busy) { drop.classList.add('dragover'); }
		});
	});
	['dragleave', 'drop'].forEach(function (ev) {
		drop.addEventListener(ev, function (e) {
			e.preventDefault();
			drop.classList.remove('dragover');
		});
	});
	drop.addEventListener('drop', function (e) {
		if (!otaState.busy && e.dataTransfer.files.length) { setOtaFile(e.dataTransfer.files[0]); }
	});
}

/* ── Abas ────────────────────────────────────────────── */
var TAB_NAMES = ['config', 'ota', 'log'];

function showTab(name, focus) {
	if (TAB_NAMES.indexOf(name) < 0) { name = 'config'; }
	document.querySelectorAll('.tab-btn').forEach(function (btn) {
		var active = btn.dataset.tab === name;
		btn.classList.toggle('active', active);
		btn.setAttribute('aria-selected', active ? 'true' : 'false');
		btn.tabIndex = active ? 0 : -1;
		document.getElementById(btn.getAttribute('aria-controls')).hidden = !active;
		if (active && focus) { btn.focus(); }
	});
	if (name === 'log' && document.getElementById('logAutoScroll').checked) {
		var view = document.getElementById('logView');
		view.scrollTop = view.scrollHeight;
	}
	if (history.replaceState) {
		history.replaceState(null, '', name === 'config' ? window.location.pathname + window.location.search : '#' + name);
	}
}

function bindTabEvents() {
	var buttons = Array.prototype.slice.call(document.querySelectorAll('.tab-btn'));
	buttons.forEach(function (btn, i) {
		btn.addEventListener('click', function () { showTab(btn.dataset.tab); });
		btn.addEventListener('keydown', function (e) {
			var next = null;
			if (e.key === 'ArrowRight') { next = buttons[(i + 1) % buttons.length]; }
			if (e.key === 'ArrowLeft')  { next = buttons[(i - 1 + buttons.length) % buttons.length]; }
			if (e.key === 'Home')       { next = buttons[0]; }
			if (e.key === 'End')        { next = buttons[buttons.length - 1]; }
			if (next) {
				e.preventDefault();
				showTab(next.dataset.tab, true);
			}
		});
	});
	showTab(window.location.hash.replace('#', ''));
}

/* ── Entry point ─────────────────────────────────────── */
function startup() {
	document.getElementById('deviceHost').textContent = window.location.host || 'arquivo local';
	setControlsEnabled(false);
	bindEvents();
	bindTabEvents();
	bindLogEvents();
	bindOtaEvents();
	renderOtaTarget();
	loadData();
	loadOtaInfo();
	fetchLogs();
	scheduleLogPolling();
}

startup();