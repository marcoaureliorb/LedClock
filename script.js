// Configuration
const API_BASE_URL = 'http://192.168.100.7';
let isConnected = false;

// Utility Functions
const zeroPad = (num, places) => String(num).padStart(places, '0');

function componentToHex(c) {
    const hex = c.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
}

function rgbToHex(r, g, b) {
    return '#' + componentToHex(r) + componentToHex(g) + componentToHex(b);
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

// API Functions
async function makeRequest(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Request failed:', error);
        updateConnectionStatus(false);
        throw error;
    }
}

async function getInfo() {
    try {
        const url = `${API_BASE_URL}/getinfo`;
        const data = await makeRequest(url);
        updateConnectionStatus(true);
        return data;
    } catch (error) {
        console.error('Failed to get info:', error);
        return null;
    }
}

async function updateColorSetting(api, digit, color) {
    try {
        const rgb = hexToRgb(color);
        if (!rgb) return;
        
        const url = `${API_BASE_URL}/${api}?p=${digit}&r=${rgb.r}&g=${rgb.g}&b=${rgb.b}`;
        console.log('Updating color:', url);
        await makeRequest(url);
    } catch (error) {
        console.error('Failed to update color:', error);
    }
}

async function setBrightnessState(api, mode) {
    try {
        const url = `${API_BASE_URL}/${api}?p=${mode}&p1=${mode}`;
        await makeRequest(url);
    } catch (error) {
        console.error('Failed to set brightness state:', error);
    }
}

// UI Update Functions
function updateConnectionStatus(connected) {
    isConnected = connected;
    const statusElement = document.getElementById('connectionStatus');
    const statusDot = statusElement.querySelector('.status-dot');
    const statusText = statusElement.querySelector('span');
    
    if (connected) {
        statusDot.style.background = 'var(--success)';
        statusText.textContent = 'Connected';
        statusElement.style.color = 'var(--success)';
    } else {
        statusDot.style.background = 'var(--error)';
        statusText.textContent = 'Disconnected';
        statusElement.style.color = 'var(--error)';
    }
}

function updateColorInput(elementId, colorValue) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    // Parse color value from format like "(255,255,255)" or "#ffffff"
    let hexColor;
    if (colorValue.startsWith('(') && colorValue.endsWith(')')) {
        const values = colorValue.replace('(', '').replace(')', '').split(',');
        const r = parseInt(values[0]);
        const g = parseInt(values[1]);
        const b = parseInt(values[2]);
        hexColor = rgbToHex(r, g, b);
    } else if (colorValue.startsWith('#')) {
        hexColor = colorValue;
    } else {
        return;
    }
    
    element.value = hexColor;
}

function updateBrightnessButtons(buttonIds, activeMode) {
    // Remove active class from all buttons
    buttonIds.forEach(id => {
        const button = document.getElementById(id);
        if (button) {
            button.classList.remove('active');
        }
    });
    
    // Add active class to the correct button
    let activeButtonId;
    switch (activeMode) {
        case '0':
            activeButtonId = buttonIds[1]; // OFF
            break;
        case '1':
            activeButtonId = buttonIds[0]; // ON
            break;
        case '2':
            activeButtonId = buttonIds[2]; // AUTO
            break;
    }
    
    if (activeButtonId) {
        const activeButton = document.getElementById(activeButtonId);
        if (activeButton) {
            activeButton.classList.add('active');
        }
    }
}

function updateUI(data) {
    if (!data) return;
    
    // Update status values
    document.getElementById('idTime').textContent = data.Time || '--:--:--';
    document.getElementById('idTemp').textContent = data.Temperature || '-- °C';
    document.getElementById('idbsm').textContent = data.Brightness_Sensor_map || '--';
    
    // Update temperature URL
    const tempUrlInput = document.getElementById('txtTempUrl');
    if (tempUrlInput) {
        tempUrlInput.value = data.Url_Temperature || '';
    }
    
    // Update clock colors
    updateColorInput('clock_first_hour_color', data.Clock_First_Hour_Color);
    updateColorInput('clock_second_hour_color', data.Clock_Second_Hour_Color);
    updateColorInput('clock_first_minute_color', data.Clock_First_Minute_Color);
    updateColorInput('clock_secod_minute_color', data.Clock_Secod_Minute_Color);
    
    // Update temperature colors
    updateColorInput('Temp_First_Value_Color', data.Temp_First_Value_Color);
    updateColorInput('Temp_Second_Value_Color', data.Temp_Second_Value_Color);
    updateColorInput('Temp_First_Symbol_Color', data.Temp_First_Symbol_Color);
    updateColorInput('Temp_Second_Symbol_Color', data.Temp_Second_Symbol_Color);
    
    // Update brightness states
    if (data.Clock_Brightness_Mode) {
        const clockMode = data.Clock_Brightness_Mode[0];
        updateBrightnessButtons(['idCBSOn', 'idCBSOff', 'idCBSAuto'], clockMode);
    }
    
    if (data.Deco_Brightness_Mode) {
        const decoMode = data.Deco_Brightness_Mode[0];
        updateBrightnessButtons(['idDBSOn', 'idDBSOff', 'idDBSAuto'], decoMode);
    }
    
    // Update decoration colors
    if (data.Deco_Color) {
        const decoColors = data.Deco_Color.replaceAll(' ', '').split('-');
        for (let i = 0; i < 14 && i < decoColors.length; i++) {
            updateColorInput(`favDLC${i + 1}`, decoColors[i]);
        }
    }
}

