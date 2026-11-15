const API_BASE = window.location.origin;
let ramChart = null;
const chartData = { labels: [], datasets: [{ label: 'RAM', data: [], borderColor: '#00d9ff', backgroundColor: 'rgba(0, 217, 255, 0.15)', fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2 }] };

function initChart() {
    const ctx = document.getElementById('ramChart').getContext('2d');
    ramChart = new Chart(ctx, { type: 'line', data: chartData, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { min: 0, max: 100, ticks: { color: '#8a8aa0', font: { size: 10 }, stepSize: 50 }, grid: { color: 'rgba(255,255,255,0.05)' } } }, animation: { duration: 500 } } });
}

function pushChartData(ram) {
    chartData.labels.push(''); chartData.datasets[0].data.push(ram);
    if (chartData.labels.length > 20) { chartData.labels.shift(); chartData.datasets[0].data.shift(); }
    ramChart.update('none');
}

async function fetchStatus() {
    try {
        const res = await fetch(`${API_BASE}/api/status`);
        if (!res.ok) throw new Error('API error');
        const d = (await res.json()).data;
        document.getElementById('val-battery').innerText = d.battery + '%'; document.getElementById('bar-battery').style.width = d.battery + '%';
        document.getElementById('val-ram').innerText = d.ram + '%'; document.getElementById('bar-ram').style.width = d.ram + '%';
        document.getElementById('val-storage').innerText = d.storage + '%'; document.getElementById('bar-storage').style.width = d.storage + '%';
        document.getElementById('val-uptime').innerText = d.uptime;
        document.getElementById('val-device').innerText = d.device; document.getElementById('val-network').innerText = d.network;
        document.getElementById('val-session').innerText = d.session; document.getElementById('val-time').innerText = d.time;
        document.getElementById('botName').innerText = d.botName; document.getElementById('botVersion').innerText = 'v' + d.botVersion; document.getElementById('lastUpdate').innerText = d.time;
        document.getElementById('statusText').innerText = 'Online'; document.getElementById('statusPill').querySelector('.dot').style.background = '#00e676';
        pushChartData(d.ram);
    } catch (err) {
        document.getElementById('statusText').innerText = 'Offline'; document.getElementById('statusPill').querySelector('.dot').style.background = '#ff3860';
        document.getElementById('val-network').innerText = 'Disconnected'; document.getElementById('val-network').style.color = '#ff3860';
    }
}
initChart(); fetchStatus(); setInterval(fetchStatus, 5000);