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

const ICONOS_CAFE = { 'Con Leche': '🥛', 'Cortado': '🤏', 'Descafeinado': '🌙' };
const ICONOS_PINCHO = {
    'Patatas': '🥔', 'Jeta': '🐷', 'Gulas': '🍜', 'Huevos rotos': '🍳',
    'Lasaña': '🍝', 'Tortilla': '🥚', 'Bocadillo': '🥪', 'Gambas rebozadas': '🍤',
};

// Cuenta cuántas veces se repite cada cosa, respetando el orden de llegada
function contar(pedidos, campo) {
    const conteo = {};
    pedidos.forEach(pedido => {
        const valor = pedido[campo];
        if (!valor) return;
        conteo[valor] = (conteo[valor] || 0) + 1;
    });
    return conteo;
}

function bloqueConteo(titulo, conteo, iconos, iconoPorDefecto, extra = '') {
    const lineas = Object.entries(conteo)
        .map(([nombre, cantidad]) =>
            `<p>${iconos[nombre] || iconoPorDefecto} ${escapeHtml(nombre)}: <strong>x${cantidad}</strong></p>`)
        .join('');

    if (!lineas && !extra) return '';

    return `<div class="mb-5 rounded-xl border-l-[5px] border-cafe bg-[#F9F6F0] p-5 text-left text-[1.2rem] leading-[1.8]">
        <p class="mb-1.5 text-[0.95rem] font-bold tracking-wide text-cafe uppercase">${titulo}</p>
        ${lineas}${extra}
    </div>`;
}

async function cargarPedidos() {
    const response = await authFetch('/api/resumen');
    const pedidos = await response.json();
    const lista = document.getElementById('listaPedidos');
    const total = document.getElementById('totalPedidos');

    lista.innerHTML = '';

    if (pedidos.length === 0) {
        lista.innerHTML = '<p class="text-center text-[#888]">No hay pedidos en este turno todavía.</p>';
        total.innerText = '';
        return;
    }

    const cafes = contar(pedidos, 'tipo_cafe');
    const pinchos = contar(pedidos, 'pincho');
    const totalCafes = Object.values(cafes).reduce((a, b) => a + b, 0);
    const totalPinchos = Object.values(pinchos).reduce((a, b) => a + b, 0);
    const totalHielos = pedidos.filter(pedido => pedido.hielo).length;

    total.innerText = `${totalCafes} cafés · ${totalPinchos} pinchos`;

    const nombres = pedidos.map(pedido => {
        const partes = [];
        if (pedido.tipo_cafe) partes.push(pedido.tipo_cafe + (pedido.hielo ? ' + Hielo' : ''));
        if (pedido.pincho) partes.push(pedido.pincho);
        return `${escapeHtml(pedido.usuario)} (${escapeHtml(partes.join(', '))})`;
    });

    const extraHielo = totalHielos > 0 ? `<p>🧊 Vasos de hielo: <strong>x${totalHielos}</strong></p>` : '';

    const htmlNombres = `
        <div class="rounded-lg border border-dashed border-[#ccc] bg-white p-[15px] text-left text-base text-[#555]">
            <p class="mb-[5px] text-cafe"><strong>👤 Han pedido:</strong></p>
            <p><em>${nombres.join(', ')}</em></p>
        </div>
    `;

    lista.innerHTML =
        bloqueConteo('Cafés y bebidas', cafes, ICONOS_CAFE, '☕', extraHielo) +
        bloqueConteo('Pinchos', pinchos, ICONOS_PINCHO, '🥘') +
        htmlNombres;
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
