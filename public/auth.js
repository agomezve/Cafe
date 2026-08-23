if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    });
}

function getToken() {
    return localStorage.getItem('token');
}

function getUsuario() {
    return localStorage.getItem('usuario');
}

function getBar() {
    return localStorage.getItem('bar');
}

function guardarSesion(nombre, token) {
    localStorage.setItem('usuario', nombre);
    localStorage.setItem('token', token);
}

// El bar elegido se queda guardado: al abrir la app se entra directo a la
// pantalla de elegir bar, pero volver de un resumen no obliga a elegirlo otra vez.
function guardarBar(id) {
    localStorage.setItem('bar', id);
}

function cerrarSesion() {
    localStorage.removeItem('usuario');
    localStorage.removeItem('token');
    localStorage.removeItem('bar');
    window.location.href = 'index.html';
}

// Las dos "exigir" cortan el script con una excepción a propósito: la
// redirección del navegador no es inmediata y sin sesión (o sin bar) no hay
// nada que pintar en la pantalla.
function exigirSesion() {
    if (!getToken()) {
        window.location.replace('index.html');
        throw new Error('Sin sesión');
    }
}

function exigirBar() {
    const bar = CATALOGO.barPorId(getBar());
    if (!bar) {
        window.location.replace('bares.html');
        throw new Error('Sin bar elegido');
    }
    return bar;
}

// fetch autenticado: añade el token y cierra sesión sola si el servidor la rechaza
async function authFetch(url, opciones = {}) {
    const headers = { ...(opciones.headers || {}), Authorization: `Bearer ${getToken()}` };
    const respuesta = await fetch(url, { ...opciones, headers });
    if (respuesta.status === 401) {
        cerrarSesion();
        throw new Error('Sesión expirada');
    }
    return respuesta;
}