// Event Handlers
function setupColorEventListeners() {
    // Clock colors
    const clockColorMappings = [
        { id: 'clock_first_hour_color', api: 'setHourColor', digit: '1' },
        { id: 'clock_second_hour_color', api: 'setHourColor', digit: '2' },
        { id: 'clock_first_minute_color', api: 'setHourColor', digit: '3' },
        { id: 'clock_secod_minute_color', api: 'setHourColor', digit: '4' }
    ];
    
    clockColorMappings.forEach(mapping => {
        const element = document.getElementById(mapping.id);
        if (element) {
            element.addEventListener('change', (e) => {
                updateColorSetting(mapping.api, mapping.digit, e.target.value);
            });
        }
    });
    
    // Temperature colors
    const tempColorMappings = [
        { id: 'Temp_First_Value_Color', api: 'setcolortemp', digit: '1' },
        { id: 'Temp_Second_Value_Color', api: 'setcolortemp', digit: '2' },
        { id: 'Temp_First_Symbol_Color', api: 'setcolortemp', digit: '3' },
        { id: 'Temp_Second_Symbol_Color', api: 'setcolortemp', digit: '4' }
    ];
    
    tempColorMappings.forEach(mapping => {
        const element = document.getElementById(mapping.id);
        if (element) {
            element.addEventListener('change', (e) => {
                updateColorSetting(mapping.api, mapping.digit, e.target.value);
            });
        }
    });
    
    // Decoration colors
    for (let i = 1; i <= 14; i++) {
        const element = document.getElementById(`favDLC${i}`);
        if (element) {
            element.addEventListener('change', (e) => {
                updateColorSetting('setdecocolor', i.toString(), e.target.value);
            });
        }
    }
}

function setupBrightnessEventListeners() {
    // Clock brightness buttons
    const clockBrightnessButtons = [
        { id: 'idCBSOn', mode: 'ON', api: 'setclockbrightnessstate' },
        { id: 'idCBSOff', mode: 'OFF', api: 'setclockbrightnessstate' },
        { id: 'idCBSAuto', mode: 'AUTO', api: 'setclockbrightnessstate' }
    ];
    
    clockBrightnessButtons.forEach(button => {
        const element = document.getElementById(button.id);
        if (element) {
            element.addEventListener('click', async () => {
                await setBrightnessState(button.api, button.mode);
                updateBrightnessButtons(['idCBSOn', 'idCBSOff', 'idCBSAuto'], 
                    button.mode === 'ON' ? '1' : button.mode === 'OFF' ? '0' : '2');
            });
        }
    });
    
    // Decoration brightness buttons
    const decoBrightnessButtons = [
        { id: 'idDBSOn', mode: 'ON', api: 'setdecobrightnessstate' },
        { id: 'idDBSOff', mode: 'OFF', api: 'setdecobrightnessstate' },
        { id: 'idDBSAuto', mode: 'AUTO', api: 'setdecobrightnessstate' }
    ];
    
    decoBrightnessButtons.forEach(button => {
        const element = document.getElementById(button.id);
        if (element) {
            element.addEventListener('click', async () => {
                await setBrightnessState(button.api, button.mode);
                updateBrightnessButtons(['idDBSOn', 'idDBSOff', 'idDBSAuto'], 
                    button.mode === 'ON' ? '1' : button.mode === 'OFF' ? '0' : '2');
            });
        }
    });
}

function setupOtherEventListeners() {
    // Temperature URL update button
    const updateTempUrlButton = document.getElementById('updateTempUrl');
    if (updateTempUrlButton) {
        updateTempUrlButton.addEventListener('click', () => {
            const urlInput = document.getElementById('txtTempUrl');
            if (urlInput && urlInput.value) {
                // Here you would implement the temperature URL update API call
                console.log('Updating temperature URL:', urlInput.value);
                // For now, just show a visual feedback
                updateTempUrlButton.innerHTML = '<i class="fas fa-check"></i> Updated';
                setTimeout(() => {
                    updateTempUrlButton.innerHTML = '<i class="fas fa-save"></i> Update';
                }, 2000);
            }
        });
    }
}

// Auto-refresh functionality
function startAutoRefresh() {
    setInterval(async () => {
        if (isConnected) {
            const data = await getInfo();
            if (data) {
                updateUI(data);
            }
        }
    }, 5000); // Refresh every 5 seconds
}

// Initialization
async function startup() {
    console.log('Starting LED Clock Interface...');
    
    // Setup event listeners
    setupColorEventListeners();
    setupBrightnessEventListeners();
    setupOtherEventListeners();
    
    // Initial data load
    const data = await getInfo();
    updateUI(data);
    
    // Start auto-refresh
    startAutoRefresh();
    
    console.log('LED Clock Interface initialized successfully');
}

// Start the application when DOM is loaded
document.addEventListener('DOMContentLoaded', startup);

// Handle page visibility changes to pause/resume auto-refresh
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        console.log('Page hidden, pausing auto-refresh');
    } else {
        console.log('Page visible, resuming auto-refresh');
        // Immediately refresh when page becomes visible
        getInfo().then(updateUI);
    }
});