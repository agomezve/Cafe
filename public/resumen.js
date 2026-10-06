exigirSesion();

// Lo último que llegó del servidor, para compartirlo sin volver a pedirlo
let ultimosPedidos = [];

document.addEventListener('DOMContentLoaded', () => {
    avisarHecho();
    cargarPedidos();
});

// Los pedidos caducan solos, así que se refresca la lista cada poco (solo con
// la pantalla a la vista) para no enseñar pedidos del turno anterior y ver
// los de los demás según llegan.
function refrescarSiVisible() {
    if (!document.hidden) cargarPedidos();
}

setInterval(refrescarSiVisible, 20000);
document.addEventListener('visibilitychange', refrescarSiVisible);

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
        bloquePersonas(pedidos) +
        '<h3 class="apartado mt-2">🧾 Para pedir en la barra</h3>' +
        bloqueConteo('Cafés y bebidas', bebidas, extraHielo) +
        bloqueConteo('Pinchos', pinchos);
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

    ultimosPedidos = pedidos;
    pintarResumen(pedidos);
    actualizado.innerText = `🔄 Actualizado a las ${hora(new Date())} · se pone al día solo`;
}

// El resumen en texto, para mandarlo por WhatsApp o pegarlo donde sea. Los
// asteriscos ponen el nombre en negrita en WhatsApp.
function textoParaCompartir(pedidos) {
    const lineas = [`☕ Cafendo · Resumen de las ${hora(new Date())}`, ''];

    pedidos.forEach(pedido => {
        lineas.push(`*${pedido.usuario}*: ${pedido.items.map(CATALOGO.describir).join(', ')} (${hora(pedido.creadoEn)})`);
    });

    const bebidas = contar(pedidos, 'bebida', '☕');
    const pinchos = contar(pedidos, 'pincho', '🥘');
    const hielos = vasosDeHielo(pedidos);

    if (bebidas.length > 0) {
        lineas.push('', '*Cafés y bebidas*');
        bebidas.forEach(cosa => lineas.push(`- ${cosa.texto} x${cosa.cantidad}`));
        if (hielos > 0) lineas.push(`- Vasos de hielo x${hielos}`);
    }
    if (pinchos.length > 0) {
        lineas.push('', '*Pinchos*');
        pinchos.forEach(cosa => lineas.push(`- ${cosa.texto} x${cosa.cantidad}`));
    }

    return lineas.join('\n');
}

document.getElementById('btnCompartir').addEventListener('click', async () => {
    if (ultimosPedidos.length === 0) {
        alert('Todavía no hay pedidos que compartir.');
        return;
    }

    const texto = textoParaCompartir(ultimosPedidos);
    const btn = document.getElementById('btnCompartir');

    // En el móvil sale el menú de compartir (WhatsApp, Telegram...). Donde no
    // lo hay, se copia y se pega a mano.
    if (navigator.share) {
        try {
            await navigator.share({ text: texto });
            return;
        } catch (err) {
            if (err.name === 'AbortError') return; // lo ha cerrado sin compartir
        }
    }

    try {
        await navigator.clipboard.writeText(texto);
        btn.innerText = '✅ Copiado: pégalo donde quieras';
        setTimeout(() => { btn.innerText = '📤 Compartir resumen'; }, 2500);
    } catch (err) {
        alert('No se pudo copiar el resumen.');
    }
});

document.getElementById('btnLimpiarTurno').addEventListener('click', async () => {
    if (!confirm('¿Seguro que quieres borrar todos los pedidos para empezar un nuevo turno?')) return;

    try {
        await authFetch('/api/pedidos', { method: 'DELETE' });
    } catch (err) {
        alert('No se pudo borrar la lista. Inténtalo otra vez.');
    }
    cargarPedidos();
});

document.getElementById('btnVolver').addEventListener('click', () => {
    window.location.href = 'app.html';
});

document.getElementById('btnCerrarSesion').addEventListener('click', cerrarSesion);
