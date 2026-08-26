// "Avísame todos los días a las 10:30".
//
// El móvil no puede programarse el aviso solo: lo manda el servidor a esa hora
// a todos los que han dicho que sí. Aquí solo se pide el permiso una vez y se
// le pasa al servidor la dirección de este móvil (la "suscripción").

const bloqueAvisos = document.getElementById('avisoNotificaciones');
const textoAvisos = document.getElementById('textoNotificaciones');
const btnAvisarme = document.getElementById('btnAvisarme');
const estadoAvisos = document.getElementById('estadoAvisos');

const HORA_AVISO = '10:30';

const soportaAvisos =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// En iPhone los avisos solo llegan si la app se ha abierto desde el icono de la
// pantalla de inicio, nunca desde una pestaña de Safari.
const esIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const desdeIcono = window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

function mostrarBloque(texto, conBoton) {
    textoAvisos.innerText = texto;
    btnAvisarme.classList.toggle('hidden', !conBoton);
    bloqueAvisos.classList.remove('hidden');
}

function ocultarBloque() {
    bloqueAvisos.classList.add('hidden');
}

// Ya avisado: el bloque desaparece y queda solo una línea discreta abajo, con
// la puerta de salida para quien se arrepienta.
function mostrarYaAvisado() {
    ocultarBloque();
    estadoAvisos.innerText = '';
    estadoAvisos.append(`🔔 Te avisaré cada día a las ${HORA_AVISO}. `);
    const quitar = document.createElement('button');
    quitar.type = 'button';
    quitar.className = 'underline';
    quitar.innerText = 'Quitar avisos';
    quitar.addEventListener('click', quitarAviso);
    estadoAvisos.append(quitar);
}

function base64UrlABytes(base64) {
    const relleno = '='.repeat((4 - (base64.length % 4)) % 4);
    const normal = (base64 + relleno).replace(/-/g, '+').replace(/_/g, '/');
    const crudo = atob(normal);
    return Uint8Array.from([...crudo].map(c => c.charCodeAt(0)));
}

// serviceWorker.ready no falla nunca: si el registro no llega a completarse se
// queda esperando para siempre. Con un plazo, la pantalla no se queda colgada.
function registroListo(segundos = 10) {
    return Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, rechazar) =>
            setTimeout(() => rechazar(new Error('El service worker no arrancó')), segundos * 1000)),
    ]);
}

async function suscripcionActual() {
    const registro = await registroListo();
    return registro.pushManager.getSubscription();
}

async function activarAviso() {
    btnAvisarme.disabled = true;
    try {
        const permiso = await Notification.requestPermission();
        if (permiso !== 'granted') {
            mostrarBloque(
                'No has dado permiso, así que no puedo avisarte. Puedes cambiarlo en los ajustes de notificaciones del móvil.',
                false
            );
            return;
        }

        const respuesta = await authFetch('/api/push/clave');
        const { clave } = await respuesta.json();

        const registro = await registroListo();
        const suscripcion = await registro.pushManager.subscribe({
            // Obligatorio: los avisos siempre se ven, nunca son silenciosos
            userVisibleOnly: true,
            applicationServerKey: base64UrlABytes(clave),
        });

        await authFetch('/api/push/suscribir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(suscripcion),
        });

        mostrarYaAvisado();
    } catch (err) {
        mostrarBloque('No se pudo activar el aviso. Inténtalo otra vez.', true);
    } finally {
        btnAvisarme.disabled = false;
    }
}

async function quitarAviso() {
    try {
        const suscripcion = await suscripcionActual();
        if (suscripcion) {
            await authFetch('/api/push/suscribir', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: suscripcion.endpoint }),
            });
            await suscripcion.unsubscribe();
        }
        estadoAvisos.innerText = '';
        mostrarBloque(`Ya no te avisaré. Puedes volver a activarlo cuando quieras.`, true);
    } catch (err) {
        alert('No se pudo quitar el aviso. Inténtalo otra vez.');
    }
}

async function arrancarAvisos() {
    // iPhone abierto desde Safari: no hay nada que activar hasta que la app
    // esté en la pantalla de inicio, así que se explica cómo.
    if (esIOS && !desdeIcono) {
        mostrarBloque(
            `🔔 ¿Quieres que te avise cada día a las ${HORA_AVISO}? En iPhone hace falta ` +
            'tener Cafendo en la pantalla de inicio: toca el botón de Compartir de Safari, ' +
            'elige "Añadir a pantalla de inicio" y abre Cafendo desde ese icono. Aquí te ' +
            'saldrá el botón para activarlo.',
            false
        );
        return;
    }

    if (!soportaAvisos) return; // navegador viejo: se queda como está hoy

    if (Notification.permission === 'denied') {
        mostrarBloque(
            'Tienes los avisos bloqueados para Cafendo. Si quieres que te avise a las ' +
            `${HORA_AVISO}, actívalos en los ajustes de notificaciones del móvil.`,
            false
        );
        return;
    }

    let suscripcion;
    try {
        suscripcion = await suscripcionActual();
    } catch (err) {
        // El service worker no arrancó (navegador raro, modo privado...): sin
        // él no hay avisos posibles, así que mejor no prometer nada.
        return;
    }

    if (suscripcion) {
        // Este móvil ya estaba apuntado. Se vuelve a mandar al servidor por si
        // se perdió (base de datos nueva, o el navegador renovó las claves).
        authFetch('/api/push/suscribir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(suscripcion),
        }).catch(() => {});
        mostrarYaAvisado();
        return;
    }

    mostrarBloque(`🔔 ¿Quieres que te avise cada día a las ${HORA_AVISO} para pedir?`, true);
}

btnAvisarme.addEventListener('click', activarAviso);
arrancarAvisos();
