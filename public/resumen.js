exigirSesion();

// Cada cuánto se pregunta al servidor mientras la pantalla está a la vista:
// lo bastante seguido para que un pedido nuevo o un cambio salga al momento.
// Con la app en segundo plano no se pregunta nada.
const MS_REFRESCO = 3000;

// Lo último que se pintó, para no repintar si no ha cambiado nada (así la
// pantalla no parpadea ni salta cada pocos segundos)
let ultimoPintado = null;
let cargando = false;
let temporizador = null;

document.addEventListener('DOMContentLoaded', () => {
    avisarHecho();
    refrescar();
});

// Pide la lista y deja programada la siguiente. Nunca hay dos peticiones a la
// vez: si una tarda, la siguiente espera a que acabe.
async function refrescar() {
    clearTimeout(temporizador);
    if (document.hidden || cargando) return;

    cargando = true;
    try {
        await cargarPedidos();
    } finally {
        cargando = false;
        temporizador = setTimeout(refrescar, MS_REFRESCO);
    }
}

// Al volver a la app se pone al día en el acto, sin esperar a la siguiente vuelta
document.addEventListener('visibilitychange', refrescar);

function escapeHtml(texto) {
    return String(texto).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function hora(fecha) {
    return new Date(fecha).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function plural(numero, uno, varios) {
    return `${numero} ${numero === 1 ? uno : varios}`;
}

// Al llegar desde "Guardar pedido" se dice que ha ido bien
function avisarHecho() {
    const hecho = new URLSearchParams(window.location.search).get('hecho');
    if (!hecho) return;

    const aviso = document.getElementById('avisoHecho');
    aviso.innerText = hecho === 'modificado'
        ? '✅ ¡Pedido modificado! Así queda el turno.'
        : '✅ ¡Pedido guardado! Así va el turno.';
    aviso.classList.remove('hidden');

    // Sin el "?hecho" en la dirección, al recargar no vuelve a salir
    history.replaceState(null, '', window.location.pathname);
    setTimeout(() => aviso.classList.add('hidden'), 6000);
}

// Cuántas hay de cada cosa de un apartado, sumando las cantidades de todos,
// en el orden en que se pidieron. Lo de la plancha cuenta aparte, que en la
// barra es otra cosa que preparar; el hielo no, que se cuenta en vasos.
function contar(pedidos, clase, iconoPorDefecto) {
    const conteo = new Map();
    pedidos.forEach(pedido => {
        pedido.items
            .filter(item => item.clase === clase)
            .forEach(item => {
                const texto = CATALOGO.etiqueta(item.nombre) + (item.plancha ? ' a la plancha' : '');
                const clave = CATALOGO.clave(texto) || texto;
                if (!conteo.has(clave)) {
                    conteo.set(clave, { texto, icono: CATALOGO.icono(item.nombre, iconoPorDefecto), cantidad: 0 });
                }
                conteo.get(clave).cantidad += CATALOGO.cantidad(item.cantidad);
            });
    });
    return [...conteo.values()];
}

function sumarCantidades(lista) {
    return lista.reduce((suma, cosa) => suma + cosa.cantidad, 0);
}

function vasosDeHielo(pedidos) {
    return pedidos.reduce((suma, pedido) => suma + pedido.items
        .filter(item => item.hielo)
        .reduce((vasos, item) => vasos + CATALOGO.cantidad(item.cantidad), 0), 0);
}

function bloqueConteo(titulo, conteo, extra = '') {
    const lineas = conteo
        .map(cosa => `<p>${cosa.icono} ${escapeHtml(cosa.texto)}: <strong>x${cosa.cantidad}</strong></p>`)
        .join('');

    if (!lineas && !extra) return '';

    return `<div class="bloque text-[1.2rem] leading-[1.8]">
        <p class="bloque-titulo">${titulo}</p>
        ${lineas}${extra}
    </div>`;
}

// Una fila por persona, por orden de llegada: el nombre en negrita, lo que ha
// pedido y, al final, la hora a la que lo pidió (y la del último cambio, si
// lo ha cambiado). La fila propia sale resaltada.
function bloquePersonas(pedidos) {
    const yo = getUsuario();

    const filas = pedidos.map(pedido => {
        const items = pedido.items.map(CATALOGO.describir).join(', ');
        const cambio = pedido.modificadoEn
            ? `<span class="block text-[0.75rem] font-normal text-[#8a7a6f]">✏️ ${hora(pedido.modificadoEn)}</span>`
            : '';
        return `<li class="persona${pedido.usuario === yo ? ' persona-mia' : ''}">
            <p class="min-w-0 flex-1 break-words"><strong>${escapeHtml(pedido.usuario)}</strong>: ${escapeHtml(items)}</p>
            <span class="hora">${hora(pedido.creadoEn)}${cambio}</span>
        </li>`;
    }).join('');

    return `<div class="bloque py-2">
        <p class="bloque-titulo mt-2">👤 Pedidos por orden de llegada</p>
        <ul>${filas}</ul>
    </div>`;
}

function pintarResumen(pedidos) {
    const lista = document.getElementById('listaPedidos');
    const total = document.getElementById('totalPedidos');

    const firma = JSON.stringify(pedidos);
    if (firma === ultimoPintado) return;
    ultimoPintado = firma;

    if (pedidos.length === 0) {
        lista.innerHTML = '<p class="text-center text-[#888]">No hay pedidos en este turno todavía.</p>';
        total.innerText = '';
        return;
    }

    const bebidas = contar(pedidos, 'bebida', '☕');
    const pinchos = contar(pedidos, 'pincho', '🥘');
    const hielos = vasosDeHielo(pedidos);

    total.innerText = [
        plural(pedidos.length, 'persona', 'personas'),
        plural(sumarCantidades(bebidas), 'bebida', 'bebidas'),
        plural(sumarCantidades(pinchos), 'pincho', 'pinchos'),
    ].join(' · ');

    const extraHielo = hielos > 0 ? `<p>🧊 Vasos de hielo: <strong>x${hielos}</strong></p>` : '';

    lista.innerHTML =
        '<h3 class="apartado">🧾 Para pedir en la barra</h3>' +
        bloqueConteo('Cafés y bebidas', bebidas, extraHielo) +
        bloqueConteo('Pinchos', pinchos) +
        bloquePersonas(pedidos);
}

async function cargarPedidos() {
    const actualizado = document.getElementById('actualizado');

    let pedidos;
    try {
        const respuesta = await authFetch('/api/resumen');
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
        pedidos = await respuesta.json();
    } catch (err) {
        // Se deja lo que hubiera en pantalla y se reintenta en el siguiente refresco
        actualizado.innerText = '⚠️ No se pudo actualizar. Se reintentará solo.';
        return;
    }

    pintarResumen(pedidos);
    actualizado.innerText = '🟢 En directo: los pedidos salen según llegan';
}

document.getElementById('btnLimpiarTurno').addEventListener('click', async () => {
    if (!confirm('¿Seguro que quieres borrar todos los pedidos para empezar un nuevo turno?')) return;

    try {
        await authFetch('/api/pedidos', { method: 'DELETE' });
        // Vacía en el acto, aunque hubiera una consulta a medias
        pintarResumen([]);
    } catch (err) {
        alert('No se pudo borrar la lista. Inténtalo otra vez.');
    }
    refrescar();
});

document.getElementById('btnVolver').addEventListener('click', () => {
    window.location.href = 'app.html';
});

document.getElementById('btnCerrarSesion').addEventListener('click', cerrarSesion);
