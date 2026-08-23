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

// El último nombre con el que se entró. A diferencia de "usuario", este no se
// borra al cerrar sesión: sirve para que el login salga ya escrito y no haya
// que teclear el nombre cada vez.
function getUltimoUsuario() {
    return localStorage.getItem('ultimoUsuario') || '';
}

function guardarSesion(nombre, token) {
    localStorage.setItem('usuario', nombre);
    localStorage.setItem('ultimoUsuario', nombre);
    localStorage.setItem('token', token);
}

// El bar elegido se queda guardado: al abrir la app se entra directo a la
// pantalla de elegir bar, pero volver de un resumen no obliga a elegirlo otra vez.
function guardarBar(id) {
    localStorage.setItem('bar', id);
}

// Cierra la sesión, pero no olvida el nombre: al volver a entrar ya está
// escrito y basta con darle a "Entrar". Se apunta aquí también (y no solo al
// entrar) por las sesiones que ya estaban abiertas en los móviles antes de
// que esto existiera: si no, perderían el nombre una vez.
function cerrarSesion() {
    const nombre = getUsuario();
    if (nombre) localStorage.setItem('ultimoUsuario', nombre);

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
