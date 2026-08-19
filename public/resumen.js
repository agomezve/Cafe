exigirSesion();

document.addEventListener('DOMContentLoaded', async () => {
    cargarPedidos();
});

// Los pedidos caducan solos, así que se refresca la lista cada poco (solo con
// la pantalla a la vista) para no enseñar pedidos del turno anterior. Si falla
// la red se ignora y se reintenta en el siguiente refresco.
function refrescarSiVisible() {
    if (!document.hidden) cargarPedidos().catch(() => {});
}

setInterval(refrescarSiVisible, 30000);
document.addEventListener('visibilitychange', refrescarSiVisible);

function escapeHtml(texto) {
    return String(texto).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

async function cargarPedidos() {
    const response = await authFetch('/api/resumen');
    const pedidos = await response.json();
    const lista = document.getElementById('listaPedidos');
    const total = document.getElementById('totalPedidos');

    lista.innerHTML = '';

    if (pedidos.length === 0) {
        lista.innerHTML = '<p style="text-align: center; color: #888;">No hay pedidos en este turno todavía.</p>';
        total.innerText = '';
        return;
    }

    total.innerText = `Total de cafés: ${pedidos.length}`;

    const conteoCafes = {};
    let totalHielos = 0;
    const nombres = [];

    pedidos.forEach(pedido => {
        const tipo = pedido.tipo_cafe;
        conteoCafes[tipo] = (conteoCafes[tipo] || 0) + 1;

        if (pedido.hielo) totalHielos++;

        const extraHielo = pedido.hielo ? ' + Hielo' : '';
        nombres.push(`${escapeHtml(pedido.usuario)} (${escapeHtml(pedido.tipo_cafe)}${extraHielo})`);
    });

    let htmlAgrupado = `<div style="background: #F9F6F0; padding: 20px; border-radius: 12px; margin-bottom: 20px; border-left: 5px solid var(--primary-color); text-align: left; font-size: 1.2rem; line-height: 1.8;">`;

    for (const [tipo, cantidad] of Object.entries(conteoCafes)) {
        let icono = '☕';
        if (tipo === 'Con Leche') icono = '🥛';
        if (tipo === 'Cortado') icono = '🤏';
        htmlAgrupado += `<p>${icono} ${escapeHtml(tipo)}: <strong>x${cantidad}</strong></p>`;
    }

    if (totalHielos > 0) {
        htmlAgrupado += `<p>🧊 Vasos de hielo: <strong>x${totalHielos}</strong></p>`;
    }
    htmlAgrupado += `</div>`;

    let htmlNombres = `
        <div style="background: #ffffff; padding: 15px; border-radius: 8px; border: 1px dashed #ccc; text-align: left; font-size: 1rem; color: #555;">
            <p style="margin-bottom: 5px; color: var(--primary-color);"><strong>👤 Han pedido:</strong></p>
            <p><em>${nombres.join(', ')}</em></p>
        </div>
    `;

    lista.innerHTML = htmlAgrupado + htmlNombres;
}

document.getElementById('btnLimpiarTurno').addEventListener('click', async () => {
    if (confirm("¿Seguro que quieres borrar todos los pedidos para empezar un nuevo turno?")) {
        await authFetch('/api/pedidos', { method: 'DELETE' });
        cargarPedidos();
    }
});

document.getElementById('btnVolver').addEventListener('click', () => {
    window.location.href = 'app.html';
});

document.getElementById('btnCerrarSesion').addEventListener('click', cerrarSesion);
