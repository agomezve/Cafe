exigirSesion();

const inputOtro = document.getElementById('otroTexto');
const lista = document.getElementById('listaArticulos');
const aviso = document.getElementById('avisoGuardado');

// La lista se pinta desde el catálogo, igual que la carta del bar. "Otro" va
// al final, para lo que no esté previsto.
[...CATALOGO.compra, 'Otro'].forEach(nombre => {
    const fila = document.createElement('div');
    fila.className = 'opcion';

    const etiqueta = document.createElement('label');
    etiqueta.className = 'opcion-etiqueta';

    const marca = document.createElement('input');
    marca.type = 'checkbox';
    marca.className = 'marca';
    marca.value = nombre;
    etiqueta.append(marca, ` ${CATALOGO.icono(nombre, '🧺')} ${nombre}`);
    fila.append(etiqueta);

    if (nombre === 'Otro') {
        marca.addEventListener('change', () => {
            inputOtro.classList.toggle('hidden', !marca.checked);
            if (marca.checked) inputOtro.focus();
        });
    }

    lista.append(fila);
});

function marcas() {
    return [...document.querySelectorAll('.marca')];
}

function marcaOtro() {
    return marcas().find(m => m.value === 'Otro');
}

function escapeHtml(texto) {
    return String(texto).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// Lo marcado. "Otro" se cambia por lo escrito a mano.
function elegidos() {
    return marcas()
        .filter(m => m.checked)
        .map(m => (m.value === 'Otro' ? inputOtro.value.trim() : m.value))
        .filter(Boolean);
}

function limpiarMarcas() {
    marcas().forEach(m => { m.checked = false; });
    inputOtro.value = '';
    inputOtro.classList.add('hidden');
}

document.getElementById('btnGuardar').addEventListener('click', async () => {
    const btn = document.getElementById('btnGuardar');

    if (marcaOtro().checked && !inputOtro.value.trim()) {
        alert('Escribe qué otra cosa hace falta.');
        inputOtro.focus();
        return;
    }

    const articulos = elegidos();
    if (articulos.length === 0) {
        alert('Marca al menos un artículo.');
        return;
    }

    // Se desactiva antes de la petición para que un doble toque no mande dos
    btn.disabled = true;
    btn.innerText = 'Guardando...';

    try {
        const respuesta = await authFetch('/api/compra', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ articulos }),
        });

        if (respuesta.ok) {
            const datos = await respuesta.json();
            const nuevos = datos.nuevos.length;

            if (nuevos === 0) {
                aviso.innerText = 'Eso ya estaba apuntado en la lista.';
            } else {
                aviso.innerText = nuevos === 1
                    ? `Apuntado. Se ha avisado a ${CATALOGO.avisarCompraA}.`
                    : `${nuevos} artículos apuntados. Se ha avisado a ${CATALOGO.avisarCompraA}.`;
            }

            limpiarMarcas();
            await pintarLista();
        } else {
            const error = await respuesta.json();
            alert(error.error);
        }
    } catch (err) {
        alert('No se pudo guardar. Revisa tu conexión.');
    } finally {
        btn.disabled = false;
        btn.innerText = 'Guardar artículos';
    }
});

// El resumen: solo los artículos, sin quién los pidió
async function pintarLista() {
    const caja = document.getElementById('resumenCompra');

    let articulos;
    try {
        const respuesta = await authFetch('/api/compra');
        articulos = await respuesta.json();
    } catch (err) {
        return;
    }

    if (articulos.length === 0) {
        caja.innerHTML = '<p class="mt-4 text-center text-[#888]">La lista está vacía.</p>';
        return;
    }

    const lineas = articulos
        .map(articulo => `<p>${CATALOGO.icono(articulo, '🧺')} ${escapeHtml(articulo)}</p>`)
        .join('');

    caja.innerHTML = `
        <div class="mt-4 rounded-xl border-l-[5px] border-cafe bg-[#F9F6F0] p-5 text-left text-[1.2rem] leading-[1.8]">
            <p class="mb-1.5 text-[0.95rem] font-bold tracking-wide text-cafe uppercase">
                Hay que comprar (${articulos.length})
            </p>
            ${lineas}
        </div>
    `;
}

document.getElementById('btnPedido').addEventListener('click', pintarLista);

document.getElementById('btnBorrar').addEventListener('click', async () => {
    if (!confirm('¿Seguro que quieres borrar toda la lista de la compra?')) return;

    try {
        await authFetch('/api/compra', { method: 'DELETE' });
        aviso.innerText = 'Lista borrada.';
        await pintarLista();
    } catch (err) {
        alert('No se pudo borrar la lista. Inténtalo otra vez.');
    }
});

document.getElementById('btnVolver').addEventListener('click', () => {
    window.location.href = 'app.html';
});

document.getElementById('btnCerrarSesion').addEventListener('click', cerrarSesion);

// Al abrir se enseña lo que ya hay apuntado, sin tener que pedirlo
pintarLista();
