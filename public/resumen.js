exigirSesion();
const bar = exigirBar();

document.getElementById('nombreBar').innerText = bar.nombre;

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

// Cuenta cuántas veces se repite cada cosa de un apartado, respetando el orden
// de llegada
function contar(pedidos, clase) {
    const conteo = {};
    pedidos.forEach(pedido => {
        pedido.items
            .filter(item => item.clase === clase)
            .forEach(item => {
                conteo[item.nombre] = (conteo[item.nombre] || 0) + 1;
            });
    });
    return conteo;
}

function bloqueConteo(titulo, conteo, iconoPorDefecto, extra = '') {
    const lineas = Object.entries(conteo)
        .map(([nombre, cantidad]) =>
            `<p>${CATALOGO.icono(nombre, iconoPorDefecto)} ${escapeHtml(CATALOGO.etiqueta(nombre))}: <strong>x${cantidad}</strong></p>`)
        .join('');

    if (!lineas && !extra) return '';

    return `<div class="mb-5 rounded-xl border-l-[5px] border-cafe bg-[#F9F6F0] p-5 text-left text-[1.2rem] leading-[1.8]">
        <p class="mb-1.5 text-[0.95rem] font-bold tracking-wide text-cafe uppercase">${titulo}</p>
        ${lineas}${extra}
    </div>`;
}

async function cargarPedidos() {
    const response = await authFetch(`/api/resumen?bar=${encodeURIComponent(bar.id)}`);
    const pedidos = await response.json();
    const lista = document.getElementById('listaPedidos');
    const total = document.getElementById('totalPedidos');

    lista.innerHTML = '';

    if (pedidos.length === 0) {
        lista.innerHTML = '<p class="text-center text-[#888]">No hay pedidos en este turno todavía.</p>';
        total.innerText = '';
        return;
    }

    const bebidas = contar(pedidos, 'bebida');
    const pinchos = contar(pedidos, 'pincho');
    const totalBebidas = Object.values(bebidas).reduce((a, b) => a + b, 0);
    const totalPinchos = Object.values(pinchos).reduce((a, b) => a + b, 0);
    const totalHielos = pedidos.reduce(
        (suma, pedido) => suma + pedido.items.filter(item => item.hielo).length, 0);

    total.innerText = `${totalBebidas} bebidas · ${totalPinchos} pinchos`;

    const nombres = pedidos.map(pedido => {
        const partes = pedido.items.map(item =>
            CATALOGO.etiqueta(item.nombre) + (item.hielo ? ' + Hielo' : ''));
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
        bloqueConteo('Cafés y bebidas', bebidas, '☕', extraHielo) +
        bloqueConteo('Pinchos', pinchos, '🥘') +
        htmlNombres;
}

document.getElementById('btnLimpiarTurno').addEventListener('click', async () => {
    if (confirm(`¿Seguro que quieres borrar todos los pedidos del ${bar.nombre} para empezar un nuevo turno?`)) {
        await authFetch(`/api/pedidos?bar=${encodeURIComponent(bar.id)}`, { method: 'DELETE' });
        cargarPedidos();
    }
});

document.getElementById('btnVolver').addEventListener('click', () => {
    window.location.href = 'app.html';
});

document.getElementById('btnCerrarSesion').addEventListener('click', cerrarSesion);
