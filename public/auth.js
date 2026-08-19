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

function guardarSesion(nombre, token) {
    localStorage.setItem('usuario', nombre);
    localStorage.setItem('token', token);
}

function cerrarSesion() {
    localStorage.removeItem('usuario');
    localStorage.removeItem('token');
    window.location.href = 'index.html';
}

function exigirSesion() {
    if (!getToken()) {
        window.location.href = 'index.html';
        return false;
    }
    return true;
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
